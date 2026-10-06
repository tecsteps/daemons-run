package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
)

// tmuxConf is written to /etc/daemons/tmux.conf. Adapted from old daemons-run (tag
// pre-pivot-2026-09-05) gateway/src/tmux.js: tmux owns the scrollback (copy mode), mouse is
// on so the browser sends wheel reports, and the wheel bindings depend on the session's
// harness. Key bindings are server-global, so they consult per-session user options set when
// the session is created: @daemons_harness (claude|codex|opencode|shell) and @daemons_scroll
// (copy-mode|page-keys).
var tmuxConf = buildTmuxConf()

func buildTmuxConf() string {
	// History is what the user reads when the harness says so (claude, codex) or when the pane
	// is not on the alternate screen (a shell, or any line-oriented program).
	history := `#{||:#{==:#{@daemons_scroll},copy-mode},#{==:#{alternate_on},0}}`
	pageUp := `if -F "#{==:#{@daemons_harness},opencode}" { send-keys C-M-b } { send-keys PageUp }`
	pageDown := `if -F "#{==:#{@daemons_harness},opencode}" { send-keys C-M-f } { send-keys PageDown }`
	var b strings.Builder
	b.WriteString(`# Written by daemons-agent; changes are overwritten.
set -g status off
set -g escape-time 0
set -g history-limit 50000
set -g default-terminal "xterm-256color"
set -g mouse on
set -g allow-passthrough on
set -g terminal-overrides ",*:Tc"
set -g terminal-features[90] "xterm-256color:RGB"
set -g destroy-unattached off
set -g window-size latest
`)
	fmt.Fprintf(&b, "bind -T root WheelUpPane if -F \"#{pane_in_mode}\" { send-keys -M } { if -F \"%s\" { if -F \"#{>:#{history_size},0}\" { copy-mode -e ; send-keys -X scroll-up } } { %s } }\n", history, pageUp)
	fmt.Fprintf(&b, "bind -T root WheelDownPane if -F \"#{pane_in_mode}\" { send-keys -M } { if -F \"#{!:%s}\" { %s } }\n", history, pageDown)
	b.WriteString(`bind -T root PageUp if -F "#{&&:#{==:#{@daemons_scroll},copy-mode},#{>:#{history_size},0}}" { copy-mode -e ; send-keys -X page-up } { send-keys PageUp }
bind -T root PageDown if -F "#{&&:#{==:#{@daemons_scroll},copy-mode},#{pane_in_mode}}" { send-keys -X page-down } { send-keys PageDown }
`)
	// Copy mode is transient scrollback: typing leaves it and reaches the application. Page and
	// mouse bindings stay, so wheel and touch keep navigating history.
	shared := []string{"Any", "Enter", "Escape", "Tab", "BSpace", "DC", "Up", "Down", "Left", "Right", "Space", ",", ";"}
	for c := 'a'; c <= 'z'; c++ {
		shared = append(shared, "C-"+string(c))
	}
	tables := map[string][]string{
		"copy-mode":    slices.Concat(shared, strings.Split("F N P R T X f g n q r t", " ")),
		"copy-mode-vi": slices.Concat(shared, strings.Split("# $ % * / 0 1 2 3 4 5 6 7 8 9 : ? A B D E F G H J K L M N P T V W X ^ b e f g h j k l n o q r t v w z { }", " ")),
	}
	for _, table := range []string{"copy-mode", "copy-mode-vi"} {
		for _, key := range tables[table] {
			fmt.Fprintf(&b, "bind -T %s '%s' { send-keys -X cancel ; send-keys }\n", table, key)
		}
	}
	return b.String()
}

// harnesses: how the wheel scrolls each coding agent (old daemons-run config/agents.php,
// terminalScrollMode, measured 2026-08-31). claude: tmux copy mode, with Claude Code's
// alternate screen disabled so its transcript lands in tmux history. codex: copy mode (its
// main UI writes to scrollback). opencode: page keys C-M-b/C-M-f. shell: copy mode when the
// pane is not on the alternate screen, else PageUp/PageDown.
var harnesses = map[string]struct {
	scroll string
	env    []string
}{
	"claude":   {"copy-mode", []string{"CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1"}},
	"codex":    {"copy-mode", nil},
	"opencode": {"page-keys", nil},
	"shell":    {"page-keys", nil},
}

