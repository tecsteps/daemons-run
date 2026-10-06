package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestFrameRoundTrip(t *testing.T) {
	b := encodeFrame(kindHTTP, 0x01020304, []byte("abc"))
	if !bytes.Equal(b[:5], []byte{2, 1, 2, 3, 4}) {
		t.Fatalf("header %v", b[:5])
	}
	kind, ch, p, err := decodeFrame(b)
	if err != nil || kind != kindHTTP || ch != 0x01020304 || string(p) != "abc" {
		t.Fatalf("decoded %d %d %q %v", kind, ch, p, err)
	}
	if _, _, _, err := decodeFrame([]byte{1, 2}); err == nil {
		t.Fatal("short frame accepted")
	}
}

func TestBackoff(t *testing.T) {
	var b backoff
	want := []time.Duration{1, 2, 4, 8, 16, 30, 30}
	for _, w := range want {
		if got := b.next(func() float64 { return 0.5 }); got != w*time.Second {
			t.Fatalf("got %s want %s", got, w*time.Second)
		}
	}
	b.reset()
	if lo, hi := b.next(func() float64 { return 0 }), (&backoff{}).next(func() float64 { return 1 }); lo != 800*time.Millisecond || hi != 1200*time.Millisecond {
		t.Fatalf("jitter bounds %s %s", lo, hi)
	}
}

func TestWindow(t *testing.T) {
	w := newWindow(10)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := w.take(ctx, 8); err != nil {
		t.Fatal(err)
	}
	if err := w.take(ctx, 8); err == nil {
		t.Fatal("window overrun")
	}
	w.ack(6)
	if err := w.take(context.Background(), 8); err != nil {
		t.Fatal(err)
	}
}

// --- fake control plane -------------------------------------------------------------

type fakeCP struct {
	t      *testing.T
	srv    *httptest.Server
	conns  chan *websocket.Conn
	status atomic.Int32 // answer the upgrade with this status when set
	hits   atomic.Int32
}

type msg struct {
	text    bool
	raw     string
	m       M
	kind    byte
	ch      uint32
	payload []byte
}

// cpConn reads in its own goroutine: coder/websocket closes the connection when a Read
// context expires, so timeouts are applied to the msgs channel instead.
type cpConn struct {
	t      *testing.T
	ws     *websocket.Conn
	noPong atomic.Bool
	msgs   chan msg
	err    chan error
}

func newCPConn(t *testing.T, ws *websocket.Conn) *cpConn {
	c := &cpConn{t: t, ws: ws, msgs: make(chan msg, 1024), err: make(chan error, 1)}
	go func() {
		for {
			typ, data, err := ws.Read(context.Background())
			if err != nil {
				c.err <- err
				return
			}
			if typ == websocket.MessageBinary {
				kind, ch, p, _ := decodeFrame(data)
				c.msgs <- msg{kind: kind, ch: ch, payload: p}
				continue
			}
			if string(data) == "ping" {
				if !c.noPong.Load() {
					ws.Write(context.Background(), websocket.MessageText, []byte("pong"))
				}
				continue
			}
			m := msg{text: true, raw: string(data)}
			json.Unmarshal(data, &m.m)
			c.msgs <- m
		}
	}()
	return c
}

