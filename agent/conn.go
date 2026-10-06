package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Binary frame kinds (PROTOCOL.md "Frames").
const (
	kindTerminal = 0x01
	kindHTTP     = 0x02
	kindWSText   = 0x03
	kindWSBinary = 0x04

	maxPayload   = 64 << 10 // terminal and HTTP body frames
	maxWSMessage = 1 << 20  // a proxied WebSocket message travels whole
	queueFrames  = 256      // bounded queue per channel, each direction
	windowBytes  = 1 << 20  // unacknowledged HTTP body bytes per channel
)

// Timings; variables so tests can shorten them.
var (
	requestTimeout = 30 * time.Second
	pingInterval   = 30 * time.Second
	pongTimeout    = 75 * time.Second
	stableAfter    = 60 * time.Second
)

func encodeFrame(kind byte, channel uint32, payload []byte) []byte {
	b := make([]byte, 5+len(payload))
	b[0] = kind
	binary.BigEndian.PutUint32(b[1:5], channel)
	copy(b[5:], payload)
	return b
}

func decodeFrame(b []byte) (kind byte, channel uint32, payload []byte, err error) {
	if len(b) < 5 {
		return 0, 0, nil, errors.New("short frame")
	}
	return b[0], binary.BigEndian.Uint32(b[1:5]), b[5:], nil
}

// protoError is a reply error with a protocol error code.
type protoError struct{ Code, Message string }

func (e *protoError) Error() string { return e.Code + ": " + e.Message }

func perr(code, format string, args ...any) *protoError {
	return &protoError{Code: code, Message: fmt.Sprintf(format, args...)}
}

func toProto(err error) *protoError {
	var pe *protoError
	switch {
	case errors.As(err, &pe):
		return pe
	case errors.Is(err, context.Canceled):
		return perr("cancelled", "cancelled")
	case errors.Is(err, context.DeadlineExceeded):
		return perr("timeout", "timed out")
	}
	return perr("internal", "%v", err)
}

// backoff implements 1 s doubling to 30 s with ±20 % jitter.
type backoff struct{ cur time.Duration }

func (b *backoff) next(rnd func() float64) time.Duration {
	if b.cur == 0 {
		b.cur = time.Second
	} else {
		b.cur = min(b.cur*2, 30*time.Second)
	}
	return time.Duration(float64(b.cur) * (0.8 + 0.4*rnd()))
}

func (b *backoff) reset() { b.cur = 0 }

// window bounds unacknowledged body bytes per channel.
type window struct {
	mu     sync.Mutex
	avail  int64
	signal chan struct{}
}

func newWindow(n int64) *window { return &window{avail: n, signal: make(chan struct{}, 1)} }