// harnessFor picks the harness: the explicit one, else the start command's program.
func harnessFor(harness, command string) string {
	if _, ok := harnesses[harness]; ok {
		return harness
	}
	if f := strings.Fields(command); len(f) > 0 {
		if _, ok := harnesses[f[0]]; ok {
			return f[0]
		}
	}
	return "shell"
}

var sessionName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

// terminals runs tmux on its own server socket as user dev.
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
	if err := os.WriteFile(t.conf, []byte(tmuxConf), 0o644); err != nil {
		return err
	}
	// A tmux server from an older agent keeps running: give it the new options and bindings.
	if _, err := t.run("source-file", t.conf); err != nil && !noServer(err) {
		return err
	}
	return nil
}

func noServer(err error) bool {
	return strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "error connecting")
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
		if noServer(err) {
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
		Harness string `json:"harness"`
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
	harness := harnessFor(p.Harness, p.Command)
	if t.has(p.Session) {
		harness = t.prepareAttach(p.Session)
	} else {
		args := []string{"new-session", "-d", "-s", p.Session, "-c", p.Cwd, "-x", strconv.Itoa(p.Cols), "-y", strconv.Itoa(p.Rows)}
		for _, e := range harnesses[harness].env {
			args = append(args, "-e", e)
		}
		if p.Command != "" {
			args = append(args, p.Command)
		}
		args = append(args, ";", "set-option", "-t", "="+p.Session+":", "@daemons_harness", harness,
			";", "set-option", "-t", "="+p.Session+":", "@daemons_scroll", harnesses[harness].scroll)
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
		go pumpTerminalOutput(c, ch, tc, t)
	}
	return M{"created": created, "harness": harness, "scroll": harnesses[harness].scroll}, after, nil
}

// prepareAttach returns an existing session's harness and, like the old gateway, clears mouse
// modes a crashed TUI left on a pane that is back at its shell (taps would type garbage).
func (t *terminals) prepareAttach(session string) string {
	out, err := t.run("display-message", "-p", "-t", "="+session+":", "#{@daemons_harness}\t#{pane_current_command}\t#{pane_tty}")
	f := strings.Split(strings.TrimSpace(out), "\t")
	if err != nil || len(f) != 3 {
		return "shell"
	}
	switch f[1] {
	case "bash", "sh", "zsh", "dash":
		if strings.HasPrefix(f[2], "/dev/") {
			os.WriteFile(f[2], []byte("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l"), 0)
		}
	}
	if _, ok := harnesses[f[0]]; ok {
		return f[0]
	}
	return "shell"
}

// handleTerminalCapture returns a session's recent history as plain text (the browser's
// "Select" sheet; tmux holds the scrollback, the browser only sees the screen).
func handleTerminalCapture(_ context.Context, _ *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Session string `json:"session"`
		Lines   int    `json:"lines"`
	}
	json.Unmarshal(raw, &p)
	t := currentTerminals()
	if !sessionName.MatchString(p.Session) || !t.has(p.Session) {
		return nil, nil, perr("not_found", "no session %q", p.Session)
	}
	if p.Lines <= 0 {
		p.Lines = 2000
	}
	out, err := t.run("capture-pane", "-p", "-J", "-S", "-"+strconv.Itoa(min(p.Lines, 10000)), "-t", "="+p.Session+":")
	if err != nil {
		return nil, nil, err
	}
	out = strings.TrimRight(out, " \n")
	if len(out) > maxCapture {
		out = out[len(out)-maxCapture:]
		if i := strings.IndexByte(out, '\n'); i >= 0 {
			out = out[i+1:]
		}
	}
	return M{"text": out}, nil, nil
}

const maxCapture = 512 << 10

// attach starts a tmux attach client on a fresh PTY owned by user dev.
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
