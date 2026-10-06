package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"syscall"
	"time"
)

const execOutputCap = 1 << 20

// cappedBuffer keeps the first max bytes and remembers whether more came.
type cappedBuffer struct {
	bytes.Buffer
	max       int
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	if room := b.max - b.Len(); room < len(p) {
		b.truncated = true
		b.Buffer.Write(p[:max(room, 0)])
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

func handleExec(ctx context.Context, _ *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	var p struct {
		Command   string `json:"command"`
		Cwd       string `json:"cwd"`
		User      string `json:"user"`
		TimeoutMs int    `json:"timeout_ms"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.Command == "" {
		return nil, nil, perr("bad_request", "command is required")
	}
	if p.User != "" && p.User != "dev" && p.User != "root" {
		return nil, nil, perr("bad_request", "user must be dev or root")
	}
	if p.Cwd == "" {
		p.Cwd = "/projects"
	}
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond
	if p.TimeoutMs <= 0 {
		timeout = 30 * time.Second
	}
	timeout = min(timeout, 120*time.Second)
	res, err := runCommand(ctx, p.Command, p.Cwd, p.User == "root", timeout)
	return res, nil, err
}

func runCommand(ctx context.Context, command, cwd string, asRoot bool, timeout time.Duration) (M, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/bash", "-lc", command)
	if err := userCommand(cmd, asRoot); err != nil {
		return nil, perr("unavailable", "%v", err)
	}
	cmd.Dir = cwd
	cmd.SysProcAttr.Setpgid = true
	// Kill the whole process group, not just bash.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	stdout := &cappedBuffer{max: execOutputCap}
	stderr := &cappedBuffer{max: execOutputCap}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	code := 0
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code = exitErr.ExitCode()
	} else if err != nil {
		return nil, perr("bad_request", "%v", err)
	}
	return M{"exit_code": code, "stdout": stdout.String(), "stderr": stderr.String(),
		"truncated": stdout.truncated || stderr.truncated}, nil
}
