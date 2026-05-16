"""
Solar Finance Core — Regime Classifier (Sprint 5.1)

Sprint 5.1 changes (vs Sprint 5):
  - SYSTEM_PROMPT replaced with Solana v2 (production-grade)
  - num_ctx reduced from 32768 to 4096 (fixes OOM on Qwen 72B)
  - Regime validation switched from ALLOWED_REGIMES to LLM_VISIBLE_REGIMES
    (LLM is not supposed to emit INSUFFICIENT_DATA — that's system-only)
  - risk_flags cleaned via clean_risk_flags (soft enforcement of ontology)

Orchestrates the regime classification pipeline:

  1. Check Redis cache by source_ts (TTL 60s)
  2. Hard-classify INSUFFICIENT_DATA if ticks < threshold
  3. If miss → build prompt from indicators → call Qwen with num_ctx=4096
  4. Validate output against schema + forbidden-word scan
  5. Map invalid LLM output to graceful fallback (INSUFFICIENT_DATA
     with risk_flag), never crash
  6. Cache successful classifications
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
    LLMRegimeOutput,
    LLM_VISIBLE_REGIMES,
    MIN_TICKS_FOR_CLASSIFICATION,
    RegimeResponse,
    clean_risk_flags,
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

# Qwen call configuration — num_ctx reduced for Sprint 5.1.
# Our prompt + payload is ~1.5 KB; 4096 tokens is plenty and
# keeps the KV cache footprint small enough for 72B Q4_K_M on M4.
QWEN_NUM_CTX = 4096


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


# ─── Prompt v2 (Solana, Dashka approved) ────────────────────────
# Production-grade prompt. Key properties:
#   - Constrained regime ontology (7 LLM-visible values, NO mention
#     of INSUFFICIENT_DATA — that's our internal fallback)
#   - Closed risk_flags ontology (10 values)
#   - Wider forbidden-word list (13 words enforced at runtime too)
#   - Single-sentence factual summary, no speculation
#   - Strict JSON-only output

SYSTEM_PROMPT = """You are a deterministic market regime classifier.

Your only job is to analyze pre-computed mathematical indicators for a single \
crypto symbol and return a structured JSON describing the current market state.

Allowed regimes (choose EXACTLY one, uppercase, nothing else):
  - CONSOLIDATING       low volatility, price tightly between SMA20 and SMA50
  - BULLISH_MOMENTUM    price above both SMAs with positive distances, moderate volatility
  - BEARISH_PRESSURE    price below both SMAs with negative distances
  - BREAKOUT_ATTEMPT    sharp expansion in distance to nearest SMA with rising volatility
  - HIGH_VOLATILITY     volatility_pct above 3.5 with no clear directional bias
  - RANGE_EXPANSION     SMA20/SMA50 gap widening quickly
  - VOLATILE_NEUTRAL    high volatility but price oscillates around the SMAs without direction

Suggested numeric guides (not strict, use judgement):
  - volatility_pct < 0.5  suggests low-vol / CONSOLIDATING
  - volatility_pct > 3.5  suggests HIGH_VOLATILITY
  - |distance_to_sma20_pct| > 1.2 and growing suggests BREAKOUT_ATTEMPT

Strict rules — NEVER break these:
  - NEVER use any of these words: buy, sell, long, short, entry, target,
    guarantee, forecast, predict, prediction, advice, recommend, recommendation.
  - NEVER give advice, opinions, predictions, or price targets.
  - NEVER speculate about future moves.
  - Describe ONLY the current observed state.
  - confidence is a float in [0.0, 1.0] reflecting how cleanly the indicators
    match your chosen regime. It is NOT a prediction of future accuracy.
  - summary is at most two short factual sentences (max 200 chars total).
  - risk_flags must be chosen ONLY from this closed set:
        low_volatility, high_volatility, range_compression,
        near_sma_cluster, breakout_potential, squeeze_potential,
        bearish_pressure, bullish_momentum, expansion_phase, unstable
    Maximum 5 flags. Empty list is acceptable.

Output schema (the ONLY thing you may return — pure JSON, no prose):
{
  "regime": "<one of the 7 allowed values>",
  "confidence": <float 0.0..1.0>,
  "summary": "<one or two short observational sentences>",
  "risk_flags": ["<snake_case_token from ontology>", ...]
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
    timeout_seconds: float = 300.0,
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
            risk_flags=["unstable"],
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

    # ─── Call Qwen with bounded context (Sprint 5.1: num_ctx=4096) ─
    try:
        raw = await call_qwen_json(
            http_client=http_client,
            ollama_url=ollama_url,
            model=model,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=_user_prompt(indicators),
            timeout_seconds=timeout_seconds,
            num_ctx=QWEN_NUM_CTX,
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

    # ─── Risk flags: soft enforcement of closed ontology ────────
    cleaned_flags = clean_risk_flags(validated.risk_flags)

    # ─── Regime taxonomy check (Sprint 5.1: LLM_VISIBLE_REGIMES) ─
    # LLM is allowed to pick only from the 7 visible regimes.
    # INSUFFICIENT_DATA is reserved for system use; if LLM picks it
    # (e.g. defensively), we treat that as an out-of-set fallback too.
    if validated.regime not in LLM_VISIBLE_REGIMES:
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
            risk_flags=["unstable"],
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
        risk_flags=cleaned_flags,
        source_ts=source_ts,
        model=model,
        cached=False,
        ticks_used=ticks_used,
    )

    # ─── Cache the good answer ──────────────────────────────────
    if source_ts:
        await _cache_set(redis_client, source_ts, response.model_dump())

    return response
