#!/bin/sh
# Runs installer/install.sh for real in an ubuntu:24.04 container against a fake control
# plane (fake_cp.py) on the host: a first install (cloud-init style, all coding agents),
# a rerun (the "Add existing server" one-liner on an enrolled server) and a failing run.
# systemd is not PID 1 in the container, so enabling ufw and starting services are skipped.
#
# usage: installer/test/run.sh        (needs docker, go, python3)
#        KEEP=1 installer/test/run.sh keeps the container for inspection
# Checks are single-quoted on purpose: they expand inside the container.
# shellcheck disable=SC2016
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d)
NAME=daemons-install-test-$$
fails=0

cleanup() {
	[ -n "${FAKE_PID:-}" ] && kill "$FAKE_PID" 2>/dev/null
	[ -n "${KEEP:-}" ] || docker rm -f "$NAME" >/dev/null 2>&1
	rm -rf "$WORK"
}
trap cleanup EXIT

case $(docker info --format '{{.Architecture}}') in
x86_64 | amd64) arch=amd64 ;;
aarch64 | arm64) arch=arm64 ;;
*) echo "unsupported docker architecture" >&2; exit 1 ;;
esac

echo "--> building daemons-agent-linux-$arch"
mkdir -p "$WORK/release"
(cd "$ROOT/agent" && CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -ldflags "-X main.version=test" -o "$WORK/release/daemons-agent-linux-$arch" .)
(cd "$WORK/release" && shasum -a 256 "daemons-agent-linux-$arch" >SHA256SUMS)

PORT=$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("", 0)); print(s.getsockname()[1])')
CP=http://host.docker.internal:$PORT
TOKEN=enroll-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
TOKEN2=enroll-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
printf '%s\n%s\n' "$TOKEN" "$TOKEN2" >"$WORK/tokens"
sed -e "s|__CONTROL_PLANE_URL__|$CP|g" -e "s|__AGENT_RELEASE__|test|g" "$ROOT/installer/install.sh" >"$WORK/install.sh"
python3 -I "$ROOT/installer/test/fake_cp.py" "$PORT" "$WORK" &
FAKE_PID=$!

docker run -d --name "$NAME" --add-host host.docker.internal:host-gateway ubuntu:24.04 sleep infinity >/dev/null
in_box() { docker exec "$NAME" sh -c "$1"; }
check() { # DESCRIPTION SHELL-COMMAND (run in the container)
	if in_box "$2" >/dev/null 2>&1; then
		echo "ok    $1"
	else
		echo "FAIL  $1"
		fails=$((fails + 1))
	fi
}
host_check() { # DESCRIPTION SHELL-COMMAND (run here, with the helpers below)
	if eval "$2" >/dev/null 2>&1; then
		echo "ok    $1"
	else
		echo "FAIL  $1"
		fails=$((fails + 1))
	fi
}
steps() { # STATUS: the step names reported with that status, in order, for token TOKEN
	python3 -I -c '
import json, sys
for line in open(sys.argv[1]):
    e = json.loads(line)
    if e.get("path") == "/agent/progress" and e.get("token") == sys.argv[3] and e["body"]["status"] == sys.argv[2]:
        print(e["body"]["step"])
' "$WORK/events.jsonl" "$1" "$2" | tr '\n' ' '
}

echo "--> preparing the container (curl, sshd, cloud-init style token and install.env)"
# openssh-server without a root key: the installer must turn off password login.
in_box 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates openssh-server >/dev/null'
in_box "mkdir -p /etc/daemons && (umask 077; printf '%s' '$TOKEN' >/etc/daemons/enroll-token) && printf 'DAEMONS_AGENTS=\"claude codex opencode\"\n' >/etc/daemons/install.env"

echo "--> run 1: fresh install"
start=$(date +%s)
docker exec -e DAEMONS_RELEASE_BASE_URL="$CP/release" "$NAME" sh -c "curl -fsSL $CP/install.sh | sh"
echo "    took $(($(date +%s) - start)) s"

