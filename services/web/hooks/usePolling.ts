"use client";

// Solar Finance Core — Polling hook (Sprint 7)
//
// Generic polling: calls `fetcher(signal)` every `intervalMs` until
// the component unmounts. Aborts in-flight requests on unmount and
// on each new tick to prevent stale writes.
//
// Sprint 7 strategy: 5s polling on the dashboard. Backend cache hit
// is ~26ms so this is essentially free.
// In Sprint 8 we may swap this for SSE / WebSocket.

import { useEffect, useRef, useState } from "react";

import type { Fetched } from "@/lib/types";

interface PollingOptions {
  intervalMs: number;
  /** If true, fire one fetch immediately on mount (default true) */
  immediate?: boolean;
  /** Disable polling without unmounting the hook */
  paused?: boolean;
}

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PollingOptions,
): Fetched<T> {
  const { intervalMs, immediate = true, paused = false } = options;
  const [state, setState] = useState<Fetched<T>>({ state: "loading" });
  const fetcherRef = useRef(fetcher);

  // Keep latest fetcher in a ref to avoid resetting the interval on
  // every render when the caller passes an inline function.
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    if (paused) return;

    let cancelled = false;
    let controller: AbortController | null = null;

    const tick = async () => {
      if (cancelled) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await fetcherRef.current(controller.signal);
        if (!cancelled) {
          setState({ state: "ok", data, fetchedAt: Date.now() });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: number }).status
            : undefined;
        const message =
          err instanceof Error ? err.message : "unknown error";
        setState({ state: "error", message, status });
      }
    };

    if (immediate) void tick();
    const id = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      controller?.abort();
    };
  }, [intervalMs, immediate, paused]);

  return state;
}
