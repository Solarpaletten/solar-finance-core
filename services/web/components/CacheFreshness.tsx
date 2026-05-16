// Solar Finance Core — CacheFreshness (Sprint 7)
//
// Displays cache_age_seconds + cached flag with a severity dot.
// Three states (matches lib/regime.ts ageSeverity):
//   fresh  — green dot, "LIVE" if <5s else "Ns ago"
//   aging  — amber dot
//   stale  — red dot

import { ageSeverity, formatAge } from "@/lib/regime";

interface Props {
  cached: boolean;
  cacheAgeSeconds: number;
}

const SEV_DOT = {
  fresh: "bg-solar-mint",
  aging: "bg-solar-amber",
  stale: "bg-solar-flare",
} as const;

const SEV_LABEL = {
  fresh: "FRESH",
  aging: "AGING",
  stale: "STALE",
} as const;

export function CacheFreshness({ cached, cacheAgeSeconds }: Props) {
  const sev = ageSeverity(cacheAgeSeconds);
  const ageLabel = formatAge(cacheAgeSeconds);

  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.15em] text-solar-fade">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${SEV_DOT[sev]} ${
            sev === "fresh" ? "animate-pulse-slow" : ""
          }`}
          aria-hidden
        />
        <span className="text-solar-bone">{SEV_LABEL[sev]}</span>
      </div>

      <span className="text-solar-line">│</span>

      <span>{ageLabel}</span>

      <span className="text-solar-line">│</span>

      <span className="text-solar-fade/70">
        {cached ? "from cache" : "fresh compute"}
      </span>
    </div>
  );
}
