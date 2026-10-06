#!/bin/sh
# daemons.run installer: turns a vanilla Ubuntu server into a daemons server.
# Served by the control plane with __CONTROL_PLANE_URL__ and __AGENT_RELEASE__ filled in.
# Idempotent: rerunning it is the repair path and changes nothing on a healthy server.
#
#   curl -fsSL <control-plane>/install.sh | sudo DAEMONS_TOKEN=<token> sh
#
# Inputs: the enrollment token in /etc/daemons/enroll-token (cloud-init) or $DAEMONS_TOKEN;
# coding agents in $DAEMONS_AGENTS or /etc/daemons/install.env (default: claude).
set -eu

CONTROL_PLANE_URL="__CONTROL_PLANE_URL__"
AGENT_RELEASE="__AGENT_RELEASE__"
# DAEMONS_RELEASE_BASE_URL overrides where the agent binary comes from (tests, mirrors).
RELEASE_BASE="${DAEMONS_RELEASE_BASE_URL:-https://github.com/tecsteps/daemons-run/releases/download/$AGENT_RELEASE}"

ETC=/etc/daemons
TOKEN_FILE=$ETC/enroll-token
LOG=/var/log/daemons-install.log
BIN=/usr/local/bin/daemons-agent
UNIT=/etc/systemd/system/daemons-agent.service
APT="apt-get -y -q -o DPkg::Lock::Timeout=600"
export DEBIAN_FRONTEND=noninteractive

