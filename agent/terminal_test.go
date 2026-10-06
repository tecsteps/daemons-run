package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTerminals(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	terms := &terminals{socket: fmt.Sprintf("daemons-test-%d", os.Getpid()), conf: filepath.Join(t.TempDir(), "tmux.conf")}
	if err := terms.writeConf(); err != nil {
		t.Fatal(err)
	}
	currentTerminals = func() *terminals { return terms }
	t.Cleanup(func() {
		exec.Command("tmux", "-L", terms.socket, "kill-server").Run()
		currentTerminals = defaultTerminals
	})
	f := newFakeCP(t)
	startAgent(t, f)
	c := f.accept()
	dir := t.TempDir()

	// output collects terminal bytes on ch until want shows up.
	output := func(ch uint32, want string) string {
		t.Helper()
		var buf bytes.Buffer
		deadline := time.Now().Add(5 * time.Second)
		for !strings.Contains(buf.String(), want) {
			m, err := c.next(time.Until(deadline))
			if err != nil {
				t.Fatalf("waiting for %q, got %q", want, buf.String())
			}
			if !m.text && m.kind == kindTerminal && m.ch == ch {
				buf.Write(m.payload)
			}
		}
		return buf.String()
	}

	r := c.call("c1", M{"type": "terminal.open", "channel": 1, "session": "work", "cwd": dir, "cols": 100, "rows": 30})
	if r["ok"] != true || r["created"] != true || r["harness"] != "shell" || r["scroll"] != "page-keys" {
		t.Fatalf("open: %v", r)
	}
	c.sendFrame(kindTerminal, 1, []byte("echo marker-$((40+2))\r"))
	output(1, "marker-42")

	list := c.call("c2", M{"type": "terminal.list"})
	sessions := list["sessions"].([]any)
	if len(sessions) != 1 || sessions[0].(map[string]any)["name"] != "work" || sessions[0].(map[string]any)["attached"] != 1.0 {
		t.Fatalf("list: %v", list)
	}
	if r := c.call("c3", M{"type": "terminal.resize", "channel": 1, "cols": 120, "rows": 40}); r["ok"] != true {
		t.Fatalf("resize: %v", r)
	}

	// tmux owns the history: a wheel report scrolls it in copy mode, typing leaves copy mode.
	c.sendFrame(kindTerminal, 1, []byte("seq -f row-%g 1 300\r"))
	output(1, "row-300")
	tmux := func(args ...string) string {
		out, _ := terms.run(args...)
		return strings.TrimSpace(out)
	}
	for range 3 {
		c.sendFrame(kindTerminal, 1, []byte("\x1b[<64;10;10M"))
	}
	waitFor(t, func() bool { return tmux("display", "-p", "-t", "=work:", "#{pane_in_mode}") == "1" })
	if top := tmux("display", "-p", "-t", "=work:", "#{scroll_position}"); top == "" || top == "0" {
		t.Fatalf("wheel did not scroll the history: scroll_position %q", top)
	}
	c.sendFrame(kindTerminal, 1, []byte("e"))
	waitFor(t, func() bool { return tmux("display", "-p", "-t", "=work:", "#{pane_in_mode}") == "0" })
	c.sendFrame(kindTerminal, 1, []byte("cho left-copy-mode\r"))
	output(1, "left-copy-mode")
	cap := c.call("c2b", M{"type": "terminal.capture", "session": "work", "lines": 500})
	if text, _ := cap["text"].(string); !strings.Contains(text, "row-1\n") || !strings.Contains(text, "left-copy-mode") {
		t.Fatalf("capture: %v", cap)
	}

	// Detach, then reattach: the session survives and tmux redraws its screen.
	if r := c.call("c4", M{"type": "terminal.close", "channel": 1}); r["ok"] != true {
		t.Fatalf("close: %v", r)
	}
	r = c.call("c5", M{"type": "terminal.open", "channel": 2, "session": "work", "cols": 100, "rows": 30})
	if r["created"] != false {
		t.Fatalf("reopen: %v", r)
	}
	output(2, "left-copy-mode")

	// A coding agent's harness is stored on its session and returned on every attach.
	r = c.call("c5b", M{"type": "terminal.open", "channel": 4, "session": "agent", "cwd": dir, "command": "bash", "harness": "claude"})
	if r["harness"] != "claude" || r["scroll"] != "copy-mode" {
		t.Fatalf("open claude: %v", r)
	}
	if env := tmux("show-environment", "-t", "=agent", "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN"); env != "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1" {
		t.Fatalf("claude env: %q", env)
	}
	c.call("c5c", M{"type": "terminal.close", "channel": 4})
	if r := c.call("c5d", M{"type": "terminal.open", "channel": 5, "session": "agent"}); r["harness"] != "claude" || r["created"] != false {
		t.Fatalf("reopen claude: %v", r)
	}
	c.call("c5e", M{"type": "terminal.kill", "session": "agent"})

	// OpenCode on the alternate screen gets its own page keys (C-M-b) for the wheel.
	c.call("c5f", M{"type": "terminal.open", "channel": 6, "session": "oc", "cwd": dir, "command": "bash", "harness": "opencode"})
	c.sendFrame(kindTerminal, 6, []byte("printf '\\e[?1049h'; stty -echo; cat -v\r"))
	waitFor(t, func() bool {
		return tmux("display", "-p", "-t", "=oc:", "#{alternate_on}#{pane_current_command}") == "1cat"
	})
	c.sendFrame(kindTerminal, 6, []byte("\x1b[<64;10;10M\r"))
	output(6, "^[^B")
	c.call("c5g", M{"type": "terminal.kill", "session": "oc"})
	if _, err := terms.run("source-file", terms.conf); err != nil {
		t.Fatalf("tmux.conf does not load cleanly: %v", err)
	}

	if r := c.call("c6", M{"type": "terminal.open", "channel": 3, "session": "bad name!"}); r["ok"] != false {
		t.Fatalf("bad session name accepted: %v", r)
	}
	if r := c.call("c7", M{"type": "terminal.rename", "session": "work", "name": "renamed"}); r["ok"] != true {
		t.Fatalf("rename: %v", r)
	}
	if r := c.call("c8", M{"type": "terminal.kill", "session": "renamed"}); r["ok"] != true {
		t.Fatalf("kill: %v", r)
	}
	exit := c.waitFor(func(m msg) bool { return m.m["type"] == "terminal.exit" }).m
	if exit["channel"] != 2.0 || exit["session"] != "renamed" || exit["session_ended"] != true {
		t.Fatalf("exit: %v", exit)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in 5s")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestHarnessFor(t *testing.T) {
	for _, tc := range [][3]string{
		{"claude", "", "claude"}, {"", "codex --yolo", "codex"}, {"", "opencode", "opencode"},
		{"", "htop", "shell"}, {"nope", "", "shell"}, {"", "", "shell"},
	} {
		if got := harnessFor(tc[0], tc[1]); got != tc[2] {
			t.Errorf("harnessFor(%q, %q) = %q, want %q", tc[0], tc[1], got, tc[2])
		}
	}
}

func TestFileArchive(t *testing.T) {
	if _, err := exec.LookPath("tar"); err != nil {
		t.Skip("tar not installed")
	}
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "shop/src"), 0o755)
	os.WriteFile(filepath.Join(dir, "shop/src/app.js"), []byte("console.log(1)"), 0o644)
	f := newFakeCP(t)
	startAgent(t, f)
	c := f.accept()

	if r := c.call("c1", M{"type": "file.archive", "channel": 5, "path": filepath.Join(dir, "shop")}); r["ok"] != true {
		t.Fatalf("archive: %v", r)
	}
	var body bytes.Buffer
	for {
		m := c.waitFor(func(m msg) bool { return (!m.text && m.ch == 5) || m.m["channel"] == 5.0 })
		if !m.text {
			body.Write(m.payload)
			continue
		}
		if m.m["type"] != "http.end" {
			t.Fatalf("unexpected %v", m.m)
		}
		break
	}
	zr, err := gzip.NewReader(&body)
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(zr)
	found := ""
	for {
		h, err := tr.Next()
		if err != nil {
			break
		}
		if h.Name == "shop/src/app.js" {
			b, _ := io.ReadAll(tr)
			found = string(b)
		}
	}
	if found != "console.log(1)" {
		t.Fatalf("archive content %q", found)
	}
	if r := c.call("c2", M{"type": "file.archive", "channel": 6, "path": filepath.Join(dir, "missing")}); r["ok"] != false {
		t.Fatalf("missing folder: %v", r)
	}
}
