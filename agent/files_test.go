package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func op(t *testing.T, params M) (M, error) {
	t.Helper()
	raw, _ := json.Marshal(params)
	return fileOp(raw)
}

func mustOp(t *testing.T, params M) M {
	t.Helper()
	res, err := op(t, params)
	if err != nil {
		t.Fatalf("%v: %v", params["type"], err)
	}
	return res
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var pe *protoError
	if !errors.As(err, &pe) || pe.Code != code {
		t.Fatalf("want error %s, got %v", code, err)
	}
}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func TestFileOps(t *testing.T) {
	dir, _ := filepath.EvalSymlinks(t.TempDir())
	file := filepath.Join(dir, "a.txt")

	w := mustOp(t, M{"type": "file.write", "path": file, "data": b64("hello "), "truncate": true})
	mustOp(t, M{"type": "file.write", "path": file, "data": b64("world"), "offset": 6})
	r := mustOp(t, M{"type": "file.read", "path": file})
	if data, _ := base64.StdEncoding.DecodeString(r["data"].(string)); string(data) != "hello world" || r["eof"] != true {
		t.Fatalf("read %q eof=%v", data, r["eof"])
	}
	r = mustOp(t, M{"type": "file.read", "path": file, "offset": 6, "length": 3})
	if data, _ := base64.StdEncoding.DecodeString(r["data"].(string)); string(data) != "wor" || r["eof"] != false {
		t.Fatalf("partial read %q eof=%v", data, r["eof"])
	}

	// Conflict: the file changed since the editor opened it.
	_, err := op(t, M{"type": "file.write", "path": file, "data": b64("x"), "truncate": true, "expected_mtime_ms": w["mtime_ms"].(int64) - 5000})
	wantCode(t, err, "conflict")
	st := mustOp(t, M{"type": "file.stat", "path": file})
	mustOp(t, M{"type": "file.write", "path": file, "data": b64("x"), "truncate": true, "expected_mtime_ms": st["mtime_ms"]})
	if st := mustOp(t, M{"type": "file.stat", "path": file}); st["size"] != int64(1) || st["type"] != "file" {
		t.Fatalf("stat %v", st)
	}

	mustOp(t, M{"type": "file.mkdir", "path": filepath.Join(dir, "sub/deep")})
	os.WriteFile(filepath.Join(dir, ".hidden"), nil, 0o644)
	os.Symlink(file, filepath.Join(dir, "link"))
	list := mustOp(t, M{"type": "file.list", "path": dir})["entries"].([]M)
	names := []string{}
	for _, e := range list {
		names = append(names, e["name"].(string)+":"+e["type"].(string))
	}
	if got := len(names); got != 3 || names[0] != "sub:dir" || names[1] != "a.txt:file" || names[2] != "link:link" {
		t.Fatalf("list %v", names)
	}
	if n := len(mustOp(t, M{"type": "file.list", "path": dir, "hidden": true})["entries"].([]M)); n != 4 {
		t.Fatalf("hidden list has %d entries", n)
	}

	_, err = op(t, M{"type": "file.rename", "from": file, "to": filepath.Join(dir, "link")})
	wantCode(t, err, "exists")
	mustOp(t, M{"type": "file.rename", "from": file, "to": filepath.Join(dir, "b.txt")})
	_, err = op(t, M{"type": "file.read", "path": file})
	wantCode(t, err, "not_found")

	_, err = op(t, M{"type": "file.delete", "path": filepath.Join(dir, "sub")})
	wantCode(t, err, "conflict") // not empty
	mustOp(t, M{"type": "file.delete", "path": filepath.Join(dir, "sub"), "recursive": true})
	if _, err := os.Stat(filepath.Join(dir, "sub")); !os.IsNotExist(err) {
		t.Fatal("sub still exists")
	}

	_, err = op(t, M{"type": "file.list", "path": "relative/path"})
	wantCode(t, err, "bad_request")
	_, err = op(t, M{"type": "file.read", "path": dir})
	wantCode(t, err, "bad_request")
	_, err = op(t, M{"type": "file.mkdir", "path": filepath.Join(dir, "b.txt")})
	wantCode(t, err, "exists")
}

func TestFileOpsPermission(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores permissions")
	}
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")
	os.Mkdir(locked, 0o000)
	defer os.Chmod(locked, 0o755)
	_, err := op(t, M{"type": "file.list", "path": locked})
	wantCode(t, err, "forbidden")
}
