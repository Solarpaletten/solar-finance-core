# Solar Finance Core — Infrastructure Skeleton

**Task 1 deliverable.** Deploys base infrastructure on Mac mini M4 Pro 64GB.

Scope is deliberately minimal:
- PostgreSQL 16 + TimescaleDB extension
- Redis 7
- Ollama runtime with Qwen 2.5 72B Q4_K_M
- FastAPI skeleton with health endpoints

**No business logic. No signals. No UI.** Those come in later tasks under
Dashka's coordination.

---

## Prerequisites

- **Hardware:** Apple Silicon Mac with ≥64 GB unified memory (verified on M4 Pro 64GB)
- **Docker Desktop** installed and running (confirmed before start)
- **Disk:** at least **60 GB free** (43 GB for the model + overhead)
- **Network:** ~43 GB one-time download for the model
- **Terminal:** `make`, `curl`, `bash` (all present on macOS by default)

---

## First-time setup — three commands

Open Terminal, `cd` into this folder, then:

```bash
make setup
make pull-model   # 40–60 minutes on typical home connection
make health
```

That's it. If `make health` reports `ALL SYSTEMS GO`, Task 1 is done.

### What each command does

| Command | What happens | Time |
|---|---|---|
| `make setup` | Copies `.env.example` → `.env`, builds API image, starts all containers | 2–5 min |
| `make pull-model` | Downloads Qwen 2.5 72B Q4_K_M (~43 GB) into the Ollama volume | 40–60 min |
| `make health` | Runs acceptance tests against all 4 services | ~1 min (first LLM ping: 30–90s) |

---

## Architecture (Task 1)

```
┌─────────────────────────────────────────────────────┐
│  Host: Mac mini M4 Pro 64GB                        │
│                                                     │
│  Docker network: solar_net                         │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ postgres │  │  redis   │  │     ollama       │ │
│  │  +tsdb   │  │          │  │  Qwen 2.5 72B    │ │
│  │  :5432   │  │  :6379   │  │  Q4_K_M  :11434  │ │
│  └────┬─────┘  └────┬─────┘  └─────────┬────────┘ │
│       │             │                   │          │
│       └─────────────┴───────────────────┘          │
│                     │                               │
│              ┌──────┴──────┐                       │
│              │     api     │  (FastAPI skeleton)   │
│              │   :8000     │                       │
│              └──────┬──────┘                       │
│                     │                               │
└─────────────────────┼───────────────────────────────┘
                      │
              host :8000  ← the only port you hit
```

All inter-service communication stays inside `solar_net`. Only the API is
exposed to the host. Data persists in named Docker volumes
(`solar_postgres_data`, `solar_redis_data`, `solar_ollama_data`) — survives
`make restart`, `make down`, and host reboots.

---

## Endpoints (Task 1 only)

Once `make health` passes, these return JSON:

- `GET http://localhost:8000/` — service identity
- `GET http://localhost:8000/health` — API is up
- `GET http://localhost:8000/health/db` — Postgres + TimescaleDB reachable
- `GET http://localhost:8000/health/redis` — Redis reachable
- `GET http://localhost:8000/health/llm` — Ollama reachable, model present
- `GET http://localhost:8000/health/all` — aggregated status (returns 503 if anything fails)
- `GET http://localhost:8000/llm/ping` — round-trip prompt through Qwen (proves the full LLM pipeline)

Interactive docs: `http://localhost:8000/docs`

No other endpoints. By design.

---

## Daily operations

```bash
make up          # start everything
make down        # stop everything (data is kept)
make status      # see what's running
make logs        # tail all logs
make logs-api    # tail API only
make logs-llm    # tail Ollama only
make rebuild     # rebuild API after any code change
make shell-db    # psql into the database
```

---

## Troubleshooting

### `make health` says the model is not available

The pull didn't finish, or you skipped `make pull-model`. Run:
```bash
make pull-model
```

### First `/llm/ping` takes 60+ seconds

Normal. Ollama loads the model into memory on first inference. Subsequent
calls are much faster. If it times out, check:
```bash
make logs-llm
```

### API can't reach the database

Usually the database hasn't finished starting. Wait 15 seconds and re-run
`make health`. The API has `depends_on: postgres: condition: service_healthy`
so this should not happen on `make up`, but can happen on the very first
`make setup` if Docker is slow.

### Port already in use

Another service on your machine is using 8000, 5432, 6379, or 11434.
Either stop that service, or edit `.env` to change the port, then
`make restart`.

### Need to start fresh

```bash
make nuke   # asks for confirmation, then wipes all volumes
make setup
make pull-model
```

---

## Security note (read before production)

This skeleton is tuned for local development on a trusted workstation:

- `POSTGRES_PASSWORD` has a default placeholder in `.env.example`.
  **Change it in `.env` before any exposure.**
- Only the API port is exposed to the host; DB/Redis/Ollama are not.
- The API has no authentication yet. **Do not bind `0.0.0.0:8000` on a
  public network until auth is added** (later task).

---

## What's next

Task 1 ends when `make health` is green. At that point:

1. You run `make health`.
2. Report the full output to Dashka.
3. Dashka issues Task 2 (exchange market data ingestion).

No Task 2 work has been touched. No placeholders. No "just in case". Only
infrastructure.

---

*Solar Finance Core v0.1.0 — skeleton. Do not add business logic here
without Dashka's explicit task.*
