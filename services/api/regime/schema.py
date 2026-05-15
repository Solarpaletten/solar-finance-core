"""
Solar Finance Core — Regime Schema (Sprint 5)

Pydantic models and constants for /market/btc/regime.

Single source of truth for:
  - allowed regime values
  - forbidden vocabulary that Qwen must NEVER produce
  - response shape returned to the API caller
"""

from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ─── Allowed regime taxonomy (V1 — Dashka approved) ─────────────
# Any value outside this set is treated as invalid and degraded to
# INSUFFICIENT_DATA with a risk flag (see classifier.py).
ALLOWED_REGIMES: frozenset[str] = frozenset({
    "TRENDING_UP",
    "TRENDING_DOWN",
    "CONSOLIDATING",
    "VOLATILE_NEUTRAL",
    "INSUFFICIENT_DATA",
})


# ─── Forbidden vocabulary (Dashka TZ — critical) ────────────────
# If any of these tokens appear in Qwen's `summary` (case-insensitive,
# word-boundary), the response is rejected with HTTP 502.
# This is a runtime safety net on top of the system prompt.
FORBIDDEN_WORDS: frozenset[str] = frozenset({
    "buy", "sell", "long", "short",
    "entry", "target", "guarantee",
})


# ─── Threshold below which we hard-classify as INSUFFICIENT_DATA ─
# Qwen is never asked about the regime if we already know there
# are not enough ticks. This prevents hallucinated confidence on
# starved input.
MIN_TICKS_FOR_CLASSIFICATION: int = 30


# ─── Pydantic models ────────────────────────────────────────────

class LLMRegimeOutput(BaseModel):
    """
    The strict shape we require from Qwen's JSON response.

    Pydantic rejects extra fields implicitly via assignment, and
    `field_validator` enforces value constraints.
    """

    regime: str
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str = Field(min_length=1, max_length=500)
    risk_flags: list[str] = Field(default_factory=list)

    @field_validator("regime")
    @classmethod
    def _regime_must_be_uppercase(cls, v: str) -> str:
        # Don't enforce ALLOWED_REGIMES here — classifier handles
        # the fallback to INSUFFICIENT_DATA gracefully. We only
        # normalise casing so downstream comparisons are stable.
        return v.strip().upper()

    @field_validator("risk_flags")
    @classmethod
    def _risk_flags_bounded(cls, v: list[str]) -> list[str]:
        # Cap to 10 to avoid runaway LLM output.
        return [str(x)[:64] for x in v[:10]]


class RegimeResponse(BaseModel):
    """
    Final API response shape for GET /market/btc/regime.
    """

    symbol: str
    regime: str
    confidence: float
    summary: str
    risk_flags: list[str]
    source_ts: str
    model: str
    cached: bool = False
    ticks_used: int


# ─── Helpers ────────────────────────────────────────────────────

def contains_forbidden_word(text: Optional[str]) -> Optional[str]:
    """
    Return the first forbidden word found in `text`, or None.

    Match is case-insensitive and bounded by non-letter characters
    so substrings like 'absorb' don't trigger 'sorb'. We use a
    simple regex-free token scan to keep dependencies minimal.
    """
    if not text:
        return None
    # Build a lowercased copy with non-letters replaced by spaces.
    # Then tokenise. This is faster and clearer than a regex.
    buf = []
    for ch in text.lower():
        buf.append(ch if ch.isalpha() else " ")
    tokens = "".join(buf).split()
    for tok in tokens:
        if tok in FORBIDDEN_WORDS:
            return tok
    return None