func (w *window) take(ctx context.Context, n int64) error {
	for {
		w.mu.Lock()
		if w.avail >= n {
			w.avail -= n
			w.mu.Unlock()
			return nil
		}
		w.mu.Unlock()
		select {
		case <-w.signal:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (w *window) ack(n int64) {
	w.mu.Lock()
	w.avail += n
	w.mu.Unlock()
	select {
	case w.signal <- struct{}{}:
	default:
	}
}

type outFrame struct {
	typ  websocket.MessageType
	data []byte
	done func()
}

type inFrame struct {
	kind    byte
	data    []byte
	close   bool // ws.close from the control plane
	code    int
	reason  string
	bodyEnd bool // http.body.end
}

// channel is one terminal, HTTP request, proxied WebSocket or archive download.
type channel struct {
	id     uint32
	typ    string // the request that opened it
	c      *conn
	ctx    context.Context
	cancel context.CancelFunc
	in     chan inFrame // written only by the reader goroutine
	slots  chan struct{}
	win    *window
	high   bool // terminal traffic goes before everything else
	term   atomic.Pointer[termClient]
}

// send queues a binary frame, blocking while the channel's queue is full (back-pressure).
func (ch *channel) send(kind byte, p []byte) error {
	return ch.enqueue(outFrame{typ: websocket.MessageBinary, data: encodeFrame(kind, ch.id, p)})
}

// sendJSON queues a per-channel event behind the channel's data, keeping their order.
func (ch *channel) sendJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return ch.enqueue(outFrame{typ: websocket.MessageText, data: b})
}

func (ch *channel) enqueue(f outFrame) error {
	select {
	case ch.slots <- struct{}{}:
	case <-ch.ctx.Done():
		return ch.ctx.Err()
	}
	f.done = func() { <-ch.slots }
	q := ch.c.low
	if ch.high {
		q = ch.c.high
	}
	select {
	case q <- f:
		return nil
	case <-ch.ctx.Done():
		return ch.ctx.Err()
	}
}

// deliver hands an inbound frame to the channel without ever blocking the reader. A sender
// that overruns the bounded inbound queue loses the channel (PROTOCOL.md "Flow control").
func (ch *channel) deliver(f inFrame) {
	select {
	case ch.in <- f:
		return
	default:
	}
	log.Printf("channel %d: inbound queue full, closing it", ch.id)
	var ev M
	switch ch.typ {
	case "http.request":
		ev = M{"type": "http.error", "channel": ch.id, "code": "too_large", "message": "request body queue full"}
	case "ws.open":
		ev = M{"type": "ws.close", "channel": ch.id, "code": 1009, "reason": "queue full"}
	case "terminal.open":
		ev = M{"type": "terminal.exit", "channel": ch.id, "session": "", "session_ended": false}
		if tc := ch.term.Load(); tc != nil {
			ev["session"] = tc.name()
		}
	}
	ch.c.closeChannel(ch.id)
	if ev != nil {
		go ch.c.send(ev)
	}
}

// handler runs a control plane request. after, if set, runs once the reply is queued.
type handler func(ctx context.Context, c *conn, raw json.RawMessage, ch *channel) (res M, after func(), err error)

var handlers map[string]handler

// channelOpeners are requests whose channel must exist before any frame for it arrives.
var channelOpeners = map[string]bool{"terminal.open": true, "http.request": true, "ws.open": true, "file.archive": true}

func init() {
	handlers = map[string]handler{
		"system.info": func(context.Context, *conn, json.RawMessage, *channel) (M, func(), error) {
			return systemInfo(), nil, nil
		},
		"exec":            handleExec,
		"ports.list":      handlePorts,
		"terminal.list":   handleTerminalList,
		"terminal.open":   handleTerminalOpen,
		"terminal.resize": handleTerminalResize,
		"terminal.close":  handleTerminalClose,
		"terminal.kill":   handleTerminalKill,
		"terminal.rename": handleTerminalRename,
		"http.request":    handleHTTPRequest,
		"ws.open":         handleWSOpen,
		"file.archive":    handleFileArchive,
	}
	for _, t := range fileOpTypes {
		handlers[t] = handleFileOp
	}
}

// conn is one live WebSocket connection to the control plane.
type conn struct {
	ws     *websocket.Conn
	agent  *Agent
	ctx    context.Context
	cancel context.CancelFunc
	high   chan outFrame
	low    chan outFrame
	nextID atomic.Uint64

	mu       sync.Mutex
	pending  map[string]chan json.RawMessage
	running  map[string]context.CancelFunc
	channels map[uint32]*channel

	lastPong atomic.Int64
}

func newConn(parent context.Context, ws *websocket.Conn, a *Agent) *conn {
	ctx, cancel := context.WithCancel(parent)
	c := &conn{
		ws: ws, agent: a, ctx: ctx, cancel: cancel,
		high: make(chan outFrame, 64), low: make(chan outFrame, 64),
		pending:  map[string]chan json.RawMessage{},
		running:  map[string]context.CancelFunc{},
		channels: map[uint32]*channel{},
	}
	c.lastPong.Store(time.Now().UnixNano())
	ws.SetReadLimit(2 << 20)
	return c
}

// run serves the connection until it drops. onRegistered runs after a successful register.
func (c *conn) run(onRegistered func(M)) error {
	var wg sync.WaitGroup
	wg.Go(c.writer)
	wg.Go(c.heartbeat)
	wg.Go(func() {
		res, err := c.request(c.ctx, "register", registerFacts())
		if err != nil {
			log.Printf("register failed: %v", err)
			c.cancel()
			return
		}
		onRegistered(res)
	})
	err := c.reader()
	c.cancel()
	c.ws.CloseNow()
	wg.Wait()
	return err
}

func (c *conn) writer() {
	for {
		var f outFrame
		select {
		case f = <-c.high:
		default:
			select {
			case f = <-c.high:
			case f = <-c.low:
			case <-c.ctx.Done():
				return
			}
		}
		err := c.ws.Write(c.ctx, f.typ, f.data)
		if f.done != nil {
			f.done()
		}
		if err != nil {
			c.cancel()
			return
		}
	}
}

func (c *conn) heartbeat() {
	ping := time.NewTicker(pingInterval)
	check := time.NewTicker(min(pingInterval, 5*time.Second))
	defer ping.Stop()
	defer check.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ping.C:
			c.enqueueHigh(outFrame{typ: websocket.MessageText, data: []byte("ping")})
		case <-check.C:
			if time.Since(time.Unix(0, c.lastPong.Load())) > pongTimeout {
				log.Printf("no pong for %s, reconnecting", pongTimeout)
				c.cancel()
				return
			}
		}
	}
}

func (c *conn) enqueueHigh(f outFrame) error {
	select {
	case c.high <- f:
		return nil
	case <-c.ctx.Done():
		return c.ctx.Err()
	}
}

