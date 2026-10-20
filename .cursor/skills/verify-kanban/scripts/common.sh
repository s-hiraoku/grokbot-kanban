# Shared settings for the verify-kanban scripts. Sourced, not run.
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
STATE="$ROOT/.verify/run"          # pids, logs, ports of the instance this skill started; removed by cleanup
EVIDENCE="$ROOT/.verify/evidence"  # proof from journeys; cleanup never touches it
DIST=".next-verify"                # build folder, separate from .next so `next dev` and e2e can run alongside

# Verification-only secrets. They are not real and only ever sit in this process's environment.
OWNER_PASSWORD="verify-owner-password-0123456789abcdefgh"
BOT_TOKEN="verify-bot-token-0123456789abcdefghijklmnop"
# e2e/fake-cursor.mjs only accepts this key.
CURSOR_KEY="e2e-cursor-key-0123456789abcdefghijklmnop"

# Prints the pids listening on a TCP port: /proc on Linux (lsof there can miss sockets in sandboxes), lsof on macOS.
listeners() {
	if [ -r /proc/net/tcp ]; then
		local inode fd
		for inode in $(awk -v port=":$(printf '%04X' "$1")" '$4 == "0A" && substr($2, length($2) - 4) == port { print $10 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null); do
			for fd in /proc/[0-9]*/fd/*; do
				[ "$(readlink "$fd" 2>/dev/null)" = "socket:[$inode]" ] && echo "$fd" | cut -d/ -f3
			done
		done | sort -u
	else
		lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u
	fi
}

# The source the build came from: commit plus a hash of uncommitted changes, leaving out this skill's own files.
source_stamp() {
	(cd "$ROOT" && printf '%s %s' "$(git rev-parse HEAD)" "$( (git diff HEAD -- . ':!.cursor'; git ls-files --others --exclude-standard -z -- . ':!.cursor' | xargs -0 cat 2>/dev/null) | shasum | cut -c1-12)")
}
