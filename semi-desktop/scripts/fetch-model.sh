#!/usr/bin/env bash
# Fetch the llama.cpp CPU server and the qwen GGUF into semi-desktop/runtime and semi-desktop/model.
# These are bundled into the desktop app as resources (see tauri.conf.json). They are gitignored (large),
# so run this once before `cargo tauri build`.
#
# NOTE: the llama.cpp directory name (llama-<tag>) and the model filename are referenced by main.rs and
# tauri.conf.json. If you change LLAMA_TAG or the model, update those too.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SD="$(cd "$SCRIPT_DIR/.." && pwd)"

LLAMA_TAG="${LLAMA_TAG:-b12819}"
MODEL_FILE="qwen2.5-3b-instruct-q4_k_m.gguf"
MODEL_URL="${MODEL_URL:-https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf}"

# --- llama.cpp CPU build (llama-server + libs) ---
if [ -x "$SD/runtime/llama-$LLAMA_TAG/llama-server" ]; then
  echo "llama.cpp $LLAMA_TAG already present."
else
  echo "Downloading llama.cpp $LLAMA_TAG (CPU, ubuntu-x64)…"
  mkdir -p "$SD/runtime"
  curl -fL -o "$SD/runtime/llama.tar.gz" \
    "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/llama-$LLAMA_TAG-bin-ubuntu-x64.tar.gz"
  tar xzf "$SD/runtime/llama.tar.gz" -C "$SD/runtime"
  rm -f "$SD/runtime/llama.tar.gz"
fi

# --- qwen GGUF model (~1.9 GB) ---
if [ -f "$SD/model/$MODEL_FILE" ]; then
  echo "Model already present."
else
  echo "Downloading model (~1.9 GB)…"
  mkdir -p "$SD/model"
  curl -fL -o "$SD/model/$MODEL_FILE" "$MODEL_URL"
fi

echo
echo "runtime: $SD/runtime/llama-$LLAMA_TAG/llama-server"
echo "model:   $SD/model/$MODEL_FILE"
