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
	if r["ok"] != true || r["created"] != true {
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

	// Detach, then reattach: the session survives and its scrollback comes first.
	if r := c.call("c4", M{"type": "terminal.close", "channel": 1}); r["ok"] != true {
		t.Fatalf("close: %v", r)
	}
	r = c.call("c5", M{"type": "terminal.open", "channel": 2, "session": "work", "cols": 100, "rows": 30})
	if r["created"] != false {
		t.Fatalf("reopen: %v", r)
	}
	output(2, "marker-42")

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
