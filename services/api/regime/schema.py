"""
Solar Finance Core — Regime Schema (Sprint 5.1)

Pydantic models and constants for /market/btc/regime.

Sprint 5.1 changes (vs Sprint 5):
  - ALLOWED_REGIMES expanded from 5 → 8 (Solana v2 taxonomy + system fallback)
  - FORBIDDEN_WORDS expanded from 7 → 13 (Solana v2 additions)
  - ALLOWED_RISK_FLAGS introduced — closed ontology for risk_flags
  - LLM_VISIBLE_REGIMES separated from system-only INSUFFICIENT_DATA

Single source of truth for:
  - allowed regime values (with explicit LLM vs system layering)
  - forbidden vocabulary that Qwen must NEVER produce
  - risk_flags ontology (soft-enforced: unknown flags are dropped)
  - response shape returned to the API caller
"""

from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ─── Allowed regime taxonomy (Solana v2, Dashka approved) ───────
# Two-layer design:
#
#   LLM_VISIBLE_REGIMES — the only values Qwen is allowed to pick.
#                         Mentioned in the system prompt.
#
#   ALLOWED_REGIMES     — the union with INSUFFICIENT_DATA, which is
#                         a system-only fallback Python emits when:
#                           - ticks_used < MIN_TICKS_FOR_CLASSIFICATION
#                           - LLM returned an out-of-set regime
#
# This separation prevents the LLM from defensively answering
# "INSUFFICIENT_DATA" on borderline cases instead of committing
# to a real classification.
LLM_VISIBLE_REGIMES: frozenset[str] = frozenset({
    "CONSOLIDATING",
    "BULLISH_MOMENTUM",
    "BEARISH_PRESSURE",
    "BREAKOUT_ATTEMPT",
    "HIGH_VOLATILITY",
    "RANGE_EXPANSION",
    "VOLATILE_NEUTRAL",
})

ALLOWED_REGIMES: frozenset[str] = LLM_VISIBLE_REGIMES | {"INSUFFICIENT_DATA"}


# ─── Forbidden vocabulary (Solana v2, Dashka approved) ──────────
# If any of these tokens appear in Qwen's `summary` (case-insensitive,
# word-boundary), the response is rejected with HTTP 502.
# Runtime enforcement is stricter than the system prompt.
FORBIDDEN_WORDS: frozenset[str] = frozenset({
    # Trading-action vocabulary
    "buy", "sell", "long", "short",
    "entry", "target", "guarantee",
    # Sprint 5.1 — Solana additions
    "forecast", "predict", "prediction",
    "advice", "recommend", "recommendation",
})


# ─── Risk-flag ontology (Solana v2) ─────────────────────────────
# Closed set. Unknown flags from the LLM are silently dropped
# (soft enforcement). We never reject a response just because the
# LLM hallucinated a flag — we just clean it up.
ALLOWED_RISK_FLAGS: frozenset[str] = frozenset({
    "low_volatility",
    "high_volatility",
    "range_compression",
    "near_sma_cluster",
    "breakout_potential",
    "squeeze_potential",
    "bearish_pressure",
    "bullish_momentum",
    "expansion_phase",
    "unstable",
})


# ─── Threshold below which we hard-classify as INSUFFICIENT_DATA ─
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
        # Don't enforce LLM_VISIBLE_REGIMES here — classifier handles
        # the fallback to INSUFFICIENT_DATA gracefully. We only
        # normalise casing so downstream comparisons are stable.
        return v.strip().upper()

    @field_validator("risk_flags")
    @classmethod
    def _risk_flags_normalize(cls, v: list[str]) -> list[str]:
        # Lowercase, cap to 10 to avoid runaway LLM output.
        normalized = [str(x).strip().lower()[:64] for x in v[:10]]
        return [f for f in normalized if f]


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
    so substrings like 'buying' or 'longitudinal' don't trigger.
    We use a simple regex-free token scan to keep dependencies minimal.
    """
    if not text:
        return None
    buf = []
    for ch in text.lower():
        buf.append(ch if ch.isalpha() else " ")
    tokens = "".join(buf).split()
    for tok in tokens:
        if tok in FORBIDDEN_WORDS:
            return tok
    return None


def clean_risk_flags(flags: list[str]) -> list[str]:
    """
    Drop unknown / unrecognised flags. Preserve order, dedupe.

    Soft enforcement: an LLM-emitted flag outside ALLOWED_RISK_FLAGS
    is removed silently. This keeps the response clean without
    failing the whole request.
    """
    seen: set[str] = set()
    out: list[str] = []
    for f in flags:
        f_clean = (f or "").strip().lower()
        if f_clean in ALLOWED_RISK_FLAGS and f_clean not in seen:
            seen.add(f_clean)
            out.append(f_clean)
    return out
