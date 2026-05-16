// Solar Finance Core — API client (Sprint 7)
//
// All requests go through /api/* and are rewritten to the FastAPI
// backend at http://localhost:8000 by next.config.js. This sidesteps
// CORS in development. In Sprint 7.1, when web ships in docker, the
// rewrite target will change (or be replaced by direct container DNS).

import type {
  HistoryTick,
  IndicatorsResponse,
  LatestTick,
  RegimeResponse,
} from "./types";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  // The regime endpoint can stall behind a cold Qwen compute (up to
  // a few minutes). We don't enforce a tight client-side timeout
  // here — the backend has its own 300s timeout and graceful 504.
  // The polling hook is responsible for cancellation on unmount.
  const res = await fetch(path, {
    method: "GET",
    signal,
    // Skip Next.js fetch caching: we want live data every poll.
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch {
      // Body wasn't JSON. Fall through with empty detail.
    }
    throw new ApiError(
      res.status,
      detail || `HTTP ${res.status} ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

export function fetchRegime(signal?: AbortSignal): Promise<RegimeResponse> {
  return getJson<RegimeResponse>("/api/market/btc/regime", signal);
}

export function fetchIndicators(
  signal?: AbortSignal,
): Promise<IndicatorsResponse> {
  return getJson<IndicatorsResponse>("/api/market/btc/indicators", signal);
}

export function fetchLatest(signal?: AbortSignal): Promise<LatestTick> {
  return getJson<LatestTick>("/api/market/btc/latest", signal);
}

export function fetchHistory(
  limit = 100,
  signal?: AbortSignal,
): Promise<HistoryTick[]> {
  return getJson<HistoryTick[]>(`/api/market/btc/history?limit=${limit}`, signal);
}

export { ApiError };
