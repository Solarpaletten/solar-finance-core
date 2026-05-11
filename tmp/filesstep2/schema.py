"""
Solar Finance Core — Database schema bootstrap

Task 2 — Phase 2 scope:
  Single source of truth for tables & hypertables that Solar needs.
  Called once on API startup from main.py's lifespan.

Design notes:
  - Idempotent: safe to call any number of times. Uses IF NOT EXISTS
    everywhere and TimescaleDB's `if_not_exists => TRUE`.
  - No migration framework (no Alembic). Schema lives next to the
    code that uses it. We add tables here, never alter or drop.
  - Time-series tables are converted to hypertables right after
    creation. Composite primary key (symbol, ts) is required by
    TimescaleDB partitioning.

Strictly out of scope:
  - schema versioning
  - data migrations / ALTER TABLE
  - rollback logic
"""

import logging

log = logging.getLogger("solar.db.schema")


# market_ticks: raw price snapshots from upstream APIs (Binance, etc.)
# Partitioned by `ts` into 1-day chunks via TimescaleDB hypertable.
MARKET_TICKS_DDL = """
CREATE TABLE IF NOT EXISTS market_ticks (
    ts        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    symbol    TEXT             NOT NULL,
    price     DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (symbol, ts)
);
"""

MARKET_TICKS_HYPERTABLE = """
SELECT create_hypertable(
    'market_ticks', 'ts',
    if_not_exists       => TRUE,
    chunk_time_interval => INTERVAL '1 day'
);
"""

MARKET_TICKS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_ts
    ON market_ticks (symbol, ts DESC);
"""


async def init_schema(pool) -> None:
    """Create all tables, hypertables and indexes if missing."""
    async with pool.acquire() as conn:
        await conn.execute(MARKET_TICKS_DDL)
        await conn.execute(MARKET_TICKS_HYPERTABLE)
        await conn.execute(MARKET_TICKS_INDEX)
    log.info("schema: market_ticks ready (hypertable, idx_market_ticks_symbol_ts)")
