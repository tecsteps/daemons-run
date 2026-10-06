// Command daemons-agent connects a VM to its daemons.run control plane.
// Invoked as "daemons" (symlink) or "daemons-agent cli ..." it is the local CLI.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

var version = "dev"

const usage = `usage: daemons-agent <command>

  run                                            run the agent (systemd service)
  enroll --control-plane URL --token-file PATH   exchange the enrollment token for a credential
  version                                        print the version
  cli <args>                                     the daemons CLI (also available as "daemons")
`

func main() {
	if filepath.Base(os.Args[0]) == "daemons" {
		os.Exit(runCLI(os.Args[1:]))
	}
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	args := os.Args[2:]
	switch os.Args[1] {
	case "run":
		log.SetFlags(log.LstdFlags | log.Lmsgprefix)
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()
		if err := runAgent(ctx, defaultConfigPath); err != nil {
			log.Fatal(err)
		}
	case "enroll":
		fs := flag.NewFlagSet("enroll", flag.ExitOnError)
		cp := fs.String("control-plane", "", "control plane URL")
		tokenFile := fs.String("token-file", defaultTokenPath, "enrollment token file")
		config := fs.String("config", defaultConfigPath, "where to write agent.toml")
		fs.Parse(args)
		if *cp == "" {
			fmt.Fprintln(os.Stderr, "enroll: --control-plane is required")
			os.Exit(2)
		}
		if err := enroll(*cp, *tokenFile, *config); err != nil {
			fmt.Fprintln(os.Stderr, "enroll:", err)
			os.Exit(1)
		}
		fmt.Println("enrolled")
	case "version", "--version", "-v":
		fmt.Println(version)
	case "cli":
		os.Exit(runCLI(args))
	case "file-op":
		// Internal: one file operation, run as user dev (see files.go).
		os.Exit(fileOpMain())
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
}
