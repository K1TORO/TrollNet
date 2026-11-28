#!/usr/bin/env bash
# Quick relaunch of the TrollNet desktop app in dev (spawns the self-contained host sidecar).
# If you changed the .NET host, rebuild the sidecar first:  ../scripts/build-host-sidecar.sh
# If you changed the frontend, rebuild it first:            (cd ../../frontend && npm run build)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkill -f trollnet-desktop 2>/dev/null
pkill -f trollnet-host 2>/dev/null
pkill -f TrollNet.DesktopHost 2>/dev/null
sleep 1
cd "$DIR"
exec cargo tauri dev
