"""
Solar Finance Core — Market Data Routes

Task 2 — Phase 3 scope:
  - GET  /market/btc/raw            fetch BTC price from Binance (no DB)
  - POST /market/btc/snapshot       fetch BTC + persist to TimescaleDB
  - GET  /market/btc/latest         read most recent persisted tick
  - GET  /market/btc/history        read last N persisted ticks (NEW)

Design notes:
  - Uses the shared httpx.AsyncClient from app.state.
  - REST semantics: GET never writes, POST writes.
  - Returns 502 on Binance failure, 503 on DB failure, 404 if no data.
  - history endpoint is bounded: 1 <= limit <= 1000, default 100.
    FastAPI's Query() validation rejects out-of-range values with
    422 before they reach the handler — no runtime guard needed.

Strictly out of scope:
  - background scheduler / auto-snapshot
  - other symbols (only BTC for now)
  - candle aggregation (OHLC)
  - cursor / offset / since pagination
  - retry / cache / rate limiting
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

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
