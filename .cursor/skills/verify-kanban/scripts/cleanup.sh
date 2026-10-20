#!/usr/bin/env bash
# Stops only the processes launch.sh started and removes .verify/run. Evidence in .verify/evidence stays.
# Usage: cleanup.sh [--purge-build]   (--purge-build also deletes the .next-verify build cache)
set -uo pipefail
source "$(dirname "$0")/common.sh"
for name in server cursor; do
	pid="$(cat "$STATE/$name.pid" 2>/dev/null)" || continue
	# Only kill it if the pid still belongs to what we started; pids get reused. Next renames its process to next-server.
	if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= | grep -qE '^next-server|next/dist/bin/next start|e2e/fake-cursor.mjs'; then
		kill "$pid"
		for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
		kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
		echo "stopped $name (pid $pid)"
	fi
done
rm -rf "$STATE"
[ "${1:-}" = "--purge-build" ] && rm -rf "$ROOT/$DIST" && echo "removed $DIST"
echo "evidence kept in $EVIDENCE"
