package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

// tmuxConf is written to /etc/daemons/tmux.conf. The terminal-overrides line keeps tmux off
// the outer alternate screen so output also lands in the browser's scrollback.
const tmuxConf = `# Written by daemons-agent; changes are overwritten.
set -g status off
set -g escape-time 0
set -g history-limit 50000
set -g default-terminal "xterm-256color"
set -g mouse off
set -ga terminal-overrides ",xterm*:smcup@:rmcup@"
set -as terminal-features ",xterm-256color:RGB"
`

var sessionName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

// terminals runs tmux on its own server socket as user daemon.
type terminals struct {
	socket string
	conf   string
}

func defaultTerminals() *terminals {
	return &terminals{socket: "daemons", conf: "/etc/daemons/tmux.conf"}
}

func (t *terminals) writeConf() error {
	if old, err := os.ReadFile(t.conf); err == nil && string(old) == tmuxConf {
		return nil
	}
	if err := os.MkdirAll(strings.TrimSuffix(t.conf, "/tmux.conf"), 0o755); err != nil {
		return err
	}
	return os.WriteFile(t.conf, []byte(tmuxConf), 0o644)
}

func (t *terminals) cmd(args ...string) (*exec.Cmd, error) {
	cmd := exec.Command("tmux", append([]string{"-L", t.socket, "-f", t.conf}, args...)...)
	if err := userCommand(cmd, false); err != nil {
		return nil, perr("unavailable", "%v", err)
	}
	cmd.Dir = "/"
	return cmd, nil
}

func (t *terminals) run(args ...string) (string, error) {
	cmd, err := t.cmd(args...)
	if err != nil {
		return "", err
	}
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("tmux %s: %s", args[0], strings.TrimSpace(stderr.String()))
	}
	return out.String(), nil
}

func (t *terminals) has(name string) bool {
	_, err := t.run("has-session", "-t", "="+name)
	return err == nil
}

type sessionInfo struct {
	Name     string `json:"name"`
	Created  int64  `json:"created"`
	Attached int    `json:"attached"`
	Cwd      string `json:"cwd"`
	Command  string `json:"command"`
}

func (t *terminals) list() ([]sessionInfo, error) {
	out, err := t.run("list-sessions", "-F",
		"#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_path}\t#{pane_current_command}")
	sessions := []sessionInfo{}
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "error connecting") {
			return sessions, nil
		}
		return nil, err
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Split(line, "\t")
		if len(f) != 5 {
			continue
		}
		created, _ := strconv.ParseInt(f[1], 10, 64)
		attached, _ := strconv.Atoi(f[2])
		sessions = append(sessions, sessionInfo{Name: f[0], Created: created, Attached: attached, Cwd: f[3], Command: f[4]})
	}
	return sessions, nil
}

// termClient is one tmux attach client on a PTY, bound to a channel.
type termClient struct {
	ptmx *os.File
	cmd  *exec.Cmd

	mu      sync.Mutex
	session string
}

func (tc *termClient) name() string {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.session
}

func handleTerminalList(context.Context, *conn, json.RawMessage, *channel) (M, func(), error) {
	s, err := currentTerminals().list()
	if err != nil {
		return nil, nil, err
	}
	return M{"sessions": s}, nil, nil
}

// currentTerminals lets tests swap the tmux socket and config.
var currentTerminals = defaultTerminals

