package main

// File operations run as user daemon. When the agent is root it re-executes itself as
// daemon ("daemons-agent file-op", one request on stdin, one reply on stdout), so the
// kernel enforces daemon's permissions and new files belong to daemon. When the agent is
// not root (development, tests) the operation runs in-process as the current user.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

const fileReadMax = 524288

var fileOpTypes = []string{"file.list", "file.stat", "file.read", "file.write", "file.delete", "file.mkdir", "file.rename"}

type fileReply struct {
	OK     bool        `json:"ok"`
	Result M           `json:"result,omitempty"`
	Error  *protoError `json:"error,omitempty"`
}

func handleFileOp(ctx context.Context, _ *conn, raw json.RawMessage, _ *channel) (M, func(), error) {
	if os.Geteuid() != 0 {
		res, err := fileOp(raw)
		return res, nil, err
	}
	self, err := os.Executable()
	if err != nil {
		return nil, nil, err
	}
	cmd := exec.CommandContext(ctx, self, "file-op")
	if err := userCommand(cmd, false); err != nil {
		return nil, nil, perr("unavailable", "%v", err)
	}
	cmd.Dir = "/"
	cmd.Stdin = bytes.NewReader(raw)
	out, err := cmd.Output()
	var r fileReply
	if jerr := json.Unmarshal(out, &r); jerr != nil {
		return nil, nil, perr("internal", "file-op: %v", err)
	}
	if !r.OK {
		return nil, nil, r.Error
	}
	return r.Result, nil, nil
}

func fileOpMain() int {
	raw, _ := io.ReadAll(os.Stdin)
	res, err := fileOp(raw)
	r := fileReply{OK: err == nil, Result: res}
	if err != nil {
		r.Error = toProto(err)
	}
	json.NewEncoder(os.Stdout).Encode(r)
	return 0
}

type fileParams struct {
	Type            string `json:"type"`
	Path            string `json:"path"`
	Hidden          bool   `json:"hidden"`
	Offset          int64  `json:"offset"`
	Length          int64  `json:"length"`
	Data            string `json:"data"`
	Truncate        bool   `json:"truncate"`
	ExpectedMtimeMs *int64 `json:"expected_mtime_ms"`
	Recursive       bool   `json:"recursive"`
	From            string `json:"from"`
	To              string `json:"to"`
}

func fileOp(raw []byte) (M, error) {
	var p fileParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, perr("bad_request", "%v", err)
	}
	if p.Type == "file.rename" {
		from, err1 := cleanPath(p.From)
		to, err2 := cleanPath(p.To)
		if err := errors.Join(err1, err2); err != nil {
			return nil, err
		}
		return fileRename(from, to)
	}
	path, err := cleanPath(p.Path)
	if err != nil {
		return nil, err
	}
	switch p.Type {
	case "file.list":
		return fileList(path, p.Hidden)
	case "file.stat":
		st, err := os.Stat(path)
		if err != nil {
			return nil, fsErr(err)
		}
		return entryInfo(st), nil
	case "file.read":
		return fileRead(path, p.Offset, p.Length)
	case "file.write":
		return fileWrite(path, p)
	case "file.delete":
		if path == "/" {
			return nil, perr("bad_request", "refusing to delete /")
		}
		if _, err := os.Lstat(path); err != nil {
			return nil, fsErr(err)
		}
		if p.Recursive {
			return nil, fsErr(os.RemoveAll(path))
		}
		return nil, fsErr(os.Remove(path))
	case "file.mkdir":
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			return nil, perr("exists", "%s exists and is not a folder", path)
		}
		return nil, fsErr(os.MkdirAll(path, 0o755))
	}
	return nil, perr("unsupported", "unknown type %q", p.Type)
}

func cleanPath(p string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", perr("bad_request", "path must be absolute: %q", p)
	}
	return filepath.Clean(p), nil
}

func fsErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, syscall.ENOTEMPTY): // before ErrExist, which also matches it
		return perr("conflict", "%v", err)
	case errors.Is(err, fs.ErrNotExist):
		return perr("not_found", "%v", err)
	case errors.Is(err, fs.ErrExist):
		return perr("exists", "%v", err)
	case errors.Is(err, fs.ErrPermission):
		return perr("forbidden", "%v", err)
	case errors.Is(err, syscall.ENOTDIR), errors.Is(err, syscall.EISDIR):
		return perr("bad_request", "%v", err)
	}
	return perr("internal", "%v", err)
}

func entryInfo(st fs.FileInfo) M {
	typ := "file"
	switch {
	case st.Mode()&fs.ModeSymlink != 0:
		typ = "link"
	case st.IsDir():
		typ = "dir"
	}
	return M{"type": typ, "size": st.Size(), "mtime_ms": st.ModTime().UnixMilli(), "mode": int(st.Mode().Perm())}
}

