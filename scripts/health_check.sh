#!/usr/bin/env bash
# ============================================================
# Solar Finance Core — Full Stack Health Check
# ============================================================
# Task 1 acceptance gate. Exits non-zero on any failure.
# ============================================================

set -uo pipefail

# Load .env if present
if [ -f .env ]; then
    set -o allexport
    # shellcheck disable=SC1091
    source .env
    set +o allexport
fi

API_PORT="${API_PORT:-8000}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
fail=0

check() {
    local name="$1"
    local url="$2"
    echo -n "  [$name] $url ... "
    if response=$(curl -sf -m 120 "$url" 2>&1); then
        echo -e "${GREEN}OK${NC}"
        pass=$((pass + 1))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        echo "    → $response"
        fail=$((fail + 1))
        return 1
    fi
}

echo "=================================================="
echo "Solar Finance Core — Health Check"
echo "=================================================="
echo ""

echo "[1/5] Container status"
for svc in solar_postgres solar_redis solar_ollama solar_api; do
    if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
        echo -e "  ${GREEN}✓${NC} $svc running"
        pass=$((pass + 1))
    else
        echo -e "  ${RED}✗${NC} $svc NOT running"
        fail=$((fail + 1))
    fi
done
echo ""

echo "[2/5] API layer"
check "api-root  " "http://localhost:${API_PORT}/"
check "api-health" "http://localhost:${API_PORT}/health"
echo ""

echo "[3/5] Database layer"
check "db-health " "http://localhost:${API_PORT}/health/db"
echo ""

echo "[4/5] Cache layer"
check "redis     " "http://localhost:${API_PORT}/health/redis"
echo ""

echo "[5/5] LLM layer"
echo -e "  ${YELLOW}Note: first /llm/ping after model load can take 30–90s${NC}"
check "llm-health" "http://localhost:${API_PORT}/health/llm"
check "llm-ping  " "http://localhost:${API_PORT}/llm/ping"
echo ""

echo "=================================================="
echo "Summary: ${GREEN}${pass} passed${NC}, ${RED}${fail} failed${NC}"
echo "=================================================="

if [ "$fail" -eq 0 ]; then
    echo -e "${GREEN}✓ ALL SYSTEMS GO${NC}"
    echo ""
    echo "Task 1 acceptance criteria met:"
    echo "  → API responds 200"
    echo "  → PostgreSQL + TimescaleDB live"
    echo "  → Redis live"
    echo "  → Qwen 2.5 72B Q4_K_M loaded and responding"
    echo ""
    echo "Report this status to Dashka. Awaiting Task 2."
    exit 0
else
    echo -e "${RED}✗ Some checks failed. See details above.${NC}"
    echo ""
    echo "Common causes:"
    echo "  - Model not pulled yet: run 'make pull-model'"
    echo "  - First LLM load: wait 60s, retry"
    echo "  - Logs: 'make logs' (or: docker compose logs <service>)"
    exit 1
fi
