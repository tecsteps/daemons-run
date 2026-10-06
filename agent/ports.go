package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type portInfo struct {
	Port    int    `json:"port"`
	Address string `json:"address"`
	Process string `json:"process"`
	PID     int    `json:"pid"`
	Cwd     string `json:"cwd"`
}

type listenSocket struct {
	addr  string
	port  int
	inode string
}

func handlePorts(context.Context, *conn, json.RawMessage, *channel) (M, func(), error) {
	ports, err := listPorts("/proc", os.Getpid())
	if err != nil {
		return nil, nil, err
	}
	return M{"ports": ports}, nil, nil
}

// listPorts reads listening TCP sockets from procRoot (normally /proc) and maps them to
// processes through /proc/<pid>/fd. Off Linux it returns an empty list.
func listPorts(procRoot string, selfPID int) ([]portInfo, error) {
	var socks []listenSocket
	for _, name := range []string{"tcp", "tcp6"} {
		f, err := os.Open(filepath.Join(procRoot, "net", name))
		if err != nil {
			continue
		}
		socks = append(socks, parseNetTCP(f)...)
		f.Close()
	}
	want := map[string]bool{}
	for _, s := range socks {
		want[s.inode] = true
	}
	owners := socketOwners(procRoot, want)
	out := []portInfo{}
	seen := map[string]bool{}
	for _, s := range socks {
		key := s.addr + "|" + strconv.Itoa(s.port)
		pid := owners[s.inode]
		if seen[key] || (pid != 0 && pid == selfPID) {
			continue
		}
		seen[key] = true
		p := portInfo{Port: s.port, Address: s.addr, PID: pid}
		if pid != 0 {
			dir := filepath.Join(procRoot, strconv.Itoa(pid))
			comm, _ := os.ReadFile(filepath.Join(dir, "comm"))
			p.Process = strings.TrimSpace(string(comm))
			p.Cwd, _ = os.Readlink(filepath.Join(dir, "cwd"))
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	return out, nil
}

// parseNetTCP returns the LISTEN (state 0A) sockets of a /proc/net/tcp{,6} file.
func parseNetTCP(f *os.File) []listenSocket {
	var out []listenSocket
	s := bufio.NewScanner(f)
	s.Scan() // header
	for s.Scan() {
		fields := strings.Fields(s.Text())
		if len(fields) < 10 || fields[3] != "0A" || fields[9] == "0" {
			continue
		}
		hexAddr, hexPort, ok := strings.Cut(fields[1], ":")
		if !ok {
			continue
		}
		port, err := strconv.ParseUint(hexPort, 16, 16)
		ip := parseProcIP(hexAddr)
		if err != nil || ip == nil {
			continue
		}
		out = append(out, listenSocket{addr: ip.String(), port: int(port), inode: fields[9]})
	}
	return out
}

// parseProcIP decodes the kernel's hex address: 32-bit words in host (little endian) order.
func parseProcIP(h string) net.IP {
	b, err := hex.DecodeString(h)
	if err != nil || (len(b) != 4 && len(b) != 16) {
		return nil
	}
	for i := 0; i < len(b); i += 4 {
		b[i], b[i+1], b[i+2], b[i+3] = b[i+3], b[i+2], b[i+1], b[i]
	}
	return net.IP(b)
}

// socketOwners maps socket inodes to the pid holding them.
func socketOwners(procRoot string, want map[string]bool) map[string]int {
	owners := map[string]int{}
	if len(want) == 0 {
		return owners
	}
	dirs, _ := os.ReadDir(procRoot)
	for _, d := range dirs {
		pid, err := strconv.Atoi(d.Name())
		if err != nil {
			continue
		}
		fdDir := filepath.Join(procRoot, d.Name(), "fd")
		fds, _ := os.ReadDir(fdDir)
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if inode, ok := strings.CutPrefix(link, "socket:["); ok {
				inode = strings.TrimSuffix(inode, "]")
				if want[inode] {
					if _, taken := owners[inode]; !taken {
						owners[inode] = pid
					}
				}
			}
		}
	}
	return owners
}
