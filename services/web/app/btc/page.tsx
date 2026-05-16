"use client";

// Solar Finance Core — BTC Detail Page (Sprint 7)
//
// Drill-down view for BTC. Sprint 7 scope (minimal viable detail):
//   - regime full readout
//   - all indicators with distances
//   - tick history (last 100 from /market/btc/history) as an ASCII-ish sparkline
//   - raw JSON inspector for both regime & indicators
//
// Sprint 8 will add: real chart (recharts / lightweight-charts),
// regime history timeline, scheduler controls.

import Link from "next/link";

import { CacheFreshness } from "@/components/CacheFreshness";
import { RegimeBadge } from "@/components/RegimeBadge";
import { RiskFlagPill } from "@/components/RiskFlagPill";
import { TelemetryRow } from "@/components/TelemetryRow";
import { usePolling } from "@/hooks/usePolling";
import { fetchHistory, fetchIndicators, fetchRegime } from "@/lib/api";
import { formatPct, formatPrice } from "@/lib/regime";

const POLL_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 100;

export default function BTCDetailPage() {
  const regime = usePolling(fetchRegime, { intervalMs: POLL_INTERVAL_MS });
  const indicators = usePolling(fetchIndicators, { intervalMs: POLL_INTERVAL_MS });
  // History polls slower — it's a heavier payload and changes less rapidly.
  const history = usePolling((s) => fetchHistory(HISTORY_LIMIT, s), {
    intervalMs: 15000,
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8">
      {/* ── Header / back link ── */}
      <header className="flex items-center justify-between border-b border-solar-grid pb-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade transition-colors hover:text-solar-amber"
          >
            ← Dashboard
          </Link>
          <span className="font-display text-xl text-solar-bone">
            BTCUSDT
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
            detail view
          </span>
        </div>
        {regime.state === "ok" && (
          <RegimeBadge regime={regime.data.regime} size="lg" />
        )}
      </header>

      {/* ── Top row: regime + indicators side-by-side ── */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel title="Regime · Reasoning">
          {regime.state === "loading" && <LoadingLine label="REGIME" />}
          {regime.state === "error" && (
            <ErrorBlock detail={regime.message} status={regime.status} />
          )}
          {regime.state === "ok" && (
            <div className="flex flex-col gap-4">
              <p className="font-mono text-sm leading-relaxed text-solar-bone/90">
                {regime.data.summary}
              </p>
              {regime.data.risk_flags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {regime.data.risk_flags.map((f) => (
                    <RiskFlagPill key={f} flag={f} />
                  ))}
                </div>
              )}
              <div className="pt-2">
                <TelemetryRow
                  label="Confidence"
                  value={`${Math.round(regime.data.confidence * 100)}%`}
                />
                <TelemetryRow
                  label="Ticks used"
                  value={String(regime.data.ticks_used)}
                />
                <TelemetryRow label="Model" value={regime.data.model} />
                <TelemetryRow
                  label="Source TS"
                  value={regime.data.source_ts}
                />
              </div>
              <div className="mt-1">
                <CacheFreshness
                  cached={regime.data.cached}
                  cacheAgeSeconds={regime.data.cache_age_seconds}
                />
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Indicators · Math">
          {indicators.state === "loading" && <LoadingLine label="INDICATORS" />}
          {indicators.state === "error" && (
            <ErrorBlock
              detail={indicators.message}
              status={indicators.status}
            />
          )}
          {indicators.state === "ok" && (
            <div>
              <TelemetryRow
                label="Price"
                value={`$${formatPrice(indicators.data.price)}`}
                unit="USD"
              />
              <TelemetryRow
                label="SMA 20"
                value={
                  indicators.data.sma20 !== null
                    ? `$${formatPrice(indicators.data.sma20)}`
                    : "—"
                }
                hint={formatPct(indicators.data.distance_to_sma20_pct)}
              />
              <TelemetryRow
                label="SMA 50"
                value={
                  indicators.data.sma50 !== null
                    ? `$${formatPrice(indicators.data.sma50)}`
                    : "—"
                }
                hint={formatPct(indicators.data.distance_to_sma50_pct)}
              />
              <TelemetryRow
                label="Volatility"
                value={
                  indicators.data.volatility_pct !== null
                    ? indicators.data.volatility_pct.toFixed(6)
                    : "—"
                }
                unit="%"
              />
              <TelemetryRow
                label="Ticks used"
                value={String(indicators.data.ticks_used)}
              />
              <TelemetryRow label="Source TS" value={indicators.data.ts} />
            </div>
          )}
        </Panel>
      </section>

      {/* ── History sparkline ── */}
      <Panel title={`Price History · last ${HISTORY_LIMIT} ticks`}>
        {history.state === "loading" && <LoadingLine label="HISTORY" />}
        {history.state === "error" && (
          <ErrorBlock detail={history.message} status={history.status} />
        )}
        {history.state === "ok" && history.data.length > 0 && (
          <SparkLine
            // The API returns newest-first; flip so the chart reads
            // left-to-right chronologically.
            points={[...history.data].reverse().map((t) => t.price)}
          />
        )}
        {history.state === "ok" && history.data.length === 0 && (
          <div className="py-8 text-center font-mono text-xs uppercase tracking-[0.2em] text-solar-fade">
            no ticks recorded yet
          </div>
        )}
      </Panel>

      {/* ── Raw JSON inspector ── */}
      <Panel title="Raw JSON · Inspector">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RawJsonBlock
            label="/market/btc/regime"
            data={regime.state === "ok" ? regime.data : null}
          />
          <RawJsonBlock
            label="/market/btc/indicators"
            data={indicators.state === "ok" ? indicators.data : null}
          />
        </div>
      </Panel>
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-solar-line bg-solar-panel/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between border-b border-solar-grid pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-solar-amber">
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 font-mono text-xs uppercase tracking-[0.2em] text-solar-fade">
      <span className="inline-block h-2 w-2 animate-blink bg-solar-amber" />
      LOADING {label}
    </div>
  );
}

function ErrorBlock({
  detail,
  status,
}: {
  detail: string;
  status?: number;
}) {
  return (
    <div className="py-4 font-mono text-xs">
      <div className="text-solar-flare uppercase tracking-[0.18em]">
        ERROR {status ? `· HTTP ${status}` : ""}
      </div>
      <div className="mt-1 text-solar-fade">{detail}</div>
    </div>
  );
}

function RawJsonBlock({
  label,
  data,
}: {
  label: string;
  data: unknown | null;
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto border border-solar-grid bg-solar-void/50 p-3 font-mono text-[11px] leading-relaxed text-solar-bone/80">
        {data === null ? "// awaiting first response\n" : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

/* Cheap inline sparkline: an SVG polyline scaled to fit a fixed
 * viewBox. We deliberately don't pull in recharts/lightweight-charts
 * in Sprint 7 — that's a Sprint 8 upgrade. This proves the data is
 * flowing end-to-end and looks honest in the meantime. */
function SparkLine({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div className="py-8 text-center font-mono text-xs uppercase tracking-[0.2em] text-solar-fade">
        need ≥2 ticks to draw
      </div>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 100;
  const h = 24;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        aria-label="price sparkline"
      >
        <path
          d={path}
          fill="none"
          stroke="#ffb547"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
        <span>min ${formatPrice(min)}</span>
        <span>{points.length} pts</span>
        <span>max ${formatPrice(max)}</span>
      </div>
    </div>
  );
}