func handleTerminalOpen(ctx context.Context, c *conn, raw json.RawMessage, ch *channel) (M, func(), error) {
	var p struct {
		Session string `json:"session"`
		Cwd     string `json:"cwd"`
		Cols    int    `json:"cols"`
		Rows    int    `json:"rows"`
		Command string `json:"command"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || !sessionName.MatchString(p.Session) {
		return nil, nil, perr("bad_request", "session must match [A-Za-z0-9_-]{1,32}")
	}
	if p.Cwd == "" {
		p.Cwd = "/projects"
	}
	p.Cols, p.Rows = clamp(p.Cols, 80), clamp(p.Rows, 24)
	t := currentTerminals()
	created := false
	var scrollback string
	if t.has(p.Session) {
		out, err := t.run("capture-pane", "-p", "-e", "-J", "-S", "-5000", "-t", "="+p.Session+":")
		if err == nil {
			scrollback = strings.ReplaceAll(strings.TrimRight(out, "\n"), "\n", "\r\n") + "\r\n"
		}
	} else {
		args := []string{"new-session", "-d", "-s", p.Session, "-c", p.Cwd, "-x", strconv.Itoa(p.Cols), "-y", strconv.Itoa(p.Rows)}
		if p.Command != "" {
			args = append(args, p.Command)
		}
		if _, err := t.run(args...); err != nil && !t.has(p.Session) {
			return nil, nil, perr("internal", "%v", err)
		}
		created = true
	}
	tc, err := t.attach(p.Session, p.Cols, p.Rows)
	if err != nil {
		return nil, nil, err
	}
	ch.term.Store(tc)
	after := func() {
		go pumpTerminalInput(ch, tc)
		go func() {
			if scrollback != "" {
				sendChunks(ch, kindTerminal, []byte(scrollback))
			}
			pumpTerminalOutput(c, ch, tc, t)
		}()
	}
	return M{"created": created}, after, nil
}

// attach starts a tmux attach client on a fresh PTY owned by user daemon.
func (t *terminals) attach(session string, cols, rows int) (*termClient, error) {
	cmd, err := t.cmd("attach-session", "-t", "="+session)
	if err != nil {
		return nil, err
	}
	ptmx, tty, err := pty.Open()
	if err != nil {
		return nil, perr("internal", "pty: %v", err)
	}
	defer tty.Close()
	if cred := cmd.SysProcAttr.Credential; cred != nil {
		tty.Chown(int(cred.Uid), int(cred.Gid))
	}
	pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	cmd.Stdin, cmd.Stdout, cmd.Stderr = tty, tty, tty
	cmd.SysProcAttr.Setsid = true
	cmd.SysProcAttr.Setctty = true
	if err := cmd.Start(); err != nil {
		ptmx.Close()
		return nil, perr("internal", "tmux attach: %v", err)
	}
	return &termClient{ptmx: ptmx, cmd: cmd, session: session}, nil
}

// pumpTerminalOutput copies PTY output to the channel. A full channel queue blocks this
// loop, so the PTY stops being read until the control plane catches up.
func pumpTerminalOutput(c *conn, ch *channel, tc *termClient, t *terminals) {
	buf := make([]byte, 32<<10)
	for {
		n, err := tc.ptmx.Read(buf)
		if n > 0 && ch.send(kindTerminal, buf[:n]) != nil {
			break
		}
		if err != nil {
			break
		}
	}
	tc.cmd.Wait()
	if ch.ctx.Err() == nil { // the client ended on its own, not by terminal.close
		name := tc.name()
		ch.sendJSON(M{"type": "terminal.exit", "channel": ch.id, "session": name, "session_ended": !t.has(name)})
		c.closeChannel(ch.id)
	}
}

func pumpTerminalInput(ch *channel, tc *termClient) {
	defer func() {
		// Detach: end the attach client; the tmux session keeps running.
		tc.cmd.Process.Signal(syscall.SIGHUP)
		tc.ptmx.Close()
	}()
	for {
		select {
		case <-ch.ctx.Done():
			return
		case f := <-ch.in:
			if f.kind == kindTerminal {
				if _, err := tc.ptmx.Write(f.data); err != nil {
					return
				}
			}
		}
	}
}

func sendChunks(ch *channel, kind byte, b []byte) error {
	for len(b) > 0 {
		n := min(len(b), maxPayload)
		if err := ch.send(kind, b[:n]); err != nil {
			return err
		}
		b = b[n:]
	}
	return nil
}

func clamp(v, def int) int {
	if v <= 0 {
		return def
	}
	return min(v, 1000)
}

func handleTerminalResize(_ context.Context, c *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Channel uint32 `json:"channel"`
		Cols    int    `json:"cols"`
		Rows    int    `json:"rows"`
	}
	json.Unmarshal(raw, &p)
	var tc *termClient
	if ch := c.channel(p.Channel); ch != nil {
		tc = ch.term.Load()
	}
	if tc == nil {
		return nil, nil, perr("not_found", "no terminal on channel %d", p.Channel)
	}
	err := pty.Setsize(tc.ptmx, &pty.Winsize{Cols: uint16(clamp(p.Cols, 80)), Rows: uint16(clamp(p.Rows, 24))})
	return nil, nil, err
}

func handleTerminalClose(_ context.Context, c *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Channel uint32 `json:"channel"`
	}
	json.Unmarshal(raw, &p)
	c.closeChannel(p.Channel)
	return nil, nil, nil
}

func handleTerminalKill(_ context.Context, _ *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Session string `json:"session"`
	}
	json.Unmarshal(raw, &p)
	t := currentTerminals()
	if !sessionName.MatchString(p.Session) || !t.has(p.Session) {
		return nil, nil, perr("not_found", "no session %q", p.Session)
	}
	_, err := t.run("kill-session", "-t", "="+p.Session)
	return nil, nil, err
}

func handleTerminalRename(_ context.Context, c *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Session string `json:"session"`
		Name    string `json:"name"`
	}
	json.Unmarshal(raw, &p)
	if !sessionName.MatchString(p.Name) {
		return nil, nil, perr("bad_request", "name must match [A-Za-z0-9_-]{1,32}")
	}
	t := currentTerminals()
	if !sessionName.MatchString(p.Session) || !t.has(p.Session) {
		return nil, nil, perr("not_found", "no session %q", p.Session)
	}
	if t.has(p.Name) {
		return nil, nil, perr("exists", "session %q exists", p.Name)
	}
	if _, err := t.run("rename-session", "-t", "="+p.Session, p.Name); err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	for _, ch := range c.channels {
		if tc := ch.term.Load(); tc != nil {
			tc.mu.Lock()
			if tc.session == p.Session {
				tc.session = p.Name
			}
			tc.mu.Unlock()
		}
	}
	c.mu.Unlock()
	return nil, nil, nil
}
