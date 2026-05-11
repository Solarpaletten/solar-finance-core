"""
Solar Finance Core — API Entry Point

Endpoints:
  GET  /                       — service identity
  GET  /health                 — API liveness
  GET  /health/db              — PostgreSQL + TimescaleDB reachable
  GET  /health/redis           — Redis reachable
  GET  /health/llm             — Ollama reachable & model loaded
  GET  /health/all             — aggregated status
  GET  /llm/ping               — round-trip prompt to Qwen
  GET  /market/btc/raw         — fetch BTC price from Binance (no DB)
  POST /market/btc/snapshot    — fetch BTC and persist to TimescaleDB
  GET  /market/btc/latest      — read most recent persisted tick
"""

import logging
from contextlib import asynccontextmanager

import asyncpg
import httpx
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from config import settings
from db.schema import init_schema
from routes.market import router as market_router

logging.basicConfig(
    level=settings.API_LOG_LEVEL.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("solar.api")


# --- Lifespan: create & teardown shared clients ---------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Solar Finance Core API starting...")
    log.info("environment=%s", settings.ENVIRONMENT)
    log.info("postgres=%s:%s", settings.POSTGRES_HOST, settings.POSTGRES_PORT)
    log.info("redis=%s:%s", settings.REDIS_HOST, settings.REDIS_PORT)
    log.info("ollama=%s model=%s", settings.ollama_url, settings.OLLAMA_MODEL)

    app.state.pg_pool = await asyncpg.create_pool(
        settings.postgres_dsn, min_size=1, max_size=5
    )
    app.state.redis = redis.from_url(
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}",
        decode_responses=True,
    )
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(60.0))

    # Bootstrap database schema (idempotent).
    await init_schema(app.state.pg_pool)

    log.info("API ready.")
    yield

    log.info("Shutting down...")
    await app.state.pg_pool.close()
    await app.state.redis.aclose()
    await app.state.http.aclose()
    log.info("Bye.")


app = FastAPI(
    title="Solar Finance Core",
    description="Decision System for Crypto Treasury",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(market_router)


# --- Root -----------------------------------------------------------

@app.get("/")
async def root():
    return {
        "service": "solar-finance-core",
        "version": "0.2.0",
        "environment": settings.ENVIRONMENT,
        "status": "ok",
    }


# --- Health: API itself --------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "component": "api"}


# --- Health: PostgreSQL --------------------------------------------

@app.get("/health/db")
async def health_db():
    try:
        async with app.state.pg_pool.acquire() as conn:
            version = await conn.fetchval("SELECT version()")
            tsdb = await conn.fetchval(
                "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
            )
        return {
            "status": "ok",
            "component": "postgres",
            "postgres_version": version.split(",")[0] if version else None,
            "timescaledb_version": tsdb,
        }
    except Exception as exc:
        log.exception("db healthcheck failed")
        raise HTTPException(status_code=503, detail=f"db unreachable: {exc}")


# --- Health: Redis --------------------------------------------------

@app.get("/health/redis")
async def health_redis():
    try:
        pong = await app.state.redis.ping()
        return {"status": "ok", "component": "redis", "ping": pong}
    except Exception as exc:
        log.exception("redis healthcheck failed")
        raise HTTPException(status_code=503, detail=f"redis unreachable: {exc}")


# --- Health: Ollama / LLM ------------------------------------------

@app.get("/health/llm")
async def health_llm():
    try:
        resp = await app.state.http.get(f"{settings.ollama_url}/api/tags")
        resp.raise_for_status()
        payload = resp.json()
        models = [m.get("name") for m in payload.get("models", [])]
        model_loaded = settings.OLLAMA_MODEL in models
        return {
            "status": "ok",
            "component": "ollama",
            "configured_model": settings.OLLAMA_MODEL,
            "model_available": model_loaded,
            "available_models": models,
        }
    except Exception as exc:
        log.exception("llm healthcheck failed")
        raise HTTPException(status_code=503, detail=f"ollama unreachable: {exc}")


# --- Health: Aggregated --------------------------------------------

@app.get("/health/all")
async def health_all():
    """
    Aggregated view of all subsystems. Returns 200 only if everything is ok.
    Useful for `make health` and external monitoring.
    """
    results = {}
    ok = True

    # DB
    try:
        async with app.state.pg_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        results["db"] = "ok"
    except Exception as exc:
        ok = False
        results["db"] = f"fail: {exc}"

    # Redis
    try:
        await app.state.redis.ping()
        results["redis"] = "ok"
    except Exception as exc:
        ok = False
        results["redis"] = f"fail: {exc}"

    # LLM
    try:
        resp = await app.state.http.get(f"{settings.ollama_url}/api/tags")
        resp.raise_for_status()
        payload = resp.json()
        models = [m.get("name") for m in payload.get("models", [])]
        if settings.OLLAMA_MODEL in models:
            results["llm"] = "ok"
        else:
            ok = False
            results["llm"] = f"model_not_pulled: expected {settings.OLLAMA_MODEL}"
    except Exception as exc:
        ok = False
        results["llm"] = f"fail: {exc}"

    status_code = 200 if ok else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ok" if ok else "degraded", "components": results},
    )


# --- LLM: Ping (proves end-to-end LLM pipeline) --------------------

@app.get("/llm/ping")
async def llm_ping():
    """
    Round-trip a trivial prompt through Qwen to prove the full pipeline
    works. This is the Task 1 acceptance test for the LLM layer.
    """
    prompt = "Reply with exactly one word: pong"
    try:
        resp = await app.state.http.post(
            f"{settings.ollama_url}/api/generate",
            json={
                "model": settings.OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 10},
            },
            timeout=120.0,  # first inference can be slow while model loads
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "status": "ok",
            "model": settings.OLLAMA_MODEL,
            "prompt": prompt,
            "response": (data.get("response") or "").strip(),
            "eval_count": data.get("eval_count"),
            "total_duration_ms": (data.get("total_duration") or 0) // 1_000_000,
        }
    except Exception as exc:
        log.exception("llm ping failed")
        raise HTTPException(status_code=503, detail=f"llm ping failed: {exc}")
