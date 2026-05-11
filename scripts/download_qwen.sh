#!/usr/bin/env bash
# ============================================================
# Solar Finance Core — Qwen 2.5 72B Q4_K_M Downloader
# ============================================================
# Downloads the model into the ollama container's volume.
# Expected time: 40–60 minutes on a typical home connection (~43GB).
# Safe to re-run: ollama pull is idempotent.
# ============================================================

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
    set -o allexport
    # shellcheck disable=SC1091
    source .env
    set +o allexport
fi

MODEL="${OLLAMA_MODEL:-qwen2.5:72b-instruct-q4_K_M}"

echo "=================================================="
echo "Solar Finance Core — Model Download"
echo "=================================================="
echo "Model:   $MODEL"
echo "Target:  solar_ollama container volume"
echo "Expect:  ~43 GB, 40–60 minutes typical"
echo "=================================================="
echo ""

# Make sure the ollama container is up
if ! docker ps --format '{{.Names}}' | grep -q '^solar_ollama$'; then
    echo "ERROR: solar_ollama container is not running."
    echo "Run 'make up' first, then re-run this script."
    exit 1
fi

echo "Starting pull (progress will be shown by ollama)..."
docker exec solar_ollama ollama pull "$MODEL"

echo ""
echo "Download complete. Verifying..."
docker exec solar_ollama ollama list

echo ""
echo "✓ Model ready. You can now run: make health"
