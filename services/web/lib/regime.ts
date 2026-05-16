// Solar Finance Core — Regime visual mapping (Sprint 7)
//
// Maps Solana v2 LLM taxonomy to UI presentation:
//   - tailwind color class for the accent
//   - human label (uppercase, monospace)
//   - short description used in tooltips / detail page

import type { Regime } from "./types";

interface RegimeStyle {
  /** Tailwind background utility for filled badges */
  bg: string;
  /** Tailwind text utility for outline / accent text */
  text: string;
  /** Tailwind border utility for outline cards */
  border: string;
  /** Tailwind ring color used for pulsing live indicator */
  ring: string;
  /** Short uppercase label shown on the card */
  label: string;
  /** One-line description shown on hover and detail page */
  description: string;
}

export const REGIME_STYLES: Record<Regime, RegimeStyle> = {
  CONSOLIDATING: {
    bg: "bg-regime-consolidating",
    text: "text-regime-consolidating",
    border: "border-regime-consolidating",
    ring: "ring-regime-consolidating",
    label: "CONSOLIDATING",
    description: "Low volatility, price tightly between SMA20 and SMA50.",
  },
  BULLISH_MOMENTUM: {
    bg: "bg-regime-bullish-momentum",
    text: "text-regime-bullish-momentum",
    border: "border-regime-bullish-momentum",
    ring: "ring-regime-bullish-momentum",
    label: "BULLISH MOMENTUM",
    description: "Price above both SMAs with positive distances.",
  },
  BEARISH_PRESSURE: {
    bg: "bg-regime-bearish-pressure",
    text: "text-regime-bearish-pressure",
    border: "border-regime-bearish-pressure",
    ring: "ring-regime-bearish-pressure",
    label: "BEARISH PRESSURE",
    description: "Price below both SMAs with negative distances.",
  },
  BREAKOUT_ATTEMPT: {
    bg: "bg-regime-breakout-attempt",
    text: "text-regime-breakout-attempt",
    border: "border-regime-breakout-attempt",
    ring: "ring-regime-breakout-attempt",
    label: "BREAKOUT ATTEMPT",
    description: "Sharp expansion in distance to nearest SMA.",
  },
  HIGH_VOLATILITY: {
    bg: "bg-regime-high-volatility",
    text: "text-regime-high-volatility",
    border: "border-regime-high-volatility",
    ring: "ring-regime-high-volatility",
    label: "HIGH VOLATILITY",
    description: "Volatility elevated, no clear direction.",
  },
  RANGE_EXPANSION: {
    bg: "bg-regime-range-expansion",
    text: "text-regime-range-expansion",
    border: "border-regime-range-expansion",
    ring: "ring-regime-range-expansion",
    label: "RANGE EXPANSION",
    description: "SMA20 / SMA50 gap widening rapidly.",
  },
  VOLATILE_NEUTRAL: {
    bg: "bg-regime-volatile-neutral",
    text: "text-regime-volatile-neutral",
    border: "border-regime-volatile-neutral",
    ring: "ring-regime-volatile-neutral",
    label: "VOLATILE NEUTRAL",
    description: "High volatility oscillating around the SMAs.",
  },
  INSUFFICIENT_DATA: {
    bg: "bg-regime-insufficient-data",
    text: "text-regime-insufficient-data",
    border: "border-regime-insufficient-data",
    ring: "ring-regime-insufficient-data",
    label: "INSUFFICIENT DATA",
    description: "Not enough ticks to classify the current state.",
  },
};

// ─── Formatters ─────────────────────────────────────────────────

export function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(value: number | null, digits = 4): string {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a UTC ISO-8601 string as a relative-age string.
 *   < 5s   → "LIVE"
 *   < 60s  → "Ns ago"
 *   < 1h   → "Nm ago"
 *   else   → ISO date
 */
export function formatAge(seconds: number): string {
  if (seconds < 5) return "LIVE";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Returns a single-character status glyph for the cache_age_seconds.
 *   ● green  — fresh (<30s)
 *   ● amber  — aging (30-120s)
 *   ● red    — stale (>120s)
 */
export function ageSeverity(seconds: number): "fresh" | "aging" | "stale" {
  if (seconds < 30) return "fresh";
  if (seconds < 120) return "aging";
  return "stale";
}
