import type { Config } from "tailwindcss";

/**
 * Solar Finance Core — Tailwind config (Sprint 7)
 *
 * Design language: NASA Mission Control × Bloomberg Terminal.
 * Dark base, telemetry typography, sharp regime accents.
 *
 * Palette principles:
 *   - solar.void      = deep space background, almost-but-not-quite black
 *   - solar.panel     = elevated surface (cards, modals)
 *   - solar.grid      = subtle grid lines, dotted patterns
 *   - solar.fade      = secondary text, dimmed
 *   - solar.bone      = primary text (warm off-white, not pure #fff)
 *   - solar.amber     = telemetry numbers, live indicators (CRT-warm)
 *   - regime.*        = closed-set semantic colors mapped to Solana taxonomy
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        solar: {
          void: "#070a13",
          panel: "#0e1422",
          grid: "#1a2236",
          line: "#243049",
          fade: "#5a6b8a",
          bone: "#e7e3d6",
          amber: "#ffb547",
          flare: "#ff7a59",
          mint: "#7ee3c1",
        },
        regime: {
          consolidating: "#3b82f6",     // blue — calm, neutral
          "bullish-momentum": "#10b981", // emerald — uptrend
          "bearish-pressure": "#ef4444", // red — downtrend
          "breakout-attempt": "#facc15", // yellow — watch
          "high-volatility": "#f97316",  // orange — warning
          "range-expansion": "#a855f7",  // purple — unusual
          "volatile-neutral": "#6b7280", // gray — mixed
          "insufficient-data": "#374151",// dim gray — no data
        },
      },
      fontFamily: {
        // Display / headings: distinctive geometric monospace
        display: ['"Major Mono Display"', "ui-monospace", "monospace"],
        // Body / labels: clean modern monospace
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        // Telemetry numbers: tabular-nums, monospace
        telemetry: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        "telemetry-lg": ["3.5rem", { lineHeight: "1", letterSpacing: "-0.04em" }],
        "telemetry-md": ["1.75rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "telemetry-sm": ["1rem", { lineHeight: "1.2", letterSpacing: "0" }],
        "label": ["0.65rem", { lineHeight: "1", letterSpacing: "0.18em" }],
      },
      animation: {
        "pulse-slow": "pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "blink": "blink 1.2s steps(2, start) infinite",
        "boot": "boot 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scan": "scan 6s linear infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        boot: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
      backgroundImage: {
        "grid-fine":
          "linear-gradient(to right, rgba(36, 48, 73, 0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(36, 48, 73, 0.4) 1px, transparent 1px)",
        "noise":
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      backgroundSize: {
        "grid-fine": "32px 32px",
      },
    },
  },
  plugins: [],
};

export default config;