func fileList(path string, hidden bool) (M, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fsErr(err)
	}
	out := []M{}
	for _, e := range entries {
		if !hidden && strings.HasPrefix(e.Name(), ".") {
			continue
		}
		st, err := e.Info()
		if err != nil {
			continue
		}
		m := entryInfo(st)
		m["name"] = e.Name()
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		di, dj := out[i]["type"] == "dir", out[j]["type"] == "dir"
		if di != dj {
			return di
		}
		return strings.ToLower(out[i]["name"].(string)) < strings.ToLower(out[j]["name"].(string))
	})
	return M{"entries": out}, nil
}

func fileRead(path string, offset, length int64) (M, error) {
	if length <= 0 || length > fileReadMax {
		length = fileReadMax
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fsErr(err)
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, fsErr(err)
	}
	if st.IsDir() {
		return nil, perr("bad_request", "%s is a folder", path)
	}
	buf := make([]byte, length)
	n, err := f.ReadAt(buf, offset)
	if err != nil && err != io.EOF {
		return nil, fsErr(err)
	}
	return M{"data": base64.StdEncoding.EncodeToString(buf[:n]), "size": st.Size(),
		"mtime_ms": st.ModTime().UnixMilli(), "eof": offset+int64(n) >= st.Size()}, nil
}

func fileWrite(path string, p fileParams) (M, error) {
	data, err := base64.StdEncoding.DecodeString(p.Data)
	if err != nil {
		return nil, perr("bad_request", "data is not base64")
	}
	if p.ExpectedMtimeMs != nil {
		if st, err := os.Stat(path); err == nil && st.ModTime().UnixMilli() != *p.ExpectedMtimeMs {
			return nil, perr("conflict", "%s changed on disk", path)
		}
	}
	flags := os.O_WRONLY | os.O_CREATE
	if p.Truncate {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(path, flags, 0o644)
	if err != nil {
		return nil, fsErr(err)
	}
	if _, err := f.WriteAt(data, p.Offset); err != nil {
		f.Close()
		return nil, fsErr(err)
	}
	if err := f.Close(); err != nil {
		return nil, fsErr(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, fsErr(err)
	}
	return M{"size": st.Size(), "mtime_ms": st.ModTime().UnixMilli()}, nil
}

func fileRename(from, to string) (M, error) {
	if _, err := os.Lstat(from); err != nil {
		return nil, fsErr(err)
	}
	if _, err := os.Lstat(to); err == nil {
		return nil, perr("exists", "%s exists", to)
	}
	return nil, fsErr(os.Rename(from, to))
}

// handleFileArchive streams a .tar.gz of a folder on the channel, as user daemon.
func handleFileArchive(_ context.Context, c *conn, raw json.RawMessage, ch *channel) (M, func(), error) {
	var p struct {
		Path string `json:"path"`
	}
	json.Unmarshal(raw, &p)
	path, err := cleanPath(p.Path)
	if err != nil {
		return nil, nil, err
	}
	if path == "/" {
		return nil, nil, perr("bad_request", "refusing to archive /")
	}
	cmd := exec.CommandContext(ch.ctx, "tar", "-czf", "-", "-C", filepath.Dir(path), filepath.Base(path))
	if err := userCommand(cmd, false); err != nil {
		return nil, nil, perr("unavailable", "%v", err)
	}
	cmd.Dir = "/"
	stderr := &cappedBuffer{max: 4096}
	cmd.Stderr = stderr
	stdout, _ := cmd.StdoutPipe()
	if st, err := os.Stat(path); err != nil {
		return nil, nil, fsErr(err)
	} else if !st.IsDir() {
		return nil, nil, perr("bad_request", "%s is not a folder", path)
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, perr("internal", "tar: %v", err)
	}
	after := func() {
		defer c.closeChannel(ch.id)
		streamErr := streamBody(ch, stdout)
		err := cmd.Wait()
		var exitErr *exec.ExitError
		// tar exits 1 when a file changed while it was read; the archive is still usable.
		if streamErr == nil && (err == nil || (errors.As(err, &exitErr) && exitErr.ExitCode() == 1)) {
			ch.sendJSON(M{"type": "http.end", "channel": ch.id})
			return
		}
		if ch.ctx.Err() == nil {
			ch.sendJSON(M{"type": "http.error", "channel": ch.id, "code": "internal",
				"message": strings.TrimSpace("tar failed: " + stderr.String())})
		}
	}
	return nil, after, nil
}

// streamBody sends r as kind 0x02 frames, waiting for acks once 1 MiB is unacknowledged.
func streamBody(ch *channel, r io.Reader) error {
	buf := make([]byte, maxPayload)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if werr := ch.win.take(ch.ctx, int64(n)); werr != nil {
				return werr
			}
			if werr := ch.send(kindHTTP, buf[:n]); werr != nil {
				return werr
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}
