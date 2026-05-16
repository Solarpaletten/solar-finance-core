"""
Solar Finance Core — Regime Classification Route (Sprint 5)

Sprint 5.1 change:
  - timeout_seconds explicit value raised 120 → 300 seconds.
  - Pairs with the 32B model switch in Sprint 5.1: 32B normally
    completes warm inference in 10-60s, but cold-start under M4
    memory pressure can stretch close to 2 minutes. 300s gives a
    comfortable floor.

GET /market/btc/regime — orchestrates:
  1. compute deterministic indicators (shared helper from routes.market)
  2. classify regime via Qwen with cache + fallback
  3. return RegimeResponse JSON

This module is the only HTTP-facing surface for the reasoning layer.
All math lives in indicators.py, all LLM logic lives in regime/
package. We keep this route file thin and obvious.

HTTP status mapping (Dashka V2 matrix):

    DB read failed             -> 503  "db read failed"
    No ticks in DB             -> 404  "no ticks stored yet"
    LLM timeout                -> 504  "llm timeout"
    LLM unreachable            -> 503  "llm unreachable"
    LLM bad output / forbidden -> 502  "llm output rejected"
    Invalid regime value       -> 200  (degraded to INSUFFICIENT_DATA)
    Insufficient ticks         -> 200  (hard-classified INSUFFICIENT_DATA)
    Success                    -> 200  RegimeResponse
"""

import logging

from fastapi import APIRouter, HTTPException, Request

from config import settings
from regime.classifier import (
    ClassifierBadOutputError,
    ClassifierTimeoutError,
    ClassifierUnreachableError,
    classify_regime,
)
from routes.market import compute_btc_indicators

log = logging.getLogger("solar.regime.route")

router = APIRouter(prefix="/market", tags=["regime"])


@router.get("/btc/regime")
async def get_btc_regime(request: Request):
    """
    Classify the current BTC market regime using deterministic
    indicators + Qwen reasoning.

    Cache: Redis, key=regime:btc:<source_ts>, TTL=60s.
    Determinism: temperature=0, seed=42 on Ollama side.

    See module docstring for the full HTTP status mapping.
    """
    # ─── Step 1: indicators (shared helper) ─────────────────────
    try:
        indicators = await compute_btc_indicators(request.app.state.pg_pool)
    except Exception as exc:
        log.exception("db error in /btc/regime")
        raise HTTPException(
            status_code=503,
            detail=f"db read failed: {exc}",
        )

    if indicators is None:
        raise HTTPException(
            status_code=404,
            detail="no ticks stored yet — call POST /market/btc/snapshot first",
        )

    # ─── Step 2: classify ───────────────────────────────────────
    try:
        response = await classify_regime(
            indicators=indicators,
            http_client=request.app.state.http,
            redis_client=request.app.state.redis,
            ollama_url=settings.ollama_url,
            model=settings.OLLAMA_MODEL,
            timeout_seconds=300.0,
        )
    except ClassifierTimeoutError as exc:
        log.warning("/btc/regime LLM timeout: %s", exc)
        raise HTTPException(status_code=504, detail=f"llm timeout: {exc}")
    except ClassifierUnreachableError as exc:
        log.warning("/btc/regime LLM unreachable: %s", exc)
        raise HTTPException(status_code=503, detail=f"llm unreachable: {exc}")
    except ClassifierBadOutputError as exc:
        log.warning("/btc/regime LLM bad output: %s", exc)
        raise HTTPException(status_code=502, detail=f"llm output rejected: {exc}")

    return response.model_dump()