// send queues a JSON message (requests, replies, connection-level events).
func (c *conn) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.enqueueHigh(outFrame{typ: websocket.MessageText, data: b})
}

// request sends an agent → control plane request and waits for its reply.
func (c *conn) request(ctx context.Context, typ string, params M) (M, error) {
	id := fmt.Sprintf("a%d", c.nextID.Add(1))
	wait := make(chan json.RawMessage, 1)
	c.mu.Lock()
	c.pending[id] = wait
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
	}()
	msg := M{}
	for k, v := range params {
		msg[k] = v
	}
	msg["id"], msg["type"] = id, typ
	if err := c.send(msg); err != nil {
		return nil, perr("unavailable", "not connected")
	}
	timer := time.NewTimer(requestTimeout)
	defer timer.Stop()
	select {
	case raw := <-wait:
		var r struct {
			OK    bool        `json:"ok"`
			Error *protoError `json:"error"`
		}
		var res M
		if err := json.Unmarshal(raw, &r); err != nil || json.Unmarshal(raw, &res) != nil {
			return nil, perr("internal", "bad reply")
		}
		if !r.OK {
			if r.Error == nil {
				r.Error = perr("internal", "request failed")
			}
			return nil, r.Error
		}
		delete(res, "id")
		delete(res, "ok")
		return res, nil
	case <-timer.C:
		return nil, perr("timeout", "%s: no reply within %s", typ, requestTimeout)
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.ctx.Done():
		return nil, perr("unavailable", "connection closed")
	}
}

func (c *conn) reply(id string, res M, err error) {
	m := M{}
	for k, v := range res {
		m[k] = v
	}
	m["id"], m["ok"] = id, err == nil
	if err != nil {
		pe := toProto(err)
		m["error"] = M{"code": pe.Code, "message": pe.Message}
	}
	c.send(m)
}

func (c *conn) reader() error {
	for {
		typ, data, err := c.ws.Read(c.ctx)
		if err != nil {
			return err
		}
		if typ == websocket.MessageBinary {
			kind, id, payload, err := decodeFrame(data)
			if err != nil {
				continue
			}
			if ch := c.channel(id); ch != nil {
				ch.deliver(inFrame{kind: kind, data: payload})
			}
			continue
		}
		if string(data) == "pong" {
			c.lastPong.Store(time.Now().UnixNano())
			continue
		}
		c.dispatch(data)
	}
}

// envelope holds the fields the reader needs to route a JSON message.
type envelope struct {
	ID      string  `json:"id"`
	Type    string  `json:"type"`
	OK      *bool   `json:"ok"`
	Channel *uint32 `json:"channel"`
	Bytes   int64   `json:"bytes"`
	Code    int     `json:"code"`
	Reason  string  `json:"reason"`
}

func (c *conn) dispatch(data []byte) {
	var env envelope
	if err := json.Unmarshal(data, &env); err != nil {
		log.Printf("bad message: %v", err)
		return
	}
	switch {
	case env.OK != nil: // reply to one of our requests; late replies are dropped
		c.mu.Lock()
		wait := c.pending[env.ID]
		c.mu.Unlock()
		if wait != nil {
			select {
			case wait <- data:
			default:
			}
		}
	case env.ID != "" && env.Type != "cancel": // cancel is an event that names a request id
		c.startRequest(env.ID, env.Type, env.Channel, data)
	default:
		c.event(env, data)
	}
}

func (c *conn) startRequest(id, typ string, chID *uint32, raw json.RawMessage) {
	h := handlers[typ]
	if h == nil {
		go c.reply(id, nil, perr("unsupported", "unknown type %q", typ))
		return
	}
	var ch *channel
	if channelOpeners[typ] {
		if chID == nil {
			go c.reply(id, nil, perr("bad_request", "channel is required"))
			return
		}
		if ch = c.openChannel(*chID, typ); ch == nil {
			go c.reply(id, nil, perr("bad_request", "channel %d is in use", *chID))
			return
		}
	}
	ctx, cancel := context.WithCancel(c.ctx)
	c.mu.Lock()
	c.running[id] = cancel
	c.mu.Unlock()
	go func() {
		defer func() {
			c.mu.Lock()
			delete(c.running, id)
			c.mu.Unlock()
			cancel()
		}()
		res, after, err := h(ctx, c, raw, ch)
		if err != nil && ch != nil {
			c.closeChannel(ch.id)
		}
		c.reply(id, res, err)
		if err == nil && after != nil {
			after()
		}
	}()
}

