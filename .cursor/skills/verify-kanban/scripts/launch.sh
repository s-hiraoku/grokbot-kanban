#!/usr/bin/env bash
# Builds the board into .next-verify and serves it on an in-memory database, with the fake Cursor API beside it.
# Usage: launch.sh            (PORT=3230 CURSOR_PORT=3239 by default)
set -euo pipefail
source "$(dirname "$0")/common.sh"
PORT="${PORT:-3230}"
CURSOR_PORT="${CURSOR_PORT:-3239}"

if [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
	echo "An instance from this skill is already running ($(cat "$STATE/env" | tr '\n' ' ')). Run doctor.sh, or cleanup.sh first." >&2
	exit 1
fi
for port in "$PORT" "$CURSOR_PORT"; do
	if [ -n "$(listeners "$port")" ]; then
		echo "Port $port is taken by pid $(listeners "$port" | tr '\n' ' '), which this skill did not start. Pick another: PORT=... CURSOR_PORT=... $0" >&2
		exit 1
	fi
done
rm -rf "$STATE"
mkdir -p "$STATE" "$EVIDENCE"
cd "$ROOT"
[ -d node_modules ] || npm ci

stamp="$(source_stamp)"
if [ "$(cat "$DIST/.verify-source" 2>/dev/null)" = "$stamp" ] && [ -f "$DIST/BUILD_ID" ]; then
	echo "Build in $DIST matches the working tree; reusing it."
else
	echo "Building into $DIST (about a minute; log in $STATE/build.log)..."
	# next build points next-env.d.ts (and tsconfig.json, if needed) at the build folder; put both back after.
	cp tsconfig.json next-env.d.ts "$STATE/"
	restore() { cp "$STATE/tsconfig.json" "$STATE/next-env.d.ts" "$ROOT/"; }
	if ! NEXT_DIST_DIR="$DIST" node node_modules/next/dist/bin/next build >"$STATE/build.log" 2>&1; then
		restore
		tail -30 "$STATE/build.log" >&2
		echo "Build failed. Full log: $STATE/build.log" >&2
		exit 1
	fi
	restore
	printf '%s' "$stamp" >"$DIST/.verify-source"
fi

PORT="$CURSOR_PORT" nohup node e2e/fake-cursor.mjs >"$STATE/cursor.log" 2>&1 &
echo $! >"$STATE/cursor.pid"
NEXT_DIST_DIR="$DIST" DATABASE_URL=pglite OWNER_PASSWORD="$OWNER_PASSWORD" BOT_TOKEN="$BOT_TOKEN" \
	CURSOR_API_KEY="$CURSOR_KEY" CURSOR_API_URL="http://localhost:$CURSOR_PORT" \
	nohup node node_modules/next/dist/bin/next start -p "$PORT" >"$STATE/server.log" 2>&1 &
echo $! >"$STATE/server.pid"
printf 'PORT=%s\nCURSOR_PORT=%s\nBASE_URL=http://localhost:%s\n' "$PORT" "$CURSOR_PORT" "$PORT" >"$STATE/env"

# Ready means usable: the login page answers and an MCP read goes through, which opens PGlite and applies drizzle/*.sql.
# list_bots takes no bot name, so the probe does not add anyone to the roster.
for _ in $(seq 1 120); do
	if curl -fsS -o /dev/null "http://localhost:$PORT/login" 2>/dev/null &&
		curl -fsS "http://localhost:$PORT/api/mcp" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' \
			-d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_bots","arguments":{}}}' 2>/dev/null | grep -q '"structuredContent"'; then
		echo "READY http://localhost:$PORT  (password: $OWNER_PASSWORD, bot token: $BOT_TOKEN, fake Cursor: http://localhost:$CURSOR_PORT)"
		exit 0
	fi
	if ! kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
		tail -30 "$STATE/server.log" >&2
		echo "The server exited. Log: $STATE/server.log. Run cleanup.sh." >&2
		exit 1
	fi
	sleep 1
done
echo "Not ready after 120s. Log: $STATE/server.log. Run cleanup.sh." >&2
exit 1
