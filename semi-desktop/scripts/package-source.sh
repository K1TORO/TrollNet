#!/usr/bin/env bash
# Package the source tree for sharing (e.g. Google Drive), WITHOUT build output, dependencies, the downloaded
# model/runtime, or local databases. The receiver rebuilds those by following semi-desktop/docs/BUILD.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJ="$(basename "$ROOT")"
cd "$ROOT"

EXCLUDES=(
  '*/.git/*' '*/bin/*' '*/obj/*' '*/node_modules/*' '*/dist/*'
  '*/target/*' '*/gen/*' 'semi-desktop/model/*' 'semi-desktop/runtime/*'
  'semi-desktop/app/src-tauri/binaries/*' '*.db' '*.db-shm' '*.db-wal'
)

if command -v zip >/dev/null 2>&1; then
  OUT="${1:-$ROOT/trollnet-source.zip}"
  rm -f "$OUT"
  zx=(); for e in "${EXCLUDES[@]}"; do zx+=( -x "$e" ); done
  zip -r "$OUT" . "${zx[@]}" > /dev/null
else
  # Fallback: tar.gz (tar is always available on Linux).
  OUT="${1:-$ROOT/trollnet-source.tar.gz}"
  rm -f "$OUT"
  tx=(); for e in "${EXCLUDES[@]}"; do tx+=( --exclude="$e" ); done
  tar "${tx[@]}" -czf "$OUT" .
fi

echo "Created: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Rebuild instructions for the receiver: semi-desktop/docs/BUILD.md"
