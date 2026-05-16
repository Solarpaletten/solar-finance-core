// Solar Finance Core — RiskFlagPill (Sprint 7)
//
// Renders a single risk_flag token as a small pill. Stays neutral
// in color so it doesn't compete with the regime badge — the
// regime is the headline, flags are supporting context.

import type { RiskFlag } from "@/lib/types";

interface Props {
  flag: RiskFlag;
}

export function RiskFlagPill({ flag }: Props) {
  return (
    <span className="inline-flex items-center border border-solar-line bg-solar-grid/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-solar-fade">
      <span className="mr-1.5 text-solar-amber">▸</span>
      {flag.replace(/_/g, " ")}
    </span>
  );
}
