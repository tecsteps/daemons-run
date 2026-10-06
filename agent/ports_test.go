package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestListPorts(t *testing.T) {
	root := t.TempDir()
	for _, f := range []string{"tcp", "tcp6"} {
		data, err := os.ReadFile(filepath.Join("testdata/proc/net", f))
		if err != nil {
			t.Fatal(err)
		}
		os.MkdirAll(filepath.Join(root, "net"), 0o755)
		os.WriteFile(filepath.Join(root, "net", f), data, 0o644)
	}
	proc := func(pid, comm, cwd string, inodes ...string) {
		fd := filepath.Join(root, pid, "fd")
		os.MkdirAll(fd, 0o755)
		os.WriteFile(filepath.Join(root, pid, "comm"), []byte(comm+"\n"), 0o644)
		os.Symlink(cwd, filepath.Join(root, pid, "cwd"))
		os.Symlink("/dev/null", filepath.Join(fd, "0"))
		for i, inode := range inodes {
			os.Symlink("socket:["+inode+"]", filepath.Join(fd, string(rune('3'+i))))
		}
	}
	proc("4242", "node", "/projects/shop", "1001")
	proc("17", "sshd", "/", "1002", "2002")
	proc("99", "daemons-agent", "/", "1004") // the agent itself is excluded
	proc("300", "node", "/projects/api", "2001")

	got, err := listPorts(root, 99)
	if err != nil {
		t.Fatal(err)
	}
	want := []portInfo{
		{Port: 22, Address: "0.0.0.0", Process: "sshd", PID: 17, Cwd: "/"},
		{Port: 22, Address: "::", Process: "sshd", PID: 17, Cwd: "/"},
		{Port: 3000, Address: "::1", Process: "node", PID: 300, Cwd: "/projects/api"},
		{Port: 5173, Address: "127.0.0.1", Process: "node", PID: 4242, Cwd: "/projects/shop"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestParseProcIP(t *testing.T) {
	cases := map[string]string{
		"0100007F":                         "127.0.0.1",
		"00000000":                         "0.0.0.0",
		"00000000000000000000000001000000": "::1",
		"0000000000000000FFFF00000100007F": "127.0.0.1", // v4-mapped
	}
	for in, want := range cases {
		if got := parseProcIP(in).String(); got != want {
			t.Errorf("%s: got %s want %s", in, got, want)
		}
	}
}
