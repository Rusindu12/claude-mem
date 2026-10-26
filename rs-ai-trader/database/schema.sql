-- =====================================================================
-- RS AI TRADER - PostgreSQL schema (generated, do not hand-edit)
--
--   python scripts/generate_schema.py
--
-- Source of truth: backend/app/db/models.py (SQLAlchemy 2.0).
-- This file is used by docker-compose as a Postgres init script and is the
-- readable reference for reviewers. Applying migrations with Alembic is the
-- supported upgrade path for existing databases:
--
--   cd backend && alembic -c alembic.ini upgrade head
-- =====================================================================

-- 19 tables, 52 statements

BEGIN;

CREATE TABLE app_settings (
	key VARCHAR(80) NOT NULL, 
	value JSON NOT NULL, 
	description VARCHAR(255), 
	updated_by VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (key)
);

CREATE TABLE order_events (
	id VARCHAR(36) NOT NULL, 
	order_id VARCHAR(36), 
	paper_order_id VARCHAR(36), 
	user_id VARCHAR(36), 
	source VARCHAR(24) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	payload JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_order_events_order_id ON order_events (order_id);

CREATE INDEX ix_order_events_paper_order_id ON order_events (paper_order_id);

CREATE INDEX ix_order_events_user_id ON order_events (user_id);

CREATE TABLE trading_controls (
	id VARCHAR(36) NOT NULL, 
	kill_switch BOOLEAN NOT NULL, 
	reason VARCHAR(255), 
	activated_by VARCHAR(36), 
	activated_at TIMESTAMP WITH TIME ZONE, 
	stale_data_block BOOLEAN NOT NULL, 
	api_error_block BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE trading_pairs (
	symbol VARCHAR(20) NOT NULL, 
	base_asset VARCHAR(12) NOT NULL, 
	quote_asset VARCHAR(12) NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	min_qty NUMERIC(28, 12), 
	max_qty NUMERIC(28, 12), 
	step_size NUMERIC(28, 12), 
	tick_size NUMERIC(28, 12), 
	min_notional NUMERIC(20, 8), 
	max_num_orders INTEGER, 
	filters_synced_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (symbol)
);

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	display_name VARCHAR(80) NOT NULL, 
	role VARCHAR(5) NOT NULL, 
	status VARCHAR(9) NOT NULL, 
	language VARCHAR(5) NOT NULL, 
	failed_login_attempts INTEGER NOT NULL, 
	locked_until TIMESTAMP WITH TIME ZONE, 
	last_login_at TIMESTAMP WITH TIME ZONE, 
	password_changed_at TIMESTAMP WITH TIME ZONE, 
	token_version INTEGER NOT NULL, 
	deleted_at TIMESTAMP WITH TIME ZONE, 
	fcm_token VARCHAR(400), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE api_credentials (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	label VARCHAR(60) NOT NULL, 
	environment VARCHAR(10) NOT NULL, 
	api_key_ciphertext TEXT NOT NULL, 
	secret_ciphertext TEXT NOT NULL, 
	key_fingerprint VARCHAR(64) NOT NULL, 
	masked_key VARCHAR(20) NOT NULL, 
	permissions JSON NOT NULL, 
	can_withdraw BOOLEAN NOT NULL, 
	ip_restricted BOOLEAN NOT NULL, 
	status VARCHAR(7) NOT NULL, 
	last_verified_at TIMESTAMP WITH TIME ZONE, 
	last_error VARCHAR(255), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_user_key_fingerprint UNIQUE (user_id, key_fingerprint), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_api_credentials_key_fingerprint ON api_credentials (key_fingerprint);

CREATE INDEX ix_api_credentials_user_id ON api_credentials (user_id);

CREATE TABLE assistant_messages (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	question VARCHAR(1000) NOT NULL, 
	answer TEXT NOT NULL, 
	lang VARCHAR(5) NOT NULL, 
	intent VARCHAR(40) NOT NULL, 
	context JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_assistant_messages_user_id ON assistant_messages (user_id);

CREATE TABLE audit_events (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36), 
	actor_role VARCHAR(20) NOT NULL, 
	action VARCHAR(80) NOT NULL, 
	target_type VARCHAR(40), 
	target_id VARCHAR(64), 
	outcome VARCHAR(20) NOT NULL, 
	ip_address VARCHAR(64), 
	user_agent VARCHAR(255), 
	detail JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX ix_audit_created ON audit_events (created_at);

CREATE INDEX ix_audit_events_action ON audit_events (action);

CREATE INDEX ix_audit_events_user_id ON audit_events (user_id);

CREATE TABLE backtest_runs (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	symbol VARCHAR(20) NOT NULL, 
	timeframe VARCHAR(8) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	parameters JSON NOT NULL, 
	metrics JSON NOT NULL, 
	assumptions JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_backtest_runs_user_id ON backtest_runs (user_id);

CREATE TABLE notifications (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	title VARCHAR(120) NOT NULL, 
	body VARCHAR(500) NOT NULL, 
	severity VARCHAR(12) NOT NULL, 
	data JSON NOT NULL, 
	read_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_notifications_user_id ON notifications (user_id);

CREATE TABLE paper_accounts (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	starting_equity NUMERIC(20, 8) NOT NULL, 
	quote_balance NUMERIC(20, 8) NOT NULL, 
	realized_pnl NUMERIC(20, 8) NOT NULL, 
	fees_paid NUMERIC(20, 8) NOT NULL, 
	peak_equity NUMERIC(20, 8) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ix_paper_accounts_user_id ON paper_accounts (user_id);

CREATE TABLE paper_orders (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	symbol VARCHAR(20) NOT NULL, 
	side VARCHAR(4) NOT NULL, 
	order_type VARCHAR(17) NOT NULL, 
	quantity NUMERIC(28, 12) NOT NULL, 
	requested_price NUMERIC(28, 12), 
	filled_quantity NUMERIC(28, 12) NOT NULL, 
	average_fill_price NUMERIC(28, 12), 
	stop_loss NUMERIC(28, 12), 
	take_profit NUMERIC(28, 12), 
	status VARCHAR(16) NOT NULL, 
	fee_paid NUMERIC(20, 8) NOT NULL, 
	slippage_bps NUMERIC(10, 4) NOT NULL, 
	idempotency_key VARCHAR(80) NOT NULL, 
	signal_id VARCHAR(36), 
	note VARCHAR(255), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_paper_order_idempotency UNIQUE (user_id, idempotency_key), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_paper_orders_symbol ON paper_orders (symbol);

CREATE INDEX ix_paper_orders_user_id ON paper_orders (user_id);

CREATE INDEX ix_paper_orders_user_status ON paper_orders (user_id, status);

CREATE TABLE paper_positions (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	symbol VARCHAR(20) NOT NULL, 
	quantity NUMERIC(28, 12) NOT NULL, 
	entry_price NUMERIC(28, 12) NOT NULL, 
	stop_loss NUMERIC(28, 12), 
	take_profit NUMERIC(28, 12), 
	status VARCHAR(12) NOT NULL, 
	opened_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	closed_at TIMESTAMP WITH TIME ZONE, 
	exit_price NUMERIC(28, 12), 
	realized_pnl NUMERIC(20, 8), 
	fees NUMERIC(20, 8) NOT NULL, 
	signal_id VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_paper_positions_signal_id ON paper_positions (signal_id);

CREATE INDEX ix_paper_positions_symbol ON paper_positions (symbol);

CREATE INDEX ix_paper_positions_user_id ON paper_positions (user_id);

CREATE INDEX ix_paper_positions_user_status ON paper_positions (user_id, status);

CREATE TABLE password_reset_tokens (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (token_hash)
);

CREATE INDEX ix_password_reset_tokens_user_id ON password_reset_tokens (user_id);

CREATE TABLE price_alerts (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	symbol VARCHAR(20) NOT NULL, 
	condition VARCHAR(11) NOT NULL, 
	target_price NUMERIC(28, 12), 
	note VARCHAR(200), 
	status VARCHAR(9) NOT NULL, 
	triggered_at TIMESTAMP WITH TIME ZONE, 
	triggered_price NUMERIC(28, 12), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_price_alerts_user_id ON price_alerts (user_id);

CREATE TABLE refresh_tokens (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	jti VARCHAR(36) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	replaced_by_jti VARCHAR(36), 
	ip_address VARCHAR(64), 
	user_agent VARCHAR(255), 
	device_label VARCHAR(80), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_refresh_tokens_jti ON refresh_tokens (jti);

CREATE UNIQUE INDEX ix_refresh_tokens_token_hash ON refresh_tokens (token_hash);

CREATE INDEX ix_refresh_tokens_user_id ON refresh_tokens (user_id);

CREATE TABLE risk_policies (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	max_trade_notional NUMERIC(20, 8) NOT NULL, 
	max_portfolio_exposure_pct NUMERIC(6, 3) NOT NULL, 
	max_daily_loss NUMERIC(20, 8) NOT NULL, 
	max_risk_per_trade_pct NUMERIC(6, 3) NOT NULL, 
	max_open_orders INTEGER NOT NULL, 
	max_open_positions INTEGER NOT NULL, 
	stop_loss_required BOOLEAN NOT NULL, 
	cooldown_after_losses INTEGER NOT NULL, 
	cooldown_minutes INTEGER NOT NULL, 
	daily_loss_hit_at TIMESTAMP WITH TIME ZONE, 
	cooldown_until TIMESTAMP WITH TIME ZONE, 
	consecutive_losses INTEGER NOT NULL, 
	live_opt_in BOOLEAN NOT NULL, 
	live_consent_at TIMESTAMP WITH TIME ZONE, 
	automation_opt_in BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ix_risk_policies_user_id ON risk_policies (user_id);

CREATE TABLE signals (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36), 
	symbol VARCHAR(20) NOT NULL, 
	timeframe VARCHAR(8) NOT NULL, 
	action VARCHAR(8) NOT NULL, 
	score NUMERIC(10, 4), 
	model_version VARCHAR(40), 
	model_status VARCHAR(40), 
	payload JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX ix_signals_symbol ON signals (symbol);

CREATE INDEX ix_signals_symbol_tf_created ON signals (symbol, timeframe, created_at);

CREATE INDEX ix_signals_user_id ON signals (user_id);

CREATE TABLE exchange_orders (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	credential_id VARCHAR(36), 
	symbol VARCHAR(20) NOT NULL, 
	client_order_id VARCHAR(64) NOT NULL, 
	exchange_order_id VARCHAR(64), 
	side VARCHAR(4) NOT NULL, 
	order_type VARCHAR(17) NOT NULL, 
	time_in_force VARCHAR(3), 
	quantity NUMERIC(28, 12) NOT NULL, 
	price NUMERIC(28, 12), 
	stop_price NUMERIC(28, 12), 
	status VARCHAR(16) NOT NULL, 
	executed_qty NUMERIC(28, 12) NOT NULL, 
	cummulative_quote_qty NUMERIC(20, 8) NOT NULL, 
	fee_paid NUMERIC(20, 8) NOT NULL, 
	fee_asset VARCHAR(12), 
	mode VARCHAR(8) NOT NULL, 
	environment VARCHAR(10) NOT NULL, 
	idempotency_key VARCHAR(80) NOT NULL, 
	signal_id VARCHAR(36), 
	approved BOOLEAN NOT NULL, 
	approved_at TIMESTAMP WITH TIME ZONE, 
	raw_response JSON NOT NULL, 
	last_error VARCHAR(255), 
	reconciled_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_exchange_order_idempotency UNIQUE (user_id, idempotency_key), 
	CONSTRAINT uq_exchange_client_order UNIQUE (user_id, client_order_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(credential_id) REFERENCES api_credentials (id) ON DELETE SET NULL
);

CREATE INDEX ix_exchange_orders_exchange_order_id ON exchange_orders (exchange_order_id);

CREATE INDEX ix_exchange_orders_symbol ON exchange_orders (symbol);

CREATE INDEX ix_exchange_orders_user_id ON exchange_orders (user_id);

CREATE INDEX ix_exchange_orders_user_status ON exchange_orders (user_id, status);

COMMIT;
