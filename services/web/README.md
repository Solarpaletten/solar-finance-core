# Solar Finance Core — Web (Sprint 7)

Visual AI terminal layer for Solar Finance Core. Built with
Next.js 14 (App Router) + TypeScript + Tailwind CSS.

## Status

Sprint 7 scope: **frontend foundation only** (no docker integration yet).
Sprint 7.1 will add: CORS middleware on FastAPI + web service in
`docker-compose.yml`.

## Run (development)

```bash
cd services/web
npm install
npm run dev
```

Open <http://localhost:3000>.

## Architecture

```
http://localhost:3000           Next.js dev server (this app)
        │
        │  fetch /api/*  ─── next.config.js rewrite ───►  http://localhost:8000
        │                                                  FastAPI
```

The `/api/*` rewrite in `next.config.js` sidesteps CORS during local
development. No browser preflight, no `Access-Control-Allow-Origin`
needed yet.

## Pages

- `/`        Main dashboard. One large BTC card with regime, summary,
             indicators, cache freshness.
- `/btc`     Detail view. Regime + indicators in two panels, history
             sparkline, raw JSON inspector for both endpoints.

## Data sources

| Endpoint                        | Poll interval | Purpose                       |
| ------------------------------- | ------------- | ----------------------------- |
| GET /market/btc/regime          | 5s            | regime classification + cache |
| GET /market/btc/indicators      | 5s            | SMA / volatility / distances  |
| GET /market/btc/history?limit=N | 15s           | tick history for sparkline    |

Backend cache hit is ~26ms so 5s polling is essentially free.

## Design language

NASA Mission Control × Bloomberg Terminal:

- Deep void background, faint dotted grid + subtle CRT scan lines
- Custom fonts: Major Mono Display (headings), JetBrains Mono (body
  and telemetry numbers)
- Solana v2 regime palette (8 colors, one per regime state)
- Telemetry numbers always tabular-nums, monospace
- Corner brackets on cards, blinking dots, amber accents

## Type safety

All API responses are typed via `lib/types.ts` — single source of truth
for the API contract on the frontend side. If the backend
`RegimeResponse` ever gains a field, update `types.ts` first.

## Not included in Sprint 7

- Real charts (Sprint 8 will add recharts or lightweight-charts)
- Regime history timeline (Sprint 8)
- WebSocket / SSE live updates (Sprint 8)
- Multi-currency support (Sprint 9)
- Auth (later)
- Production build / deploy (later)
