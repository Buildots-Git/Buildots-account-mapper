#!/bin/bash
# Keeps a Cloudflare quick tunnel to the app alive.
#   scripts/tunnel-watch.sh [existing-url]
# Checks the public address every 30s. If it stops answering twice in a row (Cloudflare deletes these tunnels without warning),
# it starts a new tunnel, puts the new link on the clipboard, shows a macOS notification and writes it to data/tunnel-url.txt.
# The link changes each time, so forward the new one. Stop with Ctrl-C.
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-8787}"; URL="${1:-}"; LOG=data/tunnel.log; PID=""
host() { echo "$URL" | sed -E 's#https?://##; s#/.*##'; }

reachable() { # resolve through Cloudflare DNS-over-HTTPS so a lagging local resolver doesn't fake a failure
  local h ip code; h=$(host); [ -z "$h" ] && return 1
  ip=$(curl -s -m 8 "https://cloudflare-dns.com/dns-query?name=$h&type=A" -H 'accept: application/dns-json' | python3 -c 'import sys,json;print(json.load(sys.stdin)["Answer"][0]["data"])' 2>/dev/null)
  [ -z "$ip" ] && ip=104.16.230.132
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' --resolve "$h:443:$ip" "$URL/api/auth/state")
  [ "$code" = "200" ]
}

start_tunnel() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
  : > "$LOG"
  ./tools/cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate --protocol http2 >> "$LOG" 2>&1 &
  PID=$!; caffeinate -i -w "$PID" >/dev/null 2>&1 &
  for _ in $(seq 1 30); do
    URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | grep -v '^https://api\.' | head -1); [ -n "$URL" ] && break; sleep 1
  done
  if [ -z "$URL" ]; then echo "$(date +%T) could not start a tunnel yet, will retry"; return 1; fi
  echo "$URL" > data/tunnel-url.txt; printf '%s' "$URL" | pbcopy
  osascript -e "display notification \"$URL (copied to clipboard)\" with title \"New Account Mapper link\"" >/dev/null 2>&1
  echo "$(date +%T) NEW LINK: $URL"; GRACE=6
}

GRACE=0; FAILS=0
if [ -z "$URL" ]; then start_tunnel; else echo "$(date +%T) watching $URL"; fi
while true; do
  sleep 30
  if [ "$GRACE" -gt 0 ]; then GRACE=$((GRACE-1)); continue; fi
  if reachable; then FAILS=0; else FAILS=$((FAILS+1)); echo "$(date +%T) not reachable ($FAILS)"; fi
  if [ "$FAILS" -ge 2 ]; then FAILS=0; start_tunnel || FAILS=1; fi
done
