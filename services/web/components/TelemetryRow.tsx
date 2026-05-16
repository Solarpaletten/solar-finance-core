// Solar Finance Core — TelemetryRow (Sprint 7)
//
// Generic label + value row used for indicator readouts. Mission
// control style: small uppercase tracked label on the left, tabular
// monospace value on the right, optional unit and trend glyph.

interface Props {
  label: string;
  value: string;
  unit?: string;
  /** Optional muted secondary line below the value (e.g. distance %) */
  hint?: string;
  /** Trend glyph next to the value: ▲ ▼ — */
  trend?: "up" | "down" | "flat" | null;
}

const TREND_GLYPH = {
  up: "▲",
  down: "▼",
  flat: "—",
} as const;

const TREND_COLOR = {
  up: "text-regime-bullish-momentum",
  down: "text-regime-bearish-pressure",
  flat: "text-solar-fade",
} as const;

export function TelemetryRow({ label, value, unit, hint, trend }: Props) {
  return (
    <div className="flex items-baseline justify-between border-b border-solar-grid/60 py-2 last:border-b-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
        {label}
      </div>
      <div className="flex items-baseline gap-2 font-telemetry tabular-nums text-solar-bone">
        {trend && (
          <span className={`text-xs ${TREND_COLOR[trend]}`}>
            {TREND_GLYPH[trend]}
          </span>
        )}
        <span className="text-sm">{value}</span>
        {unit && (
          <span className="text-[10px] uppercase tracking-wider text-solar-fade">
            {unit}
          </span>
        )}
        {hint && (
          <span className="ml-2 text-[10px] text-solar-fade/70">{hint}</span>
        )}
      </div>
    </div>
  );
}