check "user dev: home, shell, groups" '[ "$(getent passwd dev | cut -d: -f6,7)" = /home/dev:/bin/bash ] && id -nG dev | grep -qw sudo && id -nG dev | grep -qw docker'
check "dev has passwordless sudo" 'runuser -u dev -- sudo -n true'
check "/projects owned by dev" '[ "$(stat -c %U /projects)" = dev ]'
check "docker binds published ports to loopback" '[ "$(jq -r .ip /etc/docker/daemon.json)" = 127.0.0.1 ]'
check "compose networks bind to loopback too" '[ "$(jq -r ".[\"default-network-opts\"].bridge[\"com.docker.network.bridge.host_binding_ipv4\"]" /etc/docker/daemon.json)" = 127.0.0.1 ]'
check "docker, compose, gh, git, tmux, make, node installed" 'docker --version && docker compose version && gh --version && git --version && tmux -V && make --version && node --version'
check "unattended-upgrades enabled" 'grep -q Unattended-Upgrade /etc/apt/apt.conf.d/20auto-upgrades && dpkg -s unattended-upgrades'
check "ufw: IPv6 on, deny incoming, SSH allowed (v4+v6)" 'grep -q "^IPV6=yes" /etc/default/ufw && grep -q "^DEFAULT_INPUT_POLICY=\"DROP\"" /etc/default/ufw && grep -q "dport 22 " /etc/ufw/user.rules && grep -q "dport 22 " /etc/ufw/user6.rules'
check "claude, codex, opencode on dev login PATH" 'runuser -l dev -c "command -v claude && command -v codex && command -v opencode"'
check "daemons-agent installed, daemons symlink" '[ "$(daemons-agent version)" = test ] && [ "$(readlink /usr/local/bin/daemons)" = /usr/local/bin/daemons-agent ] && [ "$(daemons version)" = test ]'
check "agent.toml written with mode 600" '[ "$(stat -c %a /etc/daemons/agent.toml)" = 600 ] && grep -q "credential = \"cred-test\"" /etc/daemons/agent.toml'
check "enrollment token file deleted" '[ ! -e /etc/daemons/enroll-token ]'
check "systemd unit written" 'grep -q "ExecStart=/usr/local/bin/daemons-agent run" /etc/systemd/system/daemons-agent.service'
check "install log is root-only and has no token" "[ \"\$(stat -c %a /var/log/daemons-install.log)\" = 600 ] && ! grep -q '$TOKEN' /var/log/daemons-install.log"
check "SSH password login off (root has no key)" 'grep -q "^PasswordAuthentication no" /etc/ssh/sshd_config.d/01-daemons.conf && mkdir -p /run/sshd && ssh-keygen -A >/dev/null && sshd -T | grep -qi "^passwordauthentication no"'
want="packages firewall docker github-cli user ssh node coding-agents daemons-agent enroll service "
host_check "progress: every step running then done, in order" "[ \"\$(steps running $TOKEN)\" = '$want' ] && [ \"\$(steps done $TOKEN)\" = '$want' ]"
host_check "enroll called once with the register facts" "[ \"\$(grep -c '\"path\": \"/agent/enroll\"' $WORK/events.jsonl)\" = 1 ] && grep '/agent/enroll' $WORK/events.jsonl | grep -q '\"arch\": \"$arch\"'"
host_check "no unauthorized or malformed calls" "! grep -q -e unauthorized -e bad_json $WORK/events.jsonl"

echo "--> run 2: rerun with the one-liner (DAEMONS_TOKEN) on the enrolled server"
before=$(in_box 'sha256sum /etc/daemons/agent.toml /usr/local/bin/daemons-agent /etc/docker/daemon.json /etc/systemd/system/daemons-agent.service /etc/sudoers.d/dev /etc/profile.d/daemons.sh /etc/ssh/sshd_config.d/01-daemons.conf /etc/ufw/user.rules; stat -c %Y /usr/local/bin/daemons-agent')
docker exec -e DAEMONS_TOKEN="$TOKEN2" -e DAEMONS_RELEASE_BASE_URL="$CP/release" "$NAME" sh -c "curl -fsSL $CP/install.sh | sh"
after=$(in_box 'sha256sum /etc/daemons/agent.toml /usr/local/bin/daemons-agent /etc/docker/daemon.json /etc/systemd/system/daemons-agent.service /etc/sudoers.d/dev /etc/profile.d/daemons.sh /etc/ssh/sshd_config.d/01-daemons.conf /etc/ufw/user.rules; stat -c %Y /usr/local/bin/daemons-agent')
host_check "rerun changed no config, binary or credential" "[ '$before' = '$after' ]"
host_check "rerun did not enroll again" "[ \"\$(grep -c '\"path\": \"/agent/enroll\"' $WORK/events.jsonl)\" = 1 ]"
host_check "rerun reported progress with the new token" "[ \"\$(steps done $TOKEN2)\" = '$want' ]"
check "rerun kept the coding agents from install.env" 'grep -q "DAEMONS_AGENTS=\"claude codex opencode\"" /etc/daemons/install.env'
check "rerun removed the token file" '[ ! -e /etc/daemons/enroll-token ]'
check "install log has no token" "! grep -q '$TOKEN2' /var/log/daemons-install.log"

echo "--> run 3: a broken release URL fails the install and reports it"
if docker exec -e DAEMONS_TOKEN="$TOKEN2" -e DAEMONS_RELEASE_BASE_URL="$CP/release/missing" "$NAME" sh -c "curl -fsSL $CP/install.sh | sh" >/dev/null 2>&1; then
	echo "FAIL  run 3 exited 0"
	fails=$((fails + 1))
else
	echo "ok    run 3 exited non-zero"
fi
host_check "failed step reported with its log" "[ \"\$(steps failed $TOKEN2)\" = 'daemons-agent ' ] && grep '\"status\": \"failed\"' $WORK/events.jsonl | grep -q 'curl'"
check "a failed rerun leaves the installed agent in place" '[ "$(daemons-agent version)" = test ]'

echo
if [ "$fails" -ne 0 ]; then
	echo "$fails check(s) failed"
	exit 1
fi
echo "all installer checks passed"
