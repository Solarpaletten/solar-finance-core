// Solar Finance Core — RegimeBadge (Sprint 7)
//
// Color-coded regime label. Uppercase, monospace, with a thin pulsing
// "live" dot to reinforce the telemetry feel.

import { REGIME_STYLES } from "@/lib/regime";
import type { Regime } from "@/lib/types";

interface Props {
  regime: Regime;
  /** Larger size variant for the main hero card */
  size?: "sm" | "lg";
  /** Whether to pulse the leading dot. Off for static / stale states. */
  pulse?: boolean;
}

export function RegimeBadge({ regime, size = "sm", pulse = true }: Props) {
  const style = REGIME_STYLES[regime];
  const padding = size === "lg" ? "px-4 py-2" : "px-2.5 py-1";
  const textSize = size === "lg" ? "text-base" : "text-xs";

  return (
    <div
      className={`inline-flex items-center gap-2 border ${style.border} ${style.text} ${padding} ${textSize} font-mono uppercase tracking-[0.18em] bg-solar-void/60 backdrop-blur-sm`}
      title={style.description}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${style.bg} ${
          pulse ? "animate-pulse-slow" : ""
        }`}
        aria-hidden
      />
      <span>{style.label}</span>
    </div>
  );
}
