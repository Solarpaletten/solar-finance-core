"""
Solar Finance Core — Regime Classifier (Sprint 5)

Orchestrates the regime classification pipeline:

  1. Check Redis cache by source_ts (TTL 60s)
  2. If miss → build prompt from indicators → call Qwen
  3. Validate output against schema + forbidden-word scan
  4. Map invalid LLM output to graceful fallback (INSUFFICIENT_DATA
     with risk_flag), never crash
  5. Cache successful classifications

Prompt template:
  ⚠️  TEMPORARY v1 — drafted by Claude per Dashka's "no deadlock"
      rule. Owned by Solana for refinement in a follow-up sprint.
"""

import json
import logging
from typing import Any, Optional

from pydantic import ValidationError

from llm.qwen_client import (
    QwenBadOutputError,
    QwenError,
    QwenTimeoutError,
    QwenUnreachableError,
    call_qwen_json,
)
from regime.schema import (
    ALLOWED_REGIMES,
    LLMRegimeOutput,
    MIN_TICKS_FOR_CLASSIFICATION,
    RegimeResponse,
    contains_forbidden_word,
)

log = logging.getLogger("solar.regime.classifier")


# ─── Error taxonomy (lifts QwenError into HTTP-mappable signals) ─

class ClassifierTimeoutError(Exception):
    """LLM exceeded timeout. Route handler maps to 504."""


class ClassifierUnreachableError(Exception):
    """LLM unreachable. Route handler maps to 503."""


class ClassifierBadOutputError(Exception):
    """LLM output unusable (non-JSON, forbidden word, schema fail).

    Route handler maps to 502. Note: invalid `regime` value alone is
    NOT mapped here — it's degraded to INSUFFICIENT_DATA inside.
    """


# ─── Cache layer ────────────────────────────────────────────────

CACHE_KEY_PREFIX = "regime:btc:"
CACHE_TTL_SECONDS = 60


def _cache_key(source_ts: str) -> str:
    # source_ts is an ISO8601 string; we trust it because it was
    # produced server-side in /btc/indicators (not user input).
    return f"{CACHE_KEY_PREFIX}{source_ts}"


