#!/usr/bin/env bash
# Read-only: is the instance this skill started worth driving? Exits non-zero with the reason if not.
set -uo pipefail
source "$(dirname "$0")/common.sh"
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

[ -f "$STATE/env" ] || { echo "FAIL  no instance from this skill ($STATE/env missing). Run launch.sh."; exit 1; }
source "$STATE/env"
for name in server cursor; do
	pid="$(cat "$STATE/$name.pid" 2>/dev/null)"
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then ok "$name pid $pid is up: $(ps -p "$pid" -o command= | cut -c1-80)"; else bad "$name process is not running (log: $STATE/$name.log)"; fi
done
owner="$(listeners "$PORT" | head -1)"
if [ "$owner" = "$(cat "$STATE/server.pid" 2>/dev/null)" ]; then ok "port $PORT is ours"; else bad "port $PORT is held by '${owner:-nobody}', not our server"; fi
owner="$(listeners "$CURSOR_PORT" | head -1)"
if [ "$owner" = "$(cat "$STATE/cursor.pid" 2>/dev/null)" ]; then ok "port $CURSOR_PORT (fake Cursor) is ours"; else bad "port $CURSOR_PORT is held by '${owner:-nobody}', not our fake Cursor"; fi

if [ "$(cat "$ROOT/$DIST/.verify-source" 2>/dev/null)" = "$(source_stamp)" ]; then ok "build matches the working tree"; else bad "build is stale: the code changed since launch. Run cleanup.sh then launch.sh"; fi

code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login")"
[ "$code" = 200 ] && ok "/login answers 200" || bad "/login answers $code"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/mcp" -H 'Content-Type: application/json' -d '{}')"
[ "$code" = 401 ] && ok "MCP refuses a missing token (401)" || bad "MCP without a token answered $code, expected 401"
info="$(curl -s "$BASE_URL/api/mcp" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' \
	-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"doctor","version":"0"}}}')"
echo "$info" | grep -q '"serverInfo"' && ok "MCP accepts the verify token: $(echo "$info" | grep -o '"serverInfo":{[^}]*}')" || bad "MCP initialize failed: $info"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" -H "Origin: $BASE_URL" --data-urlencode "password=$OWNER_PASSWORD")"
[ "$code" = 303 ] && ok "owner password signs in (303)" || bad "owner sign-in answered $code, expected 303"
exit $fail
