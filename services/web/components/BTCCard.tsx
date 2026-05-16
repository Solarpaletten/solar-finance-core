"use client";

// Solar Finance Core — BTCCard (Sprint 7)
//
// The hero card on the main dashboard. Combines:
//   - symbol header
//   - live price (telemetry-large)
//   - regime badge (color-coded)
//   - confidence
//   - LLM summary
//   - risk_flags
//   - SMA/volatility indicators
//   - cache freshness footer
//   - "Detail" link
//
// Data sources: /market/btc/regime + /market/btc/indicators
// Both polled every 5s through usePolling.

import Link from "next/link";

import { CacheFreshness } from "@/components/CacheFreshness";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { RegimeBadge } from "@/components/RegimeBadge";
import { RiskFlagPill } from "@/components/RiskFlagPill";
import { TelemetryRow } from "@/components/TelemetryRow";
import { usePolling } from "@/hooks/usePolling";
import { fetchIndicators, fetchRegime } from "@/lib/api";
import {
  formatConfidence,
  formatPct,
  formatPrice,
} from "@/lib/regime";

const POLL_INTERVAL_MS = 5000;

export function BTCCard() {
  const regime = usePolling(fetchRegime, { intervalMs: POLL_INTERVAL_MS });
  const indicators = usePolling(fetchIndicators, { intervalMs: POLL_INTERVAL_MS });

  // ── Loading state ───────────────────────────────────────────
  if (regime.state === "loading" || indicators.state === "loading") {
    return (
      <CardShell>
        <div className="flex h-64 items-center justify-center">
          <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.25em] text-solar-fade">
            <span className="inline-block h-2 w-2 animate-blink bg-solar-amber" />
            ESTABLISHING TELEMETRY LINK
          </div>
        </div>
      </CardShell>
    );
  }

  // ── Error state ─────────────────────────────────────────────
  // We surface BOTH errors if they exist. Most commonly the regime
  // endpoint is the one to fail (Qwen down) while indicators stay OK.
  if (regime.state === "error" || indicators.state === "error") {
    const detail =
      regime.state === "error"
        ? regime.message
        : indicators.state === "error"
          ? indicators.message
          : "unknown";
    const status =
      regime.state === "error"
        ? regime.status
        : indicators.state === "error"
          ? indicators.status
          : undefined;

    return (
      <CardShell>
        <div className="flex flex-col items-start gap-4 p-6">
          <ConnectionStatus
            state="error"
            label={regime.state === "error" ? "REGIME" : "INDICATORS"}
            detail={status ? `HTTP ${status}` : undefined}
          />
          <div className="font-mono text-xs leading-relaxed text-solar-fade">
            <span className="text-solar-flare">ERROR · </span>
            {detail}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade/60">
            Retrying in {POLL_INTERVAL_MS / 1000}s
          </div>
        </div>
      </CardShell>
    );
  }

  // ── OK state ────────────────────────────────────────────────
  const r = regime.data;
  const ind = indicators.data;

  // Determine trend glyphs from distances. Tiny absolute values flat.
  const trend20 = trendOf(ind.distance_to_sma20_pct);
  const trend50 = trendOf(ind.distance_to_sma50_pct);

  return (
    <CardShell>
      {/* ── Header strip ── */}
      <div className="flex items-center justify-between border-b border-solar-grid px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl text-solar-bone">
            {r.symbol}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
            spot · binance
          </span>
        </div>
        <RegimeBadge regime={r.regime} size="lg" />
      </div>

      {/* ── Hero readout ── */}
      <div className="grid grid-cols-1 gap-8 px-6 py-6 md:grid-cols-2">
        {/* Left: price + reasoning */}
        <div className="space-y-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
              Last price
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-telemetry text-telemetry-lg tabular-nums text-solar-bone">
                ${formatPrice(ind.price)}
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-solar-fade">
                USD
              </span>
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
              Confidence
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-telemetry text-telemetry-md tabular-nums text-solar-bone">
                {formatConfidence(r.confidence)}
              </span>
              <ConfidenceBar value={r.confidence} />
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
              AI Summary
            </div>
            <p className="mt-2 max-w-prose font-mono text-sm leading-relaxed text-solar-bone/90">
              {r.summary}
            </p>
          </div>

          {r.risk_flags.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
                Risk Signals
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.risk_flags.map((f) => (
                  <RiskFlagPill key={f} flag={f} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: indicator readout */}
        <div className="border-l border-solar-grid pl-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
            Indicators · {ind.ticks_used} ticks
          </div>
          <div className="mt-3">
            <TelemetryRow
              label="SMA 20"
              value={ind.sma20 !== null ? formatPrice(ind.sma20) : "—"}
              unit="USD"
              hint={formatPct(ind.distance_to_sma20_pct)}
              trend={trend20}
            />
            <TelemetryRow
              label="SMA 50"
              value={ind.sma50 !== null ? formatPrice(ind.sma50) : "—"}
              unit="USD"
              hint={formatPct(ind.distance_to_sma50_pct)}
              trend={trend50}
            />
            <TelemetryRow
              label="Volatility"
              value={
                ind.volatility_pct !== null
                  ? ind.volatility_pct.toFixed(4)
                  : "—"
              }
              unit="%"
            />
            <TelemetryRow
              label="Model"
              value={r.model.split(":")[1] ?? r.model}
              hint={r.model.split(":")[0]}
            />
          </div>
        </div>
      </div>

      {/* ── Footer strip ── */}
      <div className="flex items-center justify-between border-t border-solar-grid px-6 py-3">
        <CacheFreshness
          cached={r.cached}
          cacheAgeSeconds={r.cache_age_seconds}
        />
        <Link
          href="/btc"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-amber transition-colors hover:text-solar-bone"
        >
          Detail view →
        </Link>
      </div>
    </CardShell>
  );
}

// ─── Subcomponents (kept private) ──────────────────────────────

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden border border-solar-line bg-solar-panel/80 shadow-[0_0_60px_-30px_rgba(255,181,71,0.15)] backdrop-blur-sm opacity-0 animate-boot"
      style={{ animationDelay: "120ms" }}
    >
      {/* Decorative corner brackets — NASA console feel */}
      <CornerBrackets />
      {children}
    </div>
  );
}

function CornerBrackets() {
  const cls =
    "absolute h-3 w-3 border-solar-amber/40 pointer-events-none";
  return (
    <>
      <span className={`${cls} left-0 top-0 border-l border-t`} />
      <span className={`${cls} right-0 top-0 border-r border-t`} />
      <span className={`${cls} left-0 bottom-0 border-l border-b`} />
      <span className={`${cls} right-0 bottom-0 border-r border-b`} />
    </>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const segments = 10;
  const filled = Math.round(value * segments);
  return (
    <div className="flex gap-0.5" aria-label={`confidence ${value}`}>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          className={`h-3 w-1.5 ${
            i < filled ? "bg-solar-amber" : "bg-solar-grid"
          }`}
        />
      ))}
    </div>
  );
}

function trendOf(distance: number | null): "up" | "down" | "flat" | null {
  if (distance === null) return null;
  if (distance > 0.05) return "up";
  if (distance < -0.05) return "down";
  return "flat";
}