func newFakeCP(t *testing.T) *fakeCP {
	f := &fakeCP{t: t, conns: make(chan *websocket.Conn, 4)}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		if r.URL.Path != "/agent/connect" || r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Daemons-Protocol") != "1" {
			http.Error(w, "bad", 400)
			return
		}
		if s := f.status.Load(); s != 0 {
			w.WriteHeader(int(s))
			return
		}
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		ws.SetReadLimit(8 << 20)
		f.conns <- ws
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// startAgent runs an agent against the fake control plane until the test ends.
func startAgent(t *testing.T, f *fakeCP) *Agent {
	cfg := filepath.Join(t.TempDir(), "agent.toml")
	if err := writeConfig(cfg, config{ControlPlane: f.srv.URL, ServerID: "srv_1", Credential: "secret"}); err != nil {
		t.Fatal(err)
	}
	a := &Agent{configPath: cfg, terms: defaultTerminals()}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { a.loop(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	return a
}

func waitConnected(t *testing.T, a *Agent) {
	t.Helper()
	for i := 0; a.conn() == nil; i++ {
		if i > 200 {
			t.Fatal("agent not connected")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// accept waits for the agent's connection and answers its register request.
func (f *fakeCP) accept() *cpConn {
	f.t.Helper()
	var ws *websocket.Conn
	select {
	case ws = <-f.conns:
	case <-time.After(5 * time.Second):
		f.t.Fatal("agent did not connect")
	}
	c := newCPConn(f.t, ws)
	f.t.Cleanup(func() { ws.CloseNow() })
	reg := c.waitFor(func(m msg) bool { return m.m["type"] == "register" })
	for _, k := range []string{"protocol", "agent_version", "hostname", "os", "arch", "cpus"} {
		if _, ok := reg.m[k]; !ok {
			f.t.Fatalf("register lacks %s: %v", k, reg.m)
		}
	}
	c.send(M{"id": reg.m["id"], "ok": true, "server_id": "srv_1", "name": "web-1"})
	return c
}

func (c *cpConn) send(v any) {
	b, _ := json.Marshal(v)
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

func (c *cpConn) sendFrame(kind byte, ch uint32, p []byte) {
	if err := c.ws.Write(context.Background(), websocket.MessageBinary, encodeFrame(kind, ch, p)); err != nil {
		c.t.Fatal(err)
	}
}

func (c *cpConn) next(timeout time.Duration) (msg, error) {
	select {
	case m := <-c.msgs:
		return m, nil
	case err := <-c.err:
		c.err <- err
		return msg{}, err
	case <-time.After(timeout):
		return msg{}, context.DeadlineExceeded
	}
}

func (c *cpConn) waitFor(pred func(msg) bool) msg {
	c.t.Helper()
	for {
		m, err := c.next(5 * time.Second)
		if err != nil {
			c.t.Fatalf("waiting: %v", err)
		}
		if pred(m) {
			return m
		}
	}
}

func (c *cpConn) call(id string, req M) M {
	c.t.Helper()
	req["id"] = id
	c.send(req)
	return c.waitFor(func(m msg) bool { return m.m["id"] == id }).m
}

// --- connection tests ---------------------------------------------------------------

func TestRegisterAndRequests(t *testing.T) {
	f := newFakeCP(t)
	a := startAgent(t, f)
	c := f.accept()

	info := c.call("c1", M{"type": "system.info"})
	if info["ok"] != true || info["hostname"] == "" || info["agents"] == nil {
		t.Fatalf("system.info: %v", info)
	}
	if r := c.call("c2", M{"type": "nope"}); r["ok"] != false || r["error"].(map[string]any)["code"] != "unsupported" {
		t.Fatalf("unknown type: %v", r)
	}
	dir := t.TempDir()
	r := c.call("c3", M{"type": "exec", "command": "echo hi; echo err >&2; exit 3", "cwd": dir})
	if r["ok"] != true || r["stdout"] != "hi\n" || r["stderr"] != "err\n" || r["exit_code"] != 3.0 {
		t.Fatalf("exec: %v", r)
	}

	// cancel stops a running exec.
	c.send(M{"id": "c4", "type": "exec", "command": "sleep 10", "cwd": dir})
	time.Sleep(100 * time.Millisecond)
	c.send(M{"type": "cancel", "id": "c4"})
	start := time.Now()
	r = c.waitFor(func(m msg) bool { return m.m["id"] == "c4" }).m
	if r["error"].(map[string]any)["code"] != "cancelled" || time.Since(start) > 3*time.Second {
		t.Fatalf("cancel: %v after %s", r, time.Since(start))
	}

	waitConnected(t, a)
	st := a.cli(context.Background(), cliRequest{Cmd: "status"})
	if st["connected"] != true || st["name"] != "web-1" || st["server_id"] != "srv_1" {
		t.Fatalf("status %v", st)
	}
}

func TestAgentRequestReplyAndDeadline(t *testing.T) {
	old := requestTimeout
	requestTimeout = 300 * time.Millisecond
	t.Cleanup(func() { requestTimeout = old })
	f := newFakeCP(t)
	a := startAgent(t, f)
	c := f.accept()
	waitConnected(t, a)

	got := make(chan M, 1)
	go func() {
		got <- a.cli(context.Background(), cliRequest{Cmd: "expose", Port: 3000, Name: "shop", Cwd: "/projects/shop"})
	}()
	req := c.waitFor(func(m msg) bool { return m.m["type"] == "app.expose" }).m
	if !strings.HasPrefix(req["id"].(string), "a") || req["name"] != "shop" || req["port"] != 3000.0 {
		t.Fatalf("app.expose request %v", req)
	}
	c.send(M{"id": req["id"], "ok": true, "url": "https://apps.example/shop/", "public": false})
	if r := <-got; r["ok"] != true || r["url"] != "https://apps.example/shop/" {
		t.Fatalf("expose reply %v", r)
	}

	// No reply: the request fails with timeout after the deadline; a late reply is dropped.
	go func() { got <- a.cli(context.Background(), cliRequest{Cmd: "apps"}) }()
	req = c.waitFor(func(m msg) bool { return m.m["type"] == "app.list" }).m
	start := time.Now()
	r := <-got
	if r["ok"] != false || r["code"] != "timeout" || time.Since(start) > 2*time.Second {
		t.Fatalf("deadline: %v", r)
	}
	c.send(M{"id": req["id"], "ok": true, "apps": []any{}})
	if info := c.call("c1", M{"type": "system.info"}); info["ok"] != true {
		t.Fatal("connection broken after late reply")
	}

	if r := a.cli(context.Background(), cliRequest{Cmd: "expose", Port: 3000, Name: "Bad Name"}); r["ok"] != false {
		t.Fatalf("bad name accepted: %v", r)
	}
}

func TestReconnectAndPongTimeout(t *testing.T) {
	oldPing, oldPong := pingInterval, pongTimeout
	pingInterval, pongTimeout = 50*time.Millisecond, 300*time.Millisecond
	t.Cleanup(func() { pingInterval, pongTimeout = oldPing, oldPong }) // after the agent stops
	f := newFakeCP(t)
	startAgent(t, f)

	// Without pongs the agent drops the connection and reconnects with backoff.
	c := f.accept()
	c.noPong.Store(true)
	start := time.Now()
	c2 := f.accept()
	if d := time.Since(start); d < 300*time.Millisecond || d > 3*time.Second {
		t.Fatalf("reconnected after %s", d)
	}

	// A server-side close also reconnects.
	c2.ws.Close(websocket.StatusNormalClosure, "")
	f.accept()
}

func TestUnauthorizedStopsRetrying(t *testing.T) {
	f := newFakeCP(t)
	f.status.Store(401)
	startAgent(t, f)
	time.Sleep(1500 * time.Millisecond)
	if n := f.hits.Load(); n != 1 {
		t.Fatalf("agent retried after 401: %d attempts", n)
	}
}

// --- HTTP and WebSocket proxy -------------------------------------------------------

func upstreamPort(t *testing.T, h http.Handler) int {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	n, _ := strconv.Atoi(port)
	return n
}

func TestHTTPProxy(t *testing.T) {
	port := upstreamPort(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := new(bytes.Buffer)
		body.ReadFrom(r.Body)
		w.Header().Add("Set-Cookie", "a=1")
		w.Header().Add("Set-Cookie", "b=2")
		w.Header().Set("Location", "http://localhost/x")
		w.WriteHeader(201)
		fmt.Fprintf(w, "%s %s host=%s prefix=%s body=%s", r.Method, r.URL.RequestURI(), r.Host, r.Header.Get("X-Forwarded-Prefix"), body)
	}))
	f := newFakeCP(t)
	startAgent(t, f)
	c := f.accept()

	r := c.call("c1", M{"type": "http.request", "channel": 7, "port": port, "method": "POST", "path": "/shop/api?x=1",
		"headers": [][2]string{{"X-Forwarded-Prefix", "/shop"}, {"Content-Type", "text/plain"}, {"Connection", "keep-alive"}}, "body": true})
	if r["ok"] != true {
		t.Fatalf("http.request: %v", r)
	}
	c.sendFrame(kindHTTP, 7, []byte("hello "))
	c.sendFrame(kindHTTP, 7, []byte("world"))
	c.send(M{"type": "http.body.end", "channel": 7})

	var body bytes.Buffer
	var resp M
	acked := 0
	for {
		m, err := c.next(5 * time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if !m.text && m.kind == kindHTTP && m.ch == 7 {
			body.Write(m.payload)
			continue
		}
		switch m.m["type"] {
		case "http.ack":
			acked += int(m.m["bytes"].(float64))
		case "http.response":
			resp = m.m
		}
		if m.m["type"] == "http.end" {
			break
		}
		if m.m["type"] == "http.error" {
			t.Fatalf("http.error %v", m.m)
		}
	}
	if resp == nil || resp["status"] != 201.0 {
		t.Fatalf("response %v", resp)
	}
	cookies := 0
	for _, h := range resp["headers"].([]any) {
		if h.([]any)[0] == "Set-Cookie" {
			cookies++
		}
	}
	want := fmt.Sprintf("POST /shop/api?x=1 host=127.0.0.1:%d prefix=/shop body=hello world", port)
	if body.String() != want || cookies != 2 || acked != 11 {
		t.Fatalf("body %q cookies %d acked %d", body.String(), cookies, acked)
	}
}

func TestHTTPWindowAndNotListening(t *testing.T) {
	big := bytes.Repeat([]byte("x"), 3<<20)
	port := upstreamPort(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(big) }))
	f := newFakeCP(t)
	startAgent(t, f)
	c := f.accept()

	c.call("c1", M{"type": "http.request", "channel": 9, "port": port, "method": "GET", "path": "/big", "headers": [][2]string{}})
	received := 0
	end := false
	read := func() {
		for {
			m, err := c.next(300 * time.Millisecond)
			if err != nil {
				return // quiet: the agent waits for an ack
			}
			if !m.text && m.ch == 9 {
				received += len(m.payload)
			}
			if m.m["type"] == "http.end" {
				end = true
				return
			}
		}
	}
	read()
	if received != windowBytes || end {
		t.Fatalf("before ack: received %d end=%v", received, end)
	}
	c.send(M{"type": "http.ack", "channel": 9, "bytes": received})
	read()
	if received != 2*windowBytes {
		t.Fatalf("after one ack: received %d", received)
	}
	c.send(M{"type": "http.ack", "channel": 9, "bytes": 2 * windowBytes})
	read()
	if received != len(big) || !end {
		t.Fatalf("after all acks: received %d end=%v", received, end)
	}

	// Nothing listening on the port.
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := l.Addr().(*net.TCPAddr).Port
	l.Close()
	c.call("c2", M{"type": "http.request", "channel": 10, "port": closed, "method": "GET", "path": "/"})
	e := c.waitFor(func(m msg) bool { return m.m["type"] == "http.error" }).m
	if e["code"] != "not_listening" || e["channel"] != 10.0 {
		t.Fatalf("http.error %v", e)
	}

	// http.cancel aborts a request that hangs.
	hang := upstreamPort(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	c.call("c3", M{"type": "http.request", "channel": 11, "port": hang, "method": "GET", "path": "/"})
	c.send(M{"type": "http.cancel", "channel": 11})
	if m, err := c.next(500 * time.Millisecond); err == nil {
		t.Fatalf("message after cancel: %+v", m)
	}
}

func TestWebSocketProxy(t *testing.T) {
	closed := make(chan websocket.StatusCode, 1)
	port := upstreamPort(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"vite-hmr"}, InsecureSkipVerify: true})
		if err != nil {
			return
		}
		for {
			typ, data, err := ws.Read(context.Background())
			if err != nil {
				closed <- websocket.CloseStatus(err)
				return
			}
			ws.Write(context.Background(), typ, append([]byte("echo:"), data...))
		}
	}))
	f := newFakeCP(t)
	startAgent(t, f)
	c := f.accept()

	r := c.call("c1", M{"type": "ws.open", "channel": 3, "port": port, "path": "/shop/", "protocols": []string{"vite-hmr"},
		"headers": [][2]string{{"Sec-WebSocket-Key", "ignored"}, {"Origin", "https://apps.example"}}})
	if r["ok"] != true || r["protocol"] != "vite-hmr" {
		t.Fatalf("ws.open %v", r)
	}
	c.sendFrame(kindWSText, 3, []byte("hi"))
	m := c.waitFor(func(m msg) bool { return !m.text })
	if m.kind != kindWSText || m.ch != 3 || string(m.payload) != "echo:hi" {
		t.Fatalf("frame %+v", m)
	}
	c.sendFrame(kindWSBinary, 3, []byte{1, 2})
	m = c.waitFor(func(m msg) bool { return !m.text })
	if m.kind != kindWSBinary || !bytes.Equal(m.payload, []byte("echo:\x01\x02")) {
		t.Fatalf("binary frame %+v", m)
	}
	c.send(M{"type": "ws.close", "channel": 3, "code": 4001, "reason": "bye"})
	select {
	case code := <-closed:
		if code != 4001 {
			t.Fatalf("upstream close code %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upstream not closed")
	}
}
