// Solar Finance Core — API type definitions (Sprint 7)
//
// Mirrors the shape of:
//   GET /market/btc/regime     → RegimeResponse (Sprint 6 schema)
//   GET /market/btc/indicators → IndicatorsResponse (Sprint 4.5)
//   GET /market/btc/latest     → LatestTick
//   GET /market/btc/history    → HistoryTick[]
//
// Keep this file as the single source of truth for the API contract
// on the frontend side. If the backend RegimeResponse changes, this
// is the file to update first.

export type Regime =
  | "CONSOLIDATING"
  | "BULLISH_MOMENTUM"
  | "BEARISH_PRESSURE"
  | "BREAKOUT_ATTEMPT"
  | "HIGH_VOLATILITY"
  | "RANGE_EXPANSION"
  | "VOLATILE_NEUTRAL"
  | "INSUFFICIENT_DATA";

export type RiskFlag =
  | "low_volatility"
  | "high_volatility"
  | "range_compression"
  | "near_sma_cluster"
  | "breakout_potential"
  | "squeeze_potential"
  | "bearish_pressure"
  | "bullish_momentum"
  | "expansion_phase"
  | "unstable";

export interface RegimeResponse {
  symbol: string;
  regime: Regime;
  confidence: number;
  summary: string;
  risk_flags: RiskFlag[];
  source_ts: string;
  model: string;
  cached: boolean;
  ticks_used: number;
  computed_at: string;
  served_at: string;
  cache_age_seconds: number;
}

export interface IndicatorsResponse {
  symbol: string;
  price: number;
  sma20: number | null;
  sma50: number | null;
  volatility_pct: number | null;
  distance_to_sma20_pct: number | null;
  distance_to_sma50_pct: number | null;
  ticks_used: number;
  ts: string;
}

export interface LatestTick {
  ts: string;
  symbol: string;
  price: number;
}

export interface HistoryTick {
  ts: string;
  price: number;
}

// Discriminated union for fetch outcomes — keeps error handling honest.
export type Fetched<T> =
  | { state: "loading" }
  | { state: "ok"; data: T; fetchedAt: number }
  | { state: "error"; message: string; status?: number };