say() { printf '%s\n' "$*"; printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
die() { printf 'daemons install: %s\n' "$*" >&2; exit 1; }

# systemd is absent in containers; service steps are skipped there with a clear message.
have_systemd() { [ -d /run/systemd/system ]; }

# write_file PATH CONTENT: writes only when the content differs; returns 0 when it wrote.
write_file() {
	if [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]; then
		return 1
	fi
	mkdir -p "$(dirname "$1")"
	printf '%s\n' "$2" >"$1.daemons-tmp"
	mv -f "$1.daemons-tmp" "$1"
}

# json_str: stdin as a JSON string literal (control characters dropped, long lines cut).
json_str() {
	tr -d '\000-\010\013-\037' | cut -c1-400 |
		sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$(printf '\t')/\\\\t/g" |
		awk 'BEGIN { ORS = ""; print "\"" } { if (NR > 1) print "\\n"; print } END { print "\"" }'
}

# progress STEP STATUS [LOG]: best effort, never fails the install. The token is passed to
# curl in a header file so it never shows up in a process list.
progress() {
	[ -n "$HEADER_FILE" ] && command -v curl >/dev/null 2>&1 || return 0
	{
		printf '{"step":"%s","status":"%s","log":' "$1" "$2"
		printf '%s' "${3:-}" | json_str
		printf '}'
	} | curl -fsS -m 15 -X POST -H @"$HEADER_FILE" -H 'Content-Type: application/json' \
		--data-binary @- "$CONTROL_PLANE_URL/agent/progress" >/dev/null 2>&1 || true
}

# step NAME FUNCTION: runs FUNCTION with its output in the log and reports progress.
step() {
	say "==> $1"
	progress "$1" running
	set +e
	(
		set -e
		"$2"
	) >>"$LOG" 2>&1
	rc=$?
	set -e
	if [ "$rc" -ne 0 ]; then
		progress "$1" failed "$(tail -n 50 "$LOG")"
		printf '\ndaemons install failed at step "%s". Last lines of %s:\n\n' "$1" "$LOG" >&2
		tail -n 20 "$LOG" >&2
		exit 1
	fi
	progress "$1" "done"
}

step_packages() {
	$APT update
	$APT install ca-certificates curl gnupg jq sudo git tmux build-essential ufw unattended-upgrades
	write_file /etc/apt/apt.conf.d/20auto-upgrades 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' || true
}

step_firewall() {
	sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
	ufw default deny incoming
	ufw default allow outgoing
	if ufw app info OpenSSH >/dev/null 2>&1; then
		ufw allow OpenSSH
	else
		ufw allow 22/tcp
	fi
	if ! have_systemd; then
		echo "skip: systemd is not PID 1 (container?), rules written but the firewall is not enabled"
		return 0
	fi
	if ! ufw status | grep -q 'Status: active'; then
		ufw --force enable
	fi
	ufw status verbose
}

# apt_repo NAME KEY_FILE KEY_URL SOURCE: apt needs .asc for armored keys and .gpg for binary ones.
apt_repo() {
	key=/etc/apt/keyrings/$2
	install -m 0755 -d /etc/apt/keyrings
	if [ ! -s "$key" ]; then
		curl -fsSL "$3" -o "$key"
		chmod a+r "$key"
	fi
	if write_file "/etc/apt/sources.list.d/$1.list" "deb [arch=$(dpkg --print-architecture) signed-by=$key] $4"; then
		$APT update
	fi
}

step_docker() {
	# shellcheck disable=SC1091
	codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
	apt_repo docker docker.asc https://download.docker.com/linux/ubuntu/gpg "https://download.docker.com/linux/ubuntu $codename stable"
	$APT install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	# Docker bypasses ufw for published ports: bind them to loopback unless a port says otherwise.
	current='{}'
	if [ -s /etc/docker/daemon.json ]; then
		current=$(cat /etc/docker/daemon.json)
	fi
	merged=$(printf '%s' "$current" | jq '. + {"ip": "127.0.0.1"}')
	if write_file /etc/docker/daemon.json "$merged" && have_systemd; then
		systemctl restart docker
	fi
	if have_systemd; then
		systemctl enable --now docker
	else
		echo "skip: systemd is not PID 1, not starting docker"
	fi
}

step_github_cli() {
	apt_repo github-cli githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg "https://cli.github.com/packages stable main"
	$APT install gh
}

step_user() {
	if id daemon >/dev/null 2>&1; then
		# Ubuntu ships a legacy system account "daemon" (uid 1, home /usr/sbin, no shell).
		# Turn it into our login user; never move its old home.
		[ "$(getent passwd daemon | cut -d: -f6)" = /home/daemon ] || usermod -d /home/daemon daemon
		[ "$(getent passwd daemon | cut -d: -f7)" = /bin/bash ] || usermod -s /bin/bash daemon
	elif getent group daemon >/dev/null; then
		useradd -M -d /home/daemon -s /bin/bash -g daemon daemon
	else
		useradd -M -d /home/daemon -s /bin/bash -U daemon
	fi
	if [ ! -d /home/daemon ]; then
		mkdir -p /home/daemon
		cp -a /etc/skel/. /home/daemon/
		chown -R daemon: /home/daemon
		chmod 750 /home/daemon
	fi
	usermod -aG sudo,docker daemon
	write_file /etc/sudoers.d/daemon 'daemon ALL=(ALL) NOPASSWD:ALL' || true
	chmod 440 /etc/sudoers.d/daemon
	visudo -cf /etc/sudoers.d/daemon
	mkdir -p /projects
	chown daemon: /projects
	# Coding agents install into ~/.local/bin and ~/.opencode/bin; put both on login PATHs.
	# shellcheck disable=SC2016 # expanded at login, not now
	write_file /etc/profile.d/daemons.sh '# Written by the daemons.run installer.
for d in "$HOME/.local/bin" "$HOME/.opencode/bin"; do
	case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac
done
export PATH' || true
}

step_ssh() {
	if [ ! -d /etc/ssh/sshd_config.d ]; then
		echo "no OpenSSH server config found; nothing to do"
		return 0
	fi
	for f in /root/.ssh/authorized_keys /root/.ssh/authorized_keys2; do
		if [ -s "$f" ] && grep -qv -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$f"; then
			echo "root has an SSH key; leaving SSH as it is"
			return 0
		fi
	done
	# No key: the provider enabled password login. Turn it off; the browser terminal is the way in.
	# 01- sorts before cloud-init's 50- drop-in, and sshd keeps the first value it reads.
	if write_file /etc/ssh/sshd_config.d/01-daemons.conf '# Written by the daemons.run installer: root has no SSH key.
PasswordAuthentication no
KbdInteractiveAuthentication no' && have_systemd; then
		systemctl reload ssh || systemctl reload sshd || true
	fi
}

step_node() {
	if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
		echo "node $(node --version) already installed"
		return 0
	fi
	curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
	$APT install nodejs
}

as_daemon() { runuser -l daemon -c "$1"; }

step_coding_agents() {
	for agent in $AGENTS; do
		case $agent in
		claude)
			[ -x /home/daemon/.local/bin/claude ] || as_daemon 'curl -fsSL https://claude.ai/install.sh | bash'
			;;
		codex)
			command -v codex >/dev/null 2>&1 || npm install -g @openai/codex
			;;
		opencode)
			[ -x /home/daemon/.opencode/bin/opencode ] || as_daemon 'curl -fsSL https://opencode.ai/install | bash'
			;;
		esac
	done
	for agent in $AGENTS; do
		as_daemon "command -v $agent"
	done
}

