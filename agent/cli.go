package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
)

var cliSocketPath = "/run/daemons/agent.sock"

var appNameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

type cliRequest struct {
	Cmd    string `json:"cmd"`
	Port   int    `json:"port"`
	Name   string `json:"name"`
	Cwd    string `json:"cwd"`
	Public bool   `json:"public"`
}

// serveCLI answers the local daemons CLI: one JSON line in, one JSON line out.
func (a *Agent) serveCLI(ctx context.Context, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	os.Remove(path)
	l, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	if os.Geteuid() == 0 {
		if g, err := user.LookupGroup(daemonUserName); err == nil {
			gid, _ := strconv.Atoi(g.Gid)
			os.Chown(path, 0, gid)
		}
	}
	os.Chmod(path, 0o660)
	go func() {
		<-ctx.Done()
		l.Close()
	}()
	for {
		nc, err := l.Accept()
		if err != nil {
			return err
		}
		go func() {
			defer nc.Close()
			nc.SetDeadline(time.Now().Add(45 * time.Second))
			line, err := bufio.NewReader(nc).ReadBytes('\n')
			var req cliRequest
			if err != nil || json.Unmarshal(line, &req) != nil {
				json.NewEncoder(nc).Encode(M{"ok": false, "error": "bad request"})
				return
			}
			json.NewEncoder(nc).Encode(a.cli(ctx, req))
		}()
	}
}

func (a *Agent) cli(ctx context.Context, req cliRequest) M {
	if req.Cmd == "status" {
		a.mu.Lock()
		defer a.mu.Unlock()
		since := ""
		if a.cur != nil {
			since = a.since.UTC().Format(time.RFC3339)
		}
		return M{"ok": true, "connected": a.cur != nil, "control_plane": a.cfg.ControlPlane,
			"server_id": a.cfg.ServerID, "name": a.name, "agent_version": version, "since": since}
	}
	c := a.conn()
	if c == nil {
		return M{"ok": false, "error": "the agent is not connected to the control plane right now; check `daemons status` and try again"}
	}
	var params M
	switch req.Cmd {
	case "expose":
		if req.Port < 1 || req.Port > 65535 {
			return M{"ok": false, "error": "port must be between 1 and 65535"}
		}
		if !appNameRe.MatchString(req.Name) {
			return M{"ok": false, "error": "name may only contain a-z, 0-9 and -"}
		}
		params = M{"name": req.Name, "port": req.Port, "cwd": req.Cwd, "public": req.Public}
	case "unexpose":
		params = M{"name": req.Name}
	case "apps":
		params = M{}
	default:
		return M{"ok": false, "error": "unknown command " + strconv.Quote(req.Cmd)}
	}
	res, err := c.request(ctx, "app."+map[string]string{"expose": "expose", "unexpose": "unexpose", "apps": "list"}[req.Cmd], params)
	if err != nil {
		var pe *protoError
		if errors.As(err, &pe) {
			return M{"ok": false, "error": pe.Message, "code": pe.Code}
		}
		return M{"ok": false, "error": err.Error()}
	}
	res["ok"] = true
	return res
}

// appName turns a folder name into an app name: lowercase, [a-z0-9-] only.
func appName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteByte('-')
		}
	}
	name := strings.Trim(b.String(), "-")
	if len(name) > 63 {
		name = strings.Trim(name[:63], "-")
	}
	return name
}

const cliUsage = `usage: daemons <command>

  status                               connection to the control plane
  expose <port> [--name n] [--public]  make localhost:<port> reachable as an app
  unexpose <name>                      remove an app
  apps                                 list this server's apps
  version                              print the version
`

func runCLI(args []string) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(cliUsage)
		return 0
	}
	var req cliRequest
	switch args[0] {
	case "version":
		fmt.Println(version)
		return 0
	case "status", "apps":
		req.Cmd = args[0]
	case "unexpose":
		if len(args) != 2 {
			return usageError("usage: daemons unexpose <name>")
		}
		req = cliRequest{Cmd: "unexpose", Name: args[1]}
	case "expose":
		req.Cmd = "expose"
		for i := 1; i < len(args); i++ {
			switch arg := args[i]; {
			case arg == "--public":
				req.Public = true
			case arg == "--name" && i+1 < len(args):
				i++
				req.Name = args[i]
			case strings.HasPrefix(arg, "--name="):
				req.Name = strings.TrimPrefix(arg, "--name=")
			case req.Port == 0 && !strings.HasPrefix(arg, "-"):
				req.Port, _ = strconv.Atoi(arg)
				if req.Port == 0 {
					return usageError("port must be a number")
				}
			default:
				return usageError("usage: daemons expose <port> [--name n] [--public]")
			}
		}
		if req.Port == 0 {
			return usageError("usage: daemons expose <port> [--name n] [--public]")
		}
		req.Cwd, _ = os.Getwd()
		if req.Name == "" {
			req.Name = appName(filepath.Base(req.Cwd))
			if req.Name == "" {
				return usageError("cannot derive a name from this folder; pass --name")
			}
		}
	default:
		fmt.Fprint(os.Stderr, cliUsage)
		return 2
	}
	res, err := callAgent(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "daemons:", err)
		return 1
	}
	if ok, _ := res["ok"].(bool); !ok {
		fmt.Fprintln(os.Stderr, "daemons:", res["error"])
		return 1
	}
	printResult(req, res)
	return 0
}

func usageError(msg string) int {
	fmt.Fprintln(os.Stderr, msg)
	return 2
}

func callAgent(req cliRequest) (M, error) {
	nc, err := net.DialTimeout("unix", cliSocketPath, 5*time.Second)
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return nil, errors.New("permission denied; run as user dev or root")
		}
		return nil, fmt.Errorf("daemons-agent is not running (%s): try `sudo systemctl status daemons-agent`", cliSocketPath)
	}
	defer nc.Close()
	nc.SetDeadline(time.Now().Add(50 * time.Second))
	if err := json.NewEncoder(nc).Encode(req); err != nil {
		return nil, err
	}
	line, err := bufio.NewReader(nc).ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("no answer from daemons-agent: %v", err)
	}
	var res M
	if err := json.Unmarshal(line, &res); err != nil {
		return nil, err
	}
	return res, nil
}

func printResult(req cliRequest, res M) {
	switch req.Cmd {
	case "status":
		state := "offline (reconnecting)"
		if c, _ := res["connected"].(bool); c {
			state = "connected since " + fmt.Sprint(res["since"])
		}
		fmt.Printf("control plane  %v\nserver         %v %v\nstatus         %s\nagent          %v\n",
			res["control_plane"], res["name"], res["server_id"], state, res["agent_version"])
	case "expose":
		vis := "private (sign-in required)"
		if p, _ := res["public"].(bool); p {
			vis = "public"
		}
		fmt.Printf("%v  →  localhost:%d  [%s]\n", res["url"], req.Port, vis)
	case "unexpose":
		fmt.Printf("removed %s\n", req.Name)
	case "apps":
		apps, _ := res["apps"].([]any)
		if len(apps) == 0 {
			fmt.Println("no apps; expose one with: daemons expose <port>")
			return
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "NAME\tPORT\tACCESS\tURL")
		for _, x := range apps {
			app, _ := x.(map[string]any)
			access := "private"
			if p, _ := app["public"].(bool); p {
				access = "public"
			}
			fmt.Fprintf(w, "%v\t%v\t%s\t%v\n", app["name"], app["port"], access, app["url"])
		}
		w.Flush()
	}
}
