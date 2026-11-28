#!/usr/bin/env bash
# Dev runner for the TrollNet desktop host (Phase 3 spike).
# Builds once and runs the built DLL directly (one process -> reliable kill), frees ports by PORT
# (not just name), captures logs in one place, and runs the smoke tests into a single results file.
#
#   ./dev.sh start      # free ports, build, launch in background, wait for health
#   ./dev.sh stop       # free ports 5080/5081 (retries until actually free)
#   ./dev.sh restart
#   ./dev.sh status     # health code
#   ./dev.sh logs [n]   # tail the host log
#   ./dev.sh verify     # spawn SQLi+SSRF objectives, exercise the vulns -> debug-results.txt
#
set -uo pipefail
HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="/tmp/trollnet-host.log"
BUILD_LOG="/tmp/trollnet-build.log"
RESULTS="$HOST_DIR/debug-results.txt"
DLL="$HOST_DIR/bin/Debug/net10.0/TrollNet.DesktopHost.dll"
PUB=8080
INT=8081
BASE="http://127.0.0.1:$PUB"

ports_in_use() { ss -ltn 2>/dev/null | grep -E ":$PUB |:$INT " ; }

# Kill the host and free the ports; retry until the ports are actually free.
stop() {
  for _ in 1 2 3 4 5; do
    pkill -f 'TrollNet.DesktopHost' 2>/dev/null
    command -v fuser >/dev/null 2>&1 && fuser -k "${PUB}/tcp" "${INT}/tcp" >/dev/null 2>&1
    if command -v lsof >/dev/null 2>&1; then
      for p in "$PUB" "$INT"; do
        local pids; pids=$(lsof -ti tcp:"$p" 2>/dev/null)
        [ -n "$pids" ] && kill -9 $pids 2>/dev/null
      done
    fi
    sleep 1
    ports_in_use >/dev/null || { echo "stopped; ports $PUB/$INT free"; return 0; }
  done
  echo "WARNING: ports still in use after retries:"; ports_in_use; return 1
}

start() {
  stop || return 1
  echo "building ..."
  if ! dotnet build "$HOST_DIR" -clp:ErrorsOnly >"$BUILD_LOG" 2>&1; then
    echo "BUILD FAILED:"; tail -20 "$BUILD_LOG"; return 1
  fi
  echo "launching (log: $LOG) ..."
  # Run the built DLL directly: a single process whose cmdline contains the dll (clean pkill), with the
  # content root set to HOST_DIR so appsettings.json is found. setsid fully detaches it from this shell.
  setsid bash -c "cd '$HOST_DIR' && exec dotnet '$DLL' > '$LOG' 2>&1" </dev/null &
  for _ in $(seq 1 40); do
    curl -s -o /dev/null "$BASE/health" 2>/dev/null && { echo "READY (health 200)"; return 0; }
    if grep -qE 'address already in use|Unhandled exception' "$LOG" 2>/dev/null; then
      echo "STARTUP FAILED:"; grep -m1 -E 'address already in use|Unhandled exception' "$LOG"; return 1
    fi
    sleep 1
  done
  echo "TIMEOUT waiting for health; log tail:"; tail -15 "$LOG"; return 1
}

status() { echo "health: $(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)"; }

logs() { tail -"${1:-40}" "$LOG" 2>/dev/null || echo "(no log at $LOG)"; }

_id() { grep -oE '"id"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1; }

verify() {
  if ! curl -s -o /dev/null "$BASE/health" 2>/dev/null; then
    echo "host not responding on $BASE — run './dev.sh start' first"; return 1
  fi
  {
    echo "=== $(date -Is) ==="
    echo "-- status --"; status; echo
    echo "-- #01 SQLi (spawn Sqli, then inject) --"
    echo "spawn: $(curl -s -X POST "$BASE/api/dev/spawn" -H 'Content-Type: application/json' -d '{"vector":"Sqli"}')"
    R=$(curl -s -G --data-urlencode "query=' OR 1=1 --" "$BASE/api/posts/search")
    echo "posts via injection: $(printf '%s' "$R" | grep -oE '"id"' | wc -l)"
    echo "flag  via injection: $(printf '%s' "$R" | grep -oE 'TROLL\{[^}]+\}' | head -1)"
    echo "normal 'debugging':  $(curl -s -G --data-urlencode 'query=debugging' "$BASE/api/posts/search" | grep -oE '"id"' | wc -l)"
    echo
    echo "-- #06 SSRF (spawn Ssrf, vault isolation + link-preview chain) --"
    SS=$(curl -s -X POST "$BASE/api/dev/spawn" -H 'Content-Type: application/json' -d '{"vector":"Ssrf"}')
    echo "spawn: $SS"
    ID=$(printf '%s' "$SS" | _id)
    echo "public  vault (want empty+404): [$(curl -s -w ' http=%{http_code}' "$BASE/internal/vault/$ID")]"
    echo "internal vault (want flag):     $(curl -s "http://127.0.0.1:$INT/internal/vault/$ID")"
    echo "link-preview (want flag):       $(curl -s -X POST "$BASE/api/link-preview" -H 'Content-Type: application/json' -d "{\"url\":\"http://127.0.0.1:$INT/internal/vault/$ID\"}")"
    echo
    echo "-- objectives count --"
    echo "objectives: $(curl -s "$BASE/api/objectives" | grep -oE '"id"' | wc -l)"
  } | tee "$RESULTS"
  echo; echo "(results written to $RESULTS)"
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) start ;;
  status)  status ;;
  logs)    logs "${2:-40}" ;;
  verify)  verify ;;
  *) echo "usage: $0 {start|stop|restart|status|logs [n]|verify}" ;;
esac
