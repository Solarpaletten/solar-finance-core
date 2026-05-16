// Solar Finance Core — ConnectionStatus (Sprint 7)
//
// Top-bar status indicator. Three states:
//   connected — green pulsing dot, "CONNECTED"
//   loading   — amber blink, "SYNCING"
//   error     — red, "OFFLINE"
// Renders the upstream system the status describes (e.g. "API" or "QWEN")
// so the operator knows where the disconnect is when something fails.

type State = "connected" | "loading" | "error";

interface Props {
  state: State;
  /** Which upstream is this status for (rendered uppercase) */
  label: string;
  /** Optional helper text shown after the state (e.g. an HTTP status) */
  detail?: string;
}

const META = {
  connected: { dot: "bg-solar-mint", animate: "animate-pulse-slow", text: "CONNECTED" },
  loading:   { dot: "bg-solar-amber", animate: "animate-blink",     text: "SYNCING"   },
  error:     { dot: "bg-solar-flare", animate: "",                  text: "OFFLINE"   },
} as const;

export function ConnectionStatus({ state, label, detail }: Props) {
  const meta = META[state];
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-solar-fade">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.animate}`}
        aria-hidden
      />
      <span className="text-solar-bone">{label}</span>
      <span className="text-solar-line">·</span>
      <span>{meta.text}</span>
      {detail && (
        <>
          <span className="text-solar-line">·</span>
          <span className="text-solar-fade/70">{detail}</span>
        </>
      )}
    </div>
  );
}
