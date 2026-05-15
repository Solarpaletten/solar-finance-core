"""
Solar Finance Core — Market Data Routes

Task 2 — Phase 3 scope:
  - GET  /market/btc/raw            fetch BTC price from Binance (no DB)
  - POST /market/btc/snapshot       fetch BTC + persist to TimescaleDB
  - GET  /market/btc/latest         read most recent persisted tick
  - GET  /market/btc/history        read last N persisted ticks

Sprint 4.5 addition (Deterministic Indicator Foundation):
  - GET  /market/btc/indicators     SMA20, SMA50, volatility, distances
                                    computed from last 51 ticks in DB.
                                    Math only — no signals, no AI.

Sprint 5 refactor (Reasoning Layer prep):
  - compute_btc_indicators(pool) helper extracted so the new
    /market/btc/regime endpoint can build its prompt from the
    exact same payload, in-process, with no HTTP self-call.
  - GET /market/btc/indicators is now a thin shell over this helper.

Design notes:
  - Uses the shared httpx.AsyncClient from app.state.
  - REST semantics: GET never writes, POST writes.
  - Returns 502 on Binance failure, 503 on DB failure, 404 if no data.
  - history endpoint is bounded: 1 <= limit <= 1000, default 100.
    FastAPI's Query() validation rejects out-of-range values with
    422 before they reach the handler — no runtime guard needed.
  - indicators endpoint uses LIMIT 51 (50 for SMA + 1 prior tick for
    returns), hitting the existing idx_market_ticks_symbol_ts index.

Strictly out of scope:
  - background scheduler / auto-snapshot
  - other symbols (only BTC for now)
  - candle aggregation (OHLC)
  - cursor / offset / since pagination
  - retry / cache / rate limiting
  - RSI, MACD, EMA, Bollinger, signals, AI analysis
"""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from indicators import sma, volatility_pct, distance_to_sma_pct

router = APIRouter(prefix="/market", tags=["market"])

BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price"
SYMBOL_BTC = "BTCUSDT"


# --- helper ---------------------------------------------------------

async def _fetch_btc_from_binance(http_client) -> dict[str, Any]:
    """Pull BTC/USDT spot price from Binance public API.

    Raises HTTPException(502) on upstream failure.
    """
    try:
        resp = await http_client.get(
            BINANCE_TICKER_URL,
            params={"symbol": SYMBOL_BTC},
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "symbol": data["symbol"],
            "price": float(data["price"]),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"binance unreachable: {exc}",
        )


# --- endpoints ------------------------------------------------------

@router.get("/btc/raw")
async def get_btc_price_raw(request: Request):
    """Fetch current BTC/USDT spot price from Binance. Does NOT touch DB."""
    return await _fetch_btc_from_binance(request.app.state.http)


@router.post("/btc/snapshot")
async def post_btc_snapshot(request: Request):
    """Fetch current BTC price and persist it as a tick in market_ticks."""
    tick = await _fetch_btc_from_binance(request.app.state.http)

    try:
        async with request.app.state.pg_pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO market_ticks (symbol, price)
                VALUES ($1, $2)
                RETURNING ts, symbol, price
                """,
                tick["symbol"],
                tick["price"],
            )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"db write failed: {exc}",
        )

    return {
        "saved": True,
        "ts": row["ts"].isoformat(),
        "symbol": row["symbol"],
        "price": float(row["price"]),
    }


@router.get("/btc/latest")
async def get_btc_latest(request: Request):
    """Return the most recent BTC tick stored in TimescaleDB."""
    try:
        async with request.app.state.pg_pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT ts, symbol, price
                FROM market_ticks
                WHERE symbol = $1
                ORDER BY ts DESC
                LIMIT 1
                """,
                SYMBOL_BTC,
            )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"db read failed: {exc}",
        )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="no ticks stored yet — call POST /market/btc/snapshot first",
        )

    return {
        "ts": row["ts"].isoformat(),
        "symbol": row["symbol"],
        "price": float(row["price"]),
    }


@router.get("/btc/history")
async def get_btc_history(
    request: Request,
    limit: int = Query(
        default=100,
        ge=1,
        le=1000,
        description="Number of most recent ticks to return (1..1000).",
    ),
):
    """Return the last N BTC ticks ordered newest-first."""
    try:
        async with request.app.state.pg_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ts, price
                FROM market_ticks
                WHERE symbol = $1
                ORDER BY ts DESC
                LIMIT $2
                """,
                SYMBOL_BTC,
                limit,
            )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"db read failed: {exc}",
        )

    return [
        {"ts": r["ts"].isoformat(), "price": float(r["price"])}
        for r in rows
    ]


# --- Sprint 4.5: deterministic indicators ---------------------------

# Window sizes (kept as module constants for clarity and easy review).
# 51 = 50 prices for SMA50 + 1 extra prior tick so we can compute 50 returns
# for the volatility window.
SMA_SHORT_WINDOW = 20
SMA_LONG_WINDOW = 50
VOL_WINDOW = 50
LOOKBACK_LIMIT = SMA_LONG_WINDOW + 1  # 51


async def compute_btc_indicators(pg_pool) -> Optional[dict[str, Any]]:
    """
    Sprint 5 shared helper.

    Compute the deterministic indicator JSON for BTC from the last
    LOOKBACK_LIMIT ticks in market_ticks. Returns the dict that
    /market/btc/indicators serves, or None when the table is empty.

    Raises asyncpg / connection errors to the caller; they are
    responsible for mapping to HTTP 503.

    This helper is the single source of truth for the indicator
    payload — both /btc/indicators (HTTP) and /btc/regime (LLM
    prompt) consume its output.
    """
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT price
            FROM market_ticks
            WHERE symbol = $1
            ORDER BY ts DESC
            LIMIT $2
            """,
            SYMBOL_BTC,
            LOOKBACK_LIMIT,
        )

    if not rows:
        return None

    # DB returned newest-first; indicator functions expect chronological order.
    prices = [float(r["price"]) for r in reversed(rows)]
    price_now = prices[-1]

    sma_short = sma(prices, SMA_SHORT_WINDOW)
    sma_long = sma(prices, SMA_LONG_WINDOW)

    return {
        "symbol": SYMBOL_BTC,
        "price": price_now,
        "sma20": sma_short,
        "sma50": sma_long,
        "volatility_pct": volatility_pct(prices, window=VOL_WINDOW),
        "distance_to_sma20_pct": distance_to_sma_pct(price_now, sma_short),
        "distance_to_sma50_pct": distance_to_sma_pct(price_now, sma_long),
        "ticks_used": len(prices),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/btc/indicators")
async def get_btc_indicators(request: Request):
    """
    Deterministic indicators over the last 51 BTC ticks from market_ticks.

    Pure math layer — no signals, no AI, no recommendations.
    Returns 200 with nullable fields when ticks are insufficient.
    Returns 404 only when the ticks table is empty for BTCUSDT.
    Returns 503 on DB failure.

    Response shape:
        {
          "symbol": "BTCUSDT",
          "price": float,
          "sma20": float|null,
          "sma50": float|null,
          "volatility_pct": float|null,
          "distance_to_sma20_pct": float|null,
          "distance_to_sma50_pct": float|null,
          "ticks_used": int,
          "ts": str (ISO-8601 UTC)
        }
    """
    try:
        payload = await compute_btc_indicators(request.app.state.pg_pool)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"db read failed: {exc}",
        )

    if payload is None:
        raise HTTPException(
            status_code=404,
            detail="no ticks stored yet — call POST /market/btc/snapshot first",
        )

    return payload