async def _cache_get(redis_client, source_ts: str) -> Optional[dict]:
    """Return cached dict on hit, None on miss or corruption."""
    try:
        raw = await redis_client.get(_cache_key(source_ts))
    except Exception as exc:
        # Redis flake should NEVER break the endpoint. Treat as miss.
        log.warning("cache get failed: %s", exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as exc:
        # Cache corruption: log and treat as miss so we recompute.
        log.warning("cache corruption at key %s: %s", source_ts, exc)
        return None


async def _cache_set(redis_client, source_ts: str, payload: dict) -> None:
    try:
        await redis_client.setex(
            _cache_key(source_ts),
            CACHE_TTL_SECONDS,
            json.dumps(payload),
        )
    except Exception as exc:
        # Cache write failure must not break the endpoint either.
        log.warning("cache set failed: %s", exc)


# ─── Prompt construction (TEMPORARY v1) ─────────────────────────
# Solana — refine this in the next sprint. Goal of v1: minimal
# instruction set that produces conformant JSON with deterministic
# regime labels under temperature=0, seed=42.

SYSTEM_PROMPT = """You are a deterministic market state classifier.

You receive a JSON object with pre-computed market indicators for a single \
crypto symbol. Your only job is to classify the current market regime and \
respond with a single JSON object — nothing else.

Allowed regime values (use EXACTLY one of these, uppercase):
  - TRENDING_UP        clear upward drift, price above both SMAs, positive distances
  - TRENDING_DOWN      clear downward drift, price below both SMAs, negative distances
  - CONSOLIDATING      low volatility, price near SMAs, small absolute distances
  - VOLATILE_NEUTRAL   elevated volatility with no clear direction
  - INSUFFICIENT_DATA  not enough information to classify confidently

Strict rules:
  - NEVER use the words: buy, sell, long, short, entry, target, guarantee.
  - NEVER give advice, recommendations, predictions, or price targets.
  - NEVER speculate about future moves.
  - Describe ONLY the current observed state.
  - confidence is a float in [0.0, 1.0] reflecting how cleanly the indicators
    match your chosen regime, not a prediction of future accuracy.
  - summary is one short sentence (max 200 chars) describing the observed state.
  - risk_flags is a list of short snake_case tokens, e.g. low_volatility,
    range_compression, near_sma_cluster. Maximum 5 flags. Empty list is fine.

Output schema (the ONLY thing you may return):
{
  "regime": "<one of the allowed values>",
  "confidence": <float 0.0..1.0>,
  "summary": "<short observational sentence>",
  "risk_flags": ["<snake_case_token>", ...]
}
"""


def _user_prompt(indicators: dict[str, Any]) -> str:
    # Send a compact, stable JSON serialization so Qwen sees the
    # same shape every time (helps determinism).
    return "Indicators:\n" + json.dumps(indicators, sort_keys=True)


# ─── Public orchestration ───────────────────────────────────────

async def classify_regime(
    *,
    indicators: dict[str, Any],
    http_client,
    redis_client,
    ollama_url: str,
    model: str,
    timeout_seconds: float = 120.0,
) -> RegimeResponse:
    """
    Produce a RegimeResponse for the given indicators payload.

    Cache hit → return cached response with cached=True.
    Cache miss → call Qwen, validate, store, return cached=False.

    Raises:
        ClassifierTimeoutError
        ClassifierUnreachableError
        ClassifierBadOutputError
    """
    symbol = indicators.get("symbol", "BTCUSDT")
    source_ts = indicators.get("ts", "")
    ticks_used = int(indicators.get("ticks_used", 0))

    # ─── Hard short-circuit on starved input ────────────────────
    # If we don't have enough ticks, do not even ask Qwen.
    # Deterministic, fast, audit-friendly.
    if ticks_used < MIN_TICKS_FOR_CLASSIFICATION:
        return RegimeResponse(
            symbol=symbol,
            regime="INSUFFICIENT_DATA",
            confidence=0.0,
            summary=(
                f"Only {ticks_used} ticks available; "
                f"need {MIN_TICKS_FOR_CLASSIFICATION} for classification."
            ),
            risk_flags=["insufficient_history"],
            source_ts=source_ts,
            model=model,
            cached=False,
            ticks_used=ticks_used,
        )

    # ─── Cache lookup ───────────────────────────────────────────
    cached = await _cache_get(redis_client, source_ts) if source_ts else None
    if cached is not None:
        try:
            response = RegimeResponse(**cached)
            response.cached = True
            return response
        except ValidationError as exc:
            # Corrupted cache entry — recompute.
            log.warning("cache entry failed schema: %s", exc)

    # ─── Call Qwen ──────────────────────────────────────────────
    try:
        raw = await call_qwen_json(
            http_client=http_client,
            ollama_url=ollama_url,
            model=model,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=_user_prompt(indicators),
            timeout_seconds=timeout_seconds,
        )
    except QwenTimeoutError as exc:
        raise ClassifierTimeoutError(str(exc)) from exc
    except QwenUnreachableError as exc:
        raise ClassifierUnreachableError(str(exc)) from exc
    except QwenBadOutputError as exc:
        raise ClassifierBadOutputError(str(exc)) from exc
    except QwenError as exc:
        # Future-proof: any new QwenError subclass we forgot about.
        raise ClassifierBadOutputError(str(exc)) from exc

    # ─── Schema validation ──────────────────────────────────────
    try:
        validated = LLMRegimeOutput(**raw)
    except ValidationError as exc:
        raise ClassifierBadOutputError(
            f"qwen output failed schema: {exc.errors()}"
        ) from exc

    # ─── Forbidden-word scan on `summary` ───────────────────────
    bad_word = contains_forbidden_word(validated.summary)
    if bad_word:
        raise ClassifierBadOutputError(
            f"qwen output contained forbidden word: {bad_word!r}"
        )

    # ─── Regime taxonomy check ──────────────────────────────────
    if validated.regime not in ALLOWED_REGIMES:
        # Graceful fallback per Dashka V2 matrix: degrade, don't fail.
        log.warning(
            "qwen returned out-of-set regime=%r; falling back",
            validated.regime,
        )
        response = RegimeResponse(
            symbol=symbol,
            regime="INSUFFICIENT_DATA",
            confidence=0.0,
            summary=(
                "Classifier returned an unrecognised regime; "
                "degraded to INSUFFICIENT_DATA."
            ),
            risk_flags=["llm_invalid_regime"],
            source_ts=source_ts,
            model=model,
            cached=False,
            ticks_used=ticks_used,
        )
        # We do NOT cache invalid-regime fallbacks — next call may
        # produce a valid one (e.g. after re-warm of the model).
        return response

    response = RegimeResponse(
        symbol=symbol,
        regime=validated.regime,
        confidence=validated.confidence,
        summary=validated.summary,
        risk_flags=validated.risk_flags,
        source_ts=source_ts,
        model=model,
        cached=False,
        ticks_used=ticks_used,
    )

    # ─── Cache the good answer ──────────────────────────────────
    if source_ts:
        await _cache_set(redis_client, source_ts, response.model_dump())

    return response
