"use client";

// Solar Finance Core — Main Dashboard page (Sprint 7)
//
// Single-currency BTC view. Composes the BTCCard hero with
// header / status row / footer with build info.

import { BTCCard } from "@/components/BTCCard";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-8">
      <TerminalHeader />
      <BTCCard />
      <TerminalFooter />
    </main>
  );
}

function TerminalHeader() {
  return (
    <header className="flex flex-col gap-2 border-b border-solar-grid pb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl tracking-[0.05em] text-solar-bone">
            SOLAR<span className="text-solar-amber"> · </span>FINANCE CORE
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade">
            v0.7 / sprint-7
          </span>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          <SessionClock />
        </div>
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-solar-fade">
        Single-asset AI terminal · local reasoning · qwen 32b
      </div>
    </header>
  );
}

function TerminalFooter() {
  return (
    <footer className="mt-auto flex flex-col items-start justify-between gap-2 border-t border-solar-grid pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-solar-fade/70 sm:flex-row sm:items-center">
      <div>
        decision support · not financial advice · local-only inference
      </div>
      <div className="flex items-center gap-3">
        <span>poll · 5s</span>
        <span className="text-solar-line">│</span>
        <span>cache ttl · 600s</span>
        <span className="text-solar-line">│</span>
        <span>regime model · qwen2.5:32b</span>
      </div>
    </footer>
  );
}

/* Lightweight live UTC clock — pure cosmetic, no API dep. Renders only
 * on the client to avoid SSR hydration mismatch. */
function SessionClock() {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
      <ClockText />
    </span>
  );
}

function ClockText() {
  // Inline tiny hook to keep this page self-contained (no extra file)
  const [now, setNow] = useNow();
  // Render once mounted to avoid SSR drift.
  if (!now) return <span aria-hidden>—</span>;
  return (
    <>
      <span className="text-solar-bone">{now.iso}</span>
      <span className="ml-2 text-solar-amber">UTC</span>
    </>
  );
}

// Inline-hook helper to keep the page in one file. Pattern:
// useState + setInterval, but typed.
import { useEffect, useState } from "react";

function useNow(): [{ iso: string } | null, never] {
  const [iso, setIso] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      // Format YYYY-MM-DD HH:MM:SS in UTC, tabular style.
      const pad = (n: number) => String(n).padStart(2, "0");
      const s =
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      setIso(s);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  // The setter is never exposed externally — pin as `never`.
  return [iso ? { iso } : null, undefined as never];
}
