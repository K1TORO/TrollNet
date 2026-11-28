#!/usr/bin/env bash
# Publish the merged .NET host as a self-contained single-file binary and place it where Tauri expects a
# sidecar: src-tauri/binaries/trollnet-host-<rust-target-triple>. No system .NET is needed to RUN the result.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$SCRIPT_DIR/../host"
BIN_DIR="$SCRIPT_DIR/../app/src-tauri/binaries"
RID="${RID:-linux-x64}"

# Tauri names sidecars by the Rust *host* triple (e.g. x86_64-unknown-linux-gnu).
TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
[ -n "$TRIPLE" ] || { echo "could not determine rust host triple (is rustc installed?)"; exit 1; }

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

echo "Publishing self-contained host  (RID=$RID)…"
dotnet publish "$HOST_DIR" -c Release -r "$RID" --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:EnableCompressionInSingleFile=true \
  -o "$OUT"

mkdir -p "$BIN_DIR"
DEST="$BIN_DIR/trollnet-host-$TRIPLE"
cp "$OUT/TrollNet.DesktopHost" "$DEST"
chmod +x "$DEST"

echo
echo "Sidecar binary: $DEST"
ls -lh "$DEST"