func (c *conn) event(env envelope, raw []byte) {
	if env.Type == "cancel" {
		var v struct {
			ID string `json:"id"`
		}
		json.Unmarshal(raw, &v)
		c.mu.Lock()
		cancel := c.running[v.ID]
		c.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		return
	}
	if env.Channel == nil {
		return
	}
	ch := c.channel(*env.Channel)
	if ch == nil {
		return
	}
	switch env.Type {
	case "http.ack":
		if ch.win != nil {
			ch.win.ack(env.Bytes)
		}
	case "http.cancel":
		c.closeChannel(ch.id)
	case "http.body.end":
		ch.deliver(inFrame{bodyEnd: true})
	case "ws.close":
		ch.deliver(inFrame{close: true, code: env.Code, reason: env.Reason})
	}
}

func (c *conn) openChannel(id uint32, typ string) *channel {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.channels[id] != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(c.ctx)
	ch := &channel{id: id, typ: typ, c: c, ctx: ctx, cancel: cancel, high: typ == "terminal.open", win: newWindow(windowBytes),
		in: make(chan inFrame, queueFrames), slots: make(chan struct{}, queueFrames)}
	c.channels[id] = ch
	return ch
}

func (c *conn) channel(id uint32) *channel {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.channels[id]
}

func (c *conn) closeChannel(id uint32) {
	c.mu.Lock()
	ch := c.channels[id]
	delete(c.channels, id)
	c.mu.Unlock()
	if ch != nil {
		ch.cancel()
	}
}

// Agent keeps the connection to the control plane alive and serves the local CLI.
type Agent struct {
	configPath string
	terms      *terminals

	mu    sync.Mutex
	cfg   config
	cur   *conn
	name  string
	since time.Time
}

func runAgent(ctx context.Context, configPath string) error {
	a := &Agent{configPath: configPath, terms: defaultTerminals()}
	if err := a.terms.writeConf(); err != nil {
		log.Printf("tmux config: %v", err)
	}
	go func() {
		if err := a.serveCLI(ctx, cliSocketPath); err != nil {
			log.Printf("cli socket: %v", err)
		}
	}()
	a.loop(ctx)
	return nil
}

// loop connects forever. The agent owns reconnects (PROTOCOL.md "Connection lifecycle").
func (a *Agent) loop(ctx context.Context) {
	var b backoff
	for ctx.Err() == nil {
		cfg, err := readConfig(a.configPath)
		if err != nil {
			log.Printf("config: %v", err)
			sleep(ctx, 10*time.Second)
			continue
		}
		a.mu.Lock()
		a.cfg = cfg
		a.mu.Unlock()
		start := time.Now()
		status, err := a.connectOnce(ctx, cfg)
		if ctx.Err() != nil {
			return
		}
		if status == http.StatusUnauthorized {
			log.Printf("credential rejected (401); waiting for a new %s", a.configPath)
			a.waitConfigChange(ctx)
			b.reset()
			continue
		}
		if time.Since(start) >= stableAfter {
			b.reset()
		}
		d := b.next(rand.Float64)
		log.Printf("disconnected (%v); reconnecting in %s", err, d.Round(100*time.Millisecond))
		sleep(ctx, d)
	}
}

func (a *Agent) connectOnce(ctx context.Context, cfg config) (int, error) {
	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	h := http.Header{}
	h.Set("Authorization", "Bearer "+cfg.Credential)
	h.Set("X-Daemons-Protocol", fmt.Sprint(protocolVersion))
	ws, resp, err := websocket.Dial(dialCtx, wsURL(cfg.ControlPlane)+"/agent/connect", &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		if resp != nil {
			return resp.StatusCode, fmt.Errorf("connect: %d", resp.StatusCode)
		}
		return 0, err
	}
	c := newConn(ctx, ws, a)
	err = c.run(func(res M) {
		a.mu.Lock()
		a.cur, a.since = c, time.Now()
		a.name, _ = res["name"].(string)
		if id, ok := res["server_id"].(string); ok && id != "" {
			a.cfg.ServerID = id
		}
		a.mu.Unlock()
		log.Printf("connected to %s as %s", cfg.ControlPlane, a.name)
	})
	a.mu.Lock()
	if a.cur == c {
		a.cur = nil
	}
	a.mu.Unlock()
	return 0, err
}

func (a *Agent) conn() *conn {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cur
}

func (a *Agent) waitConfigChange(ctx context.Context) {
	before := modTime(a.configPath)
	for ctx.Err() == nil && modTime(a.configPath).Equal(before) {
		sleep(ctx, 10*time.Second)
	}
}

func wsURL(cp string) string {
	cp = strings.TrimRight(cp, "/")
	if rest, ok := strings.CutPrefix(cp, "https://"); ok {
		return "wss://" + rest
	}
	if rest, ok := strings.CutPrefix(cp, "http://"); ok {
		return "ws://" + rest
	}
	return cp
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
	case <-ctx.Done():
	}
}
