package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

// Hop-by-hop headers are never forwarded; Host is set by the agent.
var hopHeaders = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-connection": true, "transfer-encoding": true,
	"upgrade": true, "te": true, "trailer": true, "host": true,
}

// dialLoopback dials 127.0.0.1:<port> and falls back to [::1] when nothing listens on IPv4.
func dialLoopback(ctx context.Context, _, addr string) (net.Conn, error) {
	var d net.Dialer
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil && errors.Is(err, syscall.ECONNREFUSED) {
		_, port, _ := net.SplitHostPort(addr)
		if c6, err6 := d.DialContext(ctx, "tcp", net.JoinHostPort("::1", port)); err6 == nil {
			return c6, nil
		}
	}
	return c, err
}

var proxyClient = &http.Client{
	Transport: &http.Transport{
		DialContext:         dialLoopback,
		DisableCompression:  true, // pass bodies through exactly as the app sends them
		MaxIdleConnsPerHost: 8,
		IdleConnTimeout:     30 * time.Second,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

type headerList [][2]string

func handleHTTPRequest(_ context.Context, c *conn, raw json.RawMessage, ch *channel) (M, func(), error) {
	var p struct {
		Port    int        `json:"port"`
		Method  string     `json:"method"`
		Path    string     `json:"path"`
		Headers headerList `json:"headers"`
		Body    bool       `json:"body"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.Port < 1 || p.Port > 65535 || !strings.HasPrefix(p.Path, "/") {
		return nil, nil, perr("bad_request", "port and path are required")
	}
	if p.Method == "" {
		p.Method = "GET"
	}
	host := "127.0.0.1:" + strconv.Itoa(p.Port)
	var body io.Reader = http.NoBody
	var pw *io.PipeWriter
	if p.Body {
		var pr *io.PipeReader
		pr, pw = io.Pipe()
		body = pr
	}
	req, err := http.NewRequestWithContext(ch.ctx, p.Method, "http://"+host+p.Path, body)
	if err != nil {
		return nil, nil, perr("bad_request", "%v", err)
	}
	for _, h := range p.Headers {
		switch name := strings.ToLower(h[0]); {
		case hopHeaders[name]:
		case name == "content-length":
			if n, err := strconv.ParseInt(h[1], 10, 64); err == nil && p.Body {
				req.ContentLength = n
			}
		default:
			req.Header.Add(h[0], h[1])
		}
	}
	req.Host = host
	after := func() {
		if pw != nil {
			go pumpRequestBody(c, ch, pw)
		}
		go proxyHTTP(c, ch, req)
	}
	return nil, after, nil
}

// pumpRequestBody feeds request body frames from the control plane to the app and acks them.
func pumpRequestBody(c *conn, ch *channel, pw *io.PipeWriter) {
	failed := false
	for {
		select {
		case <-ch.ctx.Done():
			pw.CloseWithError(ch.ctx.Err())
			return
		case f := <-ch.in:
			if f.bodyEnd {
				pw.Close()
				return
			}
			if f.kind != kindHTTP || failed {
				continue // after an early response the rest of the body is discarded
			}
			if _, err := pw.Write(f.data); err != nil {
				failed = true
				continue
			}
			c.send(M{"type": "http.ack", "channel": ch.id, "bytes": len(f.data)})
		}
	}
}

func proxyHTTP(c *conn, ch *channel, req *http.Request) {
	defer c.closeChannel(ch.id)
	resp, err := proxyClient.Do(req)
	if err != nil {
		if ch.ctx.Err() != nil {
			return // cancelled by the control plane
		}
		code := "unavailable"
		if errors.Is(err, syscall.ECONNREFUSED) {
			code = "not_listening"
		}
		ch.sendJSON(M{"type": "http.error", "channel": ch.id, "code": code, "message": err.Error()})
		return
	}
	defer resp.Body.Close()
	headers := headerList{}
	for name, values := range resp.Header {
		if hopHeaders[strings.ToLower(name)] {
			continue
		}
		for _, v := range values {
			headers = append(headers, [2]string{name, v})
		}
	}
	ch.sendJSON(M{"type": "http.response", "channel": ch.id, "status": resp.StatusCode, "headers": headers})
	if err := streamBody(ch, resp.Body); err != nil {
		if ch.ctx.Err() == nil {
			ch.sendJSON(M{"type": "http.error", "channel": ch.id, "code": "unavailable", "message": err.Error()})
		}
		return
	}
	ch.sendJSON(M{"type": "http.end", "channel": ch.id})
}

func handleWSOpen(_ context.Context, c *conn, raw json.RawMessage, ch *channel) (M, func(), error) {
	var p struct {
		Port      int        `json:"port"`
		Path      string     `json:"path"`
		Headers   headerList `json:"headers"`
		Protocols []string   `json:"protocols"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.Port < 1 || p.Port > 65535 || !strings.HasPrefix(p.Path, "/") {
		return nil, nil, perr("bad_request", "port and path are required")
	}
	h := http.Header{}
	for _, kv := range p.Headers {
		name := strings.ToLower(kv[0])
		if hopHeaders[name] || strings.HasPrefix(name, "sec-websocket-") {
			continue
		}
		h.Add(kv[0], kv[1])
	}
	dialCtx, cancel := context.WithTimeout(ch.ctx, 10*time.Second)
	defer cancel()
	up, _, err := websocket.Dial(dialCtx, "ws://127.0.0.1:"+strconv.Itoa(p.Port)+p.Path, &websocket.DialOptions{
		HTTPClient: proxyClient, HTTPHeader: h, Subprotocols: p.Protocols,
	})
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) {
			return nil, nil, perr("unavailable", "nothing is listening on port %d", p.Port)
		}
		return nil, nil, perr("unavailable", "%v", err)
	}
	up.SetReadLimit(maxWSMessage)
	after := func() {
		var cpClosed atomic.Bool
		go wsFromApp(c, ch, up, &cpClosed)
		go wsToApp(c, ch, up, &cpClosed)
	}
	return M{"protocol": up.Subprotocol()}, after, nil
}

func wsFromApp(c *conn, ch *channel, up *websocket.Conn, cpClosed *atomic.Bool) {
	for {
		typ, data, err := up.Read(ch.ctx)
		if err != nil {
			if ch.ctx.Err() == nil && !cpClosed.Load() {
				code := int(websocket.CloseStatus(err))
				reason := ""
				var ce websocket.CloseError
				if errors.As(err, &ce) {
					reason = ce.Reason
				}
				if code == -1 || code == 1005 || code == 1006 {
					code = 1001
				}
				if code == 1009 {
					reason = "message too large"
				}
				ch.sendJSON(M{"type": "ws.close", "channel": ch.id, "code": code, "reason": reason})
			}
			c.closeChannel(ch.id)
			up.CloseNow()
			return
		}
		kind := byte(kindWSBinary)
		if typ == websocket.MessageText {
			kind = kindWSText
		}
		if ch.send(kind, data) != nil {
			return
		}
	}
}

func wsToApp(c *conn, ch *channel, up *websocket.Conn, cpClosed *atomic.Bool) {
	for {
		select {
		case <-ch.ctx.Done():
			up.CloseNow()
			return
		case f := <-ch.in:
			if f.close {
				code := f.code
				if code < 1000 || code == 1005 || code == 1006 || code == 1015 || code > 4999 {
					code = 1000
				}
				cpClosed.Store(true)
				up.Close(websocket.StatusCode(code), f.reason)
				c.closeChannel(ch.id)
				return
			}
			typ := websocket.MessageBinary
			if f.kind == kindWSText {
				typ = websocket.MessageText
			} else if f.kind != kindWSBinary {
				continue
			}
			if err := up.Write(ch.ctx, typ, f.data); err != nil {
				return // wsFromApp reports the close
			}
		}
	}
}
