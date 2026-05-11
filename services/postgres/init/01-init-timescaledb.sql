-- ============================================================
-- Solar Finance Core — Database Initialization
-- ============================================================
-- Runs ONCE on first container start (standard postgres behavior).
-- Scope: Task 1 — enable TimescaleDB extension only.
-- Business schemas (market_data, signals, scenarios) come in later tasks.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Verification row for /health/db to be able to confirm both Postgres
-- and TimescaleDB are live. No business data here.
DO $$
BEGIN
    RAISE NOTICE 'TimescaleDB extension installed, version: %',
        (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb');
END $$;