step_agent_binary() {
	case $(uname -m) in
	x86_64 | amd64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) die "unsupported architecture $(uname -m)" ;;
	esac
	name=daemons-agent-linux-$arch
	dir=$(mktemp -d)
	curl -fsSL -o "$dir/$name" "$RELEASE_BASE/$name"
	curl -fsSL -o "$dir/SHA256SUMS" "$RELEASE_BASE/SHA256SUMS"
	want=$(awk -v f="$name" '$2 == f || $2 == "*" f { print $1 }' "$dir/SHA256SUMS")
	got=$(sha256sum "$dir/$name" | cut -d' ' -f1)
	if [ -z "$want" ] || [ "$want" != "$got" ]; then
		die "checksum mismatch for $name (expected '$want', got '$got')"
	fi
	if ! cmp -s "$dir/$name" "$BIN"; then
		# Rename over the old binary: a running agent keeps its file, no "text file busy".
		install -m 0755 "$dir/$name" "$BIN.new"
		mv -f "$BIN.new" "$BIN"
		touch "$STATE/agent-changed"
	fi
	ln -sfn "$BIN" /usr/local/bin/daemons
	rm -rf "$dir"
	"$BIN" version
}

step_enroll() {
	if [ -s "$ETC/agent.toml" ]; then
		echo "already enrolled ($ETC/agent.toml exists)"
		return 0
	fi
	[ -s "$TOKEN_FILE" ] || die "no enrollment token: expected $TOKEN_FILE or DAEMONS_TOKEN"
	"$BIN" enroll --control-plane "$CONTROL_PLANE_URL" --token-file "$TOKEN_FILE"
}

step_service() {
	unit='[Unit]
Description=daemons.run agent
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=/usr/local/bin/daemons-agent run
Restart=always
RestartSec=5
# tmux sessions started by the agent must outlive agent restarts and upgrades.
KillMode=process
RuntimeDirectory=daemons

[Install]
WantedBy=multi-user.target'
	if write_file "$UNIT" "$unit"; then
		touch "$STATE/unit-changed"
	fi
	if ! have_systemd; then
		echo "skip: systemd is not PID 1 (container?), not starting daemons-agent.service"
		return 0
	fi
	systemctl daemon-reload
	systemctl enable daemons-agent.service
	if [ -e "$STATE/agent-changed" ] || [ -e "$STATE/unit-changed" ]; then
		systemctl restart daemons-agent.service
	else
		systemctl start daemons-agent.service
	fi
	sleep 2
	systemctl is-active --quiet daemons-agent.service
}

main() {
	[ "$(id -u)" -eq 0 ] || die "run as root: curl -fsSL <control-plane>/install.sh | sudo sh"
	case $CONTROL_PLANE_URL in
	http://* | https://*) ;;
	*) die "this script must be downloaded from your control plane (<control-plane>/install.sh)" ;;
	esac
	umask 022
	mkdir -p "$ETC"
	touch "$LOG"
	chmod 600 "$LOG"
	if [ -n "${DAEMONS_TOKEN:-}" ]; then
		(
			umask 077
			printf '%s\n' "$DAEMONS_TOKEN" >"$TOKEN_FILE"
		)
		unset DAEMONS_TOKEN
	fi
	STATE=$(mktemp -d)
	HEADER_FILE=""
	if [ -s "$TOKEN_FILE" ]; then
		HEADER_FILE=$STATE/auth-header
		(
			umask 077
			printf 'Authorization: Bearer %s\n' "$(tr -d ' \r\n' <"$TOKEN_FILE")" >"$HEADER_FILE"
		)
	fi
	trap 'rm -rf "$STATE"' EXIT

	AGENTS=${DAEMONS_AGENTS:-}
	if [ -z "$AGENTS" ] && [ -f "$ETC/install.env" ]; then
		AGENTS=$(sed -n 's/^DAEMONS_AGENTS=//p' "$ETC/install.env" | tr -d "\"'" | tail -n 1)
	fi
	selected=""
	for agent in ${AGENTS:-claude}; do
		case $agent in
		claude | codex | opencode) selected="$selected $agent" ;;
		*) say "ignoring unknown coding agent '$agent'" ;;
		esac
	done
	AGENTS=${selected# }
	write_file "$ETC/install.env" "DAEMONS_AGENTS=\"$AGENTS\"" || true

	say "daemons.run installer (agent $AGENT_RELEASE, control plane $CONTROL_PLANE_URL, coding agents: ${AGENTS:-none})"
	step packages step_packages
	step firewall step_firewall
	step docker step_docker
	step github-cli step_github_cli
	step user step_user
	step ssh step_ssh
	case " $AGENTS " in *" codex "*) step node step_node ;; esac
	step coding-agents step_coding_agents
	step daemons-agent step_agent_binary
	step enroll step_enroll
	step service step_service
	# A leftover token (rerun on an enrolled server) is useless; do not keep it around.
	rm -f "$TOKEN_FILE"
	say "done: this server is set up. Open your control plane to use it."
}

main "$@"
