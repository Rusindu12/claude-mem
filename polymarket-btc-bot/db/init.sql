-- PostgreSQL schema for Polymarket 5-Minute BTC Up/Down Trading Bot

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret_encrypted TEXT NOT NULL,
    totp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(128) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS encrypted_secrets (
    name VARCHAR(128) PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS windows (
    id VARCHAR(64) PRIMARY KEY,
    market_id VARCHAR(128) NOT NULL,
    market_slug VARCHAR(256) NOT NULL,
    price_source VARCHAR(128) NOT NULL DEFAULT 'Binance BTC/USDT',
    strike_price DOUBLE PRECISION NOT NULL,
    close_price DOUBLE PRECISION,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    outcome VARCHAR(16), -- 'UP', 'DOWN', NULL while open
    initial_model_prob DOUBLE PRECISION,
    final_model_prob DOUBLE PRECISION,
    market_up_ask DOUBLE PRECISION,
    market_down_ask DOUBLE PRECISION,
    decision VARCHAR(16), -- 'BUY_UP', 'BUY_DOWN', 'PASS'
    edge DOUBLE PRECISION,
    pnl DOUBLE PRECISION DEFAULT 0,
    settled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_windows_start_time ON windows(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_windows_settled ON windows(settled);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY,
    client_order_id VARCHAR(128) UNIQUE NOT NULL,
    window_id VARCHAR(64) NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    exchange VARCHAR(32) NOT NULL DEFAULT 'polymarket',
    side VARCHAR(16) NOT NULL, -- 'UP' or 'DOWN'
    limit_price DOUBLE PRECISION NOT NULL,
    max_slippage DOUBLE PRECISION NOT NULL,
    size_usd DOUBLE PRECISION NOT NULL,
    shares DOUBLE PRECISION NOT NULL,
    filled_shares DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_fill_price DOUBLE PRECISION,
    state VARCHAR(32) NOT NULL, -- CREATED, SUBMITTED, OPEN, PARTIAL_FILL, FILLED, CANCELLED, REJECTED, EXPIRED
    is_paper BOOLEAN NOT NULL DEFAULT TRUE,
    exchange_order_id VARCHAR(128),
    retries INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_window_id ON orders(window_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);

CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) REFERENCES orders(id) ON DELETE SET NULL,
    window_id VARCHAR(64) NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    side VARCHAR(16) NOT NULL, -- 'UP' or 'DOWN'
    entry_price DOUBLE PRECISION NOT NULL,
    size_usd DOUBLE PRECISION NOT NULL,
    shares DOUBLE PRECISION NOT NULL,
    model_prob DOUBLE PRECISION NOT NULL,
    market_ask DOUBLE PRECISION NOT NULL,
    edge DOUBLE PRECISION NOT NULL,
    fee_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_paper BOOLEAN NOT NULL DEFAULT TRUE,
    outcome VARCHAR(16), -- 'WIN', 'LOSS', NULL
    pnl DOUBLE PRECISION,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trades_window_id ON trades(window_id);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);

CREATE TABLE IF NOT EXISTS decisions (
    id BIGSERIAL PRIMARY KEY,
    window_id VARCHAR(64) NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action VARCHAR(16) NOT NULL, -- 'BUY_UP', 'BUY_DOWN', 'PASS'
    reason TEXT NOT NULL,
    spot_price DOUBLE PRECISION NOT NULL,
    strike_price DOUBLE PRECISION NOT NULL,
    time_left_sec DOUBLE PRECISION NOT NULL,
    mc_prob_up DOUBLE PRECISION NOT NULL,
    adjusted_prob_up DOUBLE PRECISION NOT NULL,
    market_up_ask DOUBLE PRECISION NOT NULL,
    market_down_ask DOUBLE PRECISION NOT NULL,
    edge_up DOUBLE PRECISION NOT NULL,
    edge_down DOUBLE PRECISION NOT NULL,
    signal_contributions JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommended_size_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_decisions_window_id ON decisions(window_id);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp DESC);

CREATE TABLE IF NOT EXISTS ticks (
    id BIGSERIAL PRIMARY KEY,
    window_id VARCHAR(64),
    source VARCHAR(32) NOT NULL DEFAULT 'binance',
    symbol VARCHAR(32) NOT NULL DEFAULT 'BTCUSDT',
    price DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticks_timestamp ON ticks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ticks_window_id ON ticks(window_id);

CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    window_id VARCHAR(64) NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    spot_price DOUBLE PRECISION NOT NULL,
    up_bid DOUBLE PRECISION NOT NULL,
    up_ask DOUBLE PRECISION NOT NULL,
    down_bid DOUBLE PRECISION NOT NULL,
    down_ask DOUBLE PRECISION NOT NULL,
    orderbook_imbalance DOUBLE PRECISION NOT NULL,
    model_prob_up DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_window_id ON market_snapshots(window_id);
