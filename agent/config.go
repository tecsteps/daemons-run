package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultConfigPath = "/etc/daemons/agent.toml"
	defaultTokenPath  = "/etc/daemons/enroll-token"
	protocolVersion   = 1
	daemonUserName    = "daemon"
)

type config struct {
	ControlPlane string
	ServerID     string
	Credential   string
}

// readConfig parses the tiny subset of TOML that writeConfig produces: key = "value".
func readConfig(path string) (config, error) {
	var c config
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		val, err := strconv.Unquote(strings.TrimSpace(v))
		if err != nil {
			return c, fmt.Errorf("%s: bad value for %s", path, strings.TrimSpace(k))
		}
		switch strings.TrimSpace(k) {
		case "control_plane":
			c.ControlPlane = strings.TrimRight(val, "/")
		case "server_id":
			c.ServerID = val
		case "credential":
			c.Credential = val
		}
	}
	if c.ControlPlane == "" || c.Credential == "" {
		return c, fmt.Errorf("%s: control_plane and credential are required", path)
	}
	return c, nil
}

func writeConfig(path string, c config) error {
	body := fmt.Sprintf("control_plane = %s\nserver_id = %s\ncredential = %s\n",
		strconv.Quote(c.ControlPlane), strconv.Quote(c.ServerID), strconv.Quote(c.Credential))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// enroll exchanges the one-time enrollment token for the long-lived agent credential.
func enroll(controlPlane, tokenFile, configPath string) error {
	controlPlane = strings.TrimRight(controlPlane, "/")
	raw, err := os.ReadFile(tokenFile)
	if err != nil {
		return err
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return errors.New("enrollment token file is empty")
	}
	body, _ := json.Marshal(registerFacts())
	req, err := http.NewRequest("POST", controlPlane+"/agent/enroll", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != 200 {
		return fmt.Errorf("control plane answered %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	var out struct {
		ServerID   string `json:"server_id"`
		Credential string `json:"credential"`
	}
	if err := json.Unmarshal(msg, &out); err != nil || out.Credential == "" {
		return errors.New("control plane sent no credential")
	}
	if err := writeConfig(configPath, config{ControlPlane: controlPlane, ServerID: out.ServerID, Credential: out.Credential}); err != nil {
		return err
	}
	return os.Remove(tokenFile)
}

type M = map[string]any

// registerFacts are sent with enroll and register.
func registerFacts() M {
	host, _ := os.Hostname()
	mem := meminfo()
	disk, _ := diskUsage("/")
	return M{
		"protocol":      protocolVersion,
		"agent_version": version,
		"hostname":      host,
		"os":            osName(),
		"arch":          runtime.GOARCH,
		"cpus":          runtime.NumCPU(),
		"memory_bytes":  mem["MemTotal"],
		"disk_bytes":    disk,
	}
}

func systemInfo() M {
	m := registerFacts()
	delete(m, "protocol")
	mem := meminfo()
	m["memory_used_bytes"] = mem["MemTotal"] - mem["MemAvailable"]
	_, used := diskUsage("/")
	m["disk_used_bytes"] = used
	m["load1"] = 0.0
	if b, err := os.ReadFile("/proc/loadavg"); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			m["load1"], _ = strconv.ParseFloat(f[0], 64)
		}
	}
	m["uptime_s"] = 0
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		if f := strings.Fields(string(b)); len(f) > 0 {
			up, _ := strconv.ParseFloat(f[0], 64)
			m["uptime_s"] = int64(up)
		}
	}
	m["agents"] = codingAgents()
	return m
}

func osName() string {
	if f, err := os.Open("/etc/os-release"); err == nil {
		defer f.Close()
		s := bufio.NewScanner(f)
		for s.Scan() {
			if v, ok := strings.CutPrefix(s.Text(), "PRETTY_NAME="); ok {
				if u, err := strconv.Unquote(v); err == nil {
					return u
				}
				return v
			}
		}
	}
	return runtime.GOOS
}

// meminfo returns /proc/meminfo values in bytes (empty off Linux).
func meminfo() map[string]int64 {
	out := map[string]int64{}
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 {
			n, _ := strconv.ParseInt(f[1], 10, 64)
			out[strings.TrimSuffix(f[0], ":")] = n * 1024
		}
	}
	return out
}

func diskUsage(path string) (total, used uint64) {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return 0, 0
	}
	bs := uint64(st.Bsize)
	total = uint64(st.Blocks) * bs
	return total, total - uint64(st.Bfree)*bs
}

// codingAgents lists the coding agents found on daemon's login PATH.
func codingAgents() []string {
	_, home, _ := daemonUser()
	found := []string{}
	for _, name := range []string{"claude", "codex", "opencode"} {
		for _, dir := range []string{home + "/.local/bin", home + "/.opencode/bin", "/usr/local/bin", "/usr/bin"} {
			if st, err := os.Stat(filepath.Join(dir, name)); err == nil && !st.IsDir() {
				found = append(found, name)
				break
			}
		}
	}
	return found
}

// daemonUser returns the credential to run work as user daemon. When the agent is not
// root (tests, development) it returns nil and the current user's home: work runs as us.
func daemonUser() (*syscall.Credential, string, error) {
	if os.Geteuid() != 0 {
		home, _ := os.UserHomeDir()
		return nil, home, nil
	}
	return lookupCredential(daemonUserName)
}

func lookupCredential(name string) (*syscall.Credential, string, error) {
	u, err := user.Lookup(name)
	if err != nil {
		return nil, "", err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	cred := &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}
	if ids, err := u.GroupIds(); err == nil {
		for _, g := range ids {
			if n, err := strconv.Atoi(g); err == nil {
				cred.Groups = append(cred.Groups, uint32(n))
			}
		}
	}
	return cred, u.HomeDir, nil
}

// userCommand prepares cmd to run as user (daemon or root) with a clean login-like environment.
func userCommand(cmd *exec.Cmd, asRoot bool) error {
	cred, home, err := daemonUser()
	name := daemonUserName
	if asRoot {
		cred, home, name = nil, "/root", "root"
		if os.Geteuid() != 0 {
			home, _ = os.UserHomeDir()
		}
	} else if err != nil {
		return fmt.Errorf("user %s: %w", daemonUserName, err)
	}
	if cred == nil && !asRoot {
		if u, err := user.Current(); err == nil {
			name = u.Username
		}
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Credential = cred
	cmd.Env = []string{
		"HOME=" + home, "USER=" + name, "LOGNAME=" + name, "SHELL=/bin/bash",
		"TERM=xterm-256color", "LANG=C.UTF-8",
		"PATH=" + home + "/.local/bin:" + home + "/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
	}
	return nil
}

func modTime(path string) time.Time {
	if st, err := os.Stat(path); err == nil {
		return st.ModTime()
	}
	return time.Time{}
}
