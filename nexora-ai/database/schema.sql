-- ============================================================================
-- NEXORA AI - Migration 001: Core IAM, RBAC Roles, Permissions & Sessions
-- PostgreSQL 14/15/16+ Compatible (uses native gen_random_uuid())
-- ============================================================================

-- 1. roles
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. permissions
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL UNIQUE,
  module VARCHAR(60) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role <-> Permission M:N mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

-- 3. users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(40),
  country_code VARCHAR(5) NOT NULL DEFAULT 'LK',
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'si')),
  theme_preference VARCHAR(10) NOT NULL DEFAULT 'dark' CHECK (theme_preference IN ('dark', 'light')),
  role_id UUID NOT NULL REFERENCES roles(id),
  referral_code VARCHAR(24) NOT NULL UNIQUE,
  referred_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  suspension_reason TEXT,
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  failed_login_attempts INT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  privacy_marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  data_retention_days INT NOT NULL DEFAULT 365 CHECK (data_retention_days >= 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- 4. sessions (Refresh-token rotation + token-family reuse detection)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
  token_family_id UUID NOT NULL,
  device_name VARCHAR(150),
  ip_address VARCHAR(64),
  user_agent TEXT,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_reason VARCHAR(120),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON sessions(token_family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Password recovery tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user_id ON password_reset_tokens(user_id);

-- Business API Keys (for Business & Enterprise accounts)
CREATE TABLE IF NOT EXISTS business_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(20) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '["chat","models","usage"]'::jsonb,
  rate_limit_rpm INT NOT NULL DEFAULT 120 CHECK (rate_limit_rpm > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_api_keys_user ON business_api_keys(user_id);
-- ============================================================================
-- NEXORA AI - Migration 002: Wallets, 3-Balance Credit Engine & Immutable Ledger
-- ============================================================================

-- 5. wallets (Three strictly non-negative credit buckets + reserved lock pool)
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  free_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (free_credits >= 0),
  purchased_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  reserved_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  -- Tracks unearned USD value backing remaining purchased_credits (GAAP deferred revenue)
  unearned_purchased_liability_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (unearned_purchased_liability_usd >= 0),
  lifetime_free_granted NUMERIC(14, 4) NOT NULL DEFAULT 0,
  lifetime_purchased NUMERIC(14, 4) NOT NULL DEFAULT 0,
  lifetime_bonus_granted NUMERIC(14, 4) NOT NULL DEFAULT 0,
  lifetime_spent NUMERIC(14, 4) NOT NULL DEFAULT 0,
  last_daily_claim_colombo VARCHAR(10),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

-- 6. wallet_transactions (Immutable double-audited ledger)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tx_type VARCHAR(40) NOT NULL CHECK (tx_type IN (
    'DAILY_FREE_GRANT',
    'DAILY_FREE_EXPIRE',
    'CREDIT_PURCHASE',
    'SUBSCRIPTION_BONUS',
    'REFERRAL_REWARD',
    'PROMO_REWARD',
    'ADMIN_GRANT',
    'RESERVE',
    'SETTLE',
    'RELEASE_UNUSED',
    'REFUND_FAILED_REQUEST',
    'PAYMENT_REFUND_DEBIT'
  )),
  credit_bucket VARCHAR(20) NOT NULL CHECK (credit_bucket IN ('FREE', 'PURCHASED', 'BONUS', 'MIXED')),
  amount NUMERIC(14, 4) NOT NULL,
  free_delta NUMERIC(14, 4) NOT NULL DEFAULT 0,
  purchased_delta NUMERIC(14, 4) NOT NULL DEFAULT 0,
  bonus_delta NUMERIC(14, 4) NOT NULL DEFAULT 0,
  balance_free_after NUMERIC(14, 4) NOT NULL CHECK (balance_free_after >= 0),
  balance_purchased_after NUMERIC(14, 4) NOT NULL CHECK (balance_purchased_after >= 0),
  balance_bonus_after NUMERIC(14, 4) NOT NULL CHECK (balance_bonus_after >= 0),
  -- Monetary revenue recognized when purchased credits are settled
  realized_revenue_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  reference_type VARCHAR(50),
  reference_id VARCHAR(100),
  idempotency_key VARCHAR(140) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(tx_type, created_at DESC);

-- Enforce strict immutability on wallet_transactions
CREATE OR REPLACE FUNCTION prevent_immutable_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Financial ledger and audit records are strictly immutable (% on % is prohibited)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_transactions_immutable ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_immutable
BEFORE UPDATE OR DELETE ON wallet_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

-- 7. credit_reservations (Pre-request atomic credit holds)
CREATE TABLE IF NOT EXISTS credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(140) NOT NULL UNIQUE,
  task_type VARCHAR(40) NOT NULL,
  model_id UUID,
  total_reserved NUMERIC(14, 4) NOT NULL CHECK (total_reserved >= 0),
  reserved_free NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (reserved_free >= 0),
  reserved_bonus NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (reserved_bonus >= 0),
  reserved_purchased NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (reserved_purchased >= 0),
  -- Unit USD value per reserved purchased credit snapshot at reservation time
  purchased_unit_usd NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (purchased_unit_usd >= 0),
  settled_amount NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  released_amount NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
  purchased_consumed NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (purchased_consumed >= 0),
  realized_revenue_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (realized_revenue_usd >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'SETTLED', 'REFUNDED', 'EXPIRED')),
  failure_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_res_user_status ON credit_reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_res_expires ON credit_reservations(status, expires_at);

-- 8. daily_credit_settings (Configurable daily free allowance per tier)
CREATE TABLE IF NOT EXISTS daily_credit_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(40) NOT NULL UNIQUE,
  daily_free_credits NUMERIC(14, 4) NOT NULL CHECK (daily_free_credits >= 0),
  reset_timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Colombo',
  max_claims_per_ip_per_day INT NOT NULL DEFAULT 5 CHECK (max_claims_per_ip_per_day >= 1),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. daily_credit_claims (One valid claim per user per Colombo calendar day)
CREATE TABLE IF NOT EXISTS daily_credit_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  claim_date_colombo VARCHAR(10) NOT NULL, -- YYYY-MM-DD in Asia/Colombo
  credits_granted NUMERIC(14, 4) NOT NULL CHECK (credits_granted >= 0),
  previous_free_expired NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (previous_free_expired >= 0),
  ip_address VARCHAR(64),
  device_fingerprint VARCHAR(128),
  wallet_tx_id UUID REFERENCES wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_daily_claim_user_colombo_day UNIQUE (user_id, claim_date_colombo)
);

CREATE INDEX IF NOT EXISTS idx_daily_claims_ip_day ON daily_credit_claims(ip_address, claim_date_colombo);
-- ============================================================================
-- NEXORA AI - Migration 003: Credit Packages, Subscriptions & Payment Gateways
-- ============================================================================

-- 10. credit_packages (Starter, Basic, Standard, Premium, Ultimate)
CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  credits NUMERIC(14, 4) NOT NULL CHECK (credits > 0),
  bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  price_usd NUMERIC(12, 2) NOT NULL CHECK (price_usd > 0),
  price_lkr NUMERIC(12, 2) NOT NULL CHECK (price_lkr > 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. subscription_plans (Free, Monthly Premium, Annual Premium, Business, Enterprise)
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('NONE', 'MONTHLY', 'ANNUAL')),
  price_usd NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  price_lkr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price_lkr >= 0),
  included_bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (included_bonus_credits >= 0),
  daily_free_credits NUMERIC(14, 4) NOT NULL DEFAULT 25 CHECK (daily_free_credits >= 0),
  rate_limit_rpm INT NOT NULL DEFAULT 20 CHECK (rate_limit_rpm > 0),
  concurrent_requests_limit INT NOT NULL DEFAULT 2 CHECK (concurrent_requests_limit > 0),
  allows_premium_models BOOLEAN NOT NULL DEFAULT FALSE,
  allows_image_gen BOOLEAN NOT NULL DEFAULT TRUE,
  allows_video_gen BOOLEAN NOT NULL DEFAULT FALSE,
  allows_voice BOOLEAN NOT NULL DEFAULT TRUE,
  allows_business_api BOOLEAN NOT NULL DEFAULT FALSE,
  team_seats INT NOT NULL DEFAULT 1 CHECK (team_seats >= 1),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status VARCHAR(25) NOT NULL CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'PENDING')),
  payment_provider VARCHAR(30),
  external_subscription_id VARCHAR(140),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_paid_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(status, current_period_end);

-- 13. payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_number VARCHAR(64) NOT NULL UNIQUE,
  payment_type VARCHAR(30) NOT NULL CHECK (payment_type IN ('CREDIT_PACKAGE', 'SUBSCRIPTION')),
  credit_package_id UUID REFERENCES credit_packages(id) ON DELETE RESTRICT,
  subscription_plan_id UUID REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  provider VARCHAR(30) NOT NULL CHECK (provider IN ('PAYHERE', 'STRIPE')),
  external_payment_id VARCHAR(140),
  currency VARCHAR(3) NOT NULL CHECK (currency IN ('LKR', 'USD', 'EUR', 'GBP')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  fx_rate_to_usd NUMERIC(14, 8) NOT NULL CHECK (fx_rate_to_usd > 0),
  amount_usd NUMERIC(12, 4) NOT NULL CHECK (amount_usd > 0),
  gateway_fee_usd NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (gateway_fee_usd >= 0),
  net_amount_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  credits_to_grant NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (credits_to_grant >= 0),
  bonus_credits_to_grant NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (bonus_credits_to_grant >= 0),
  promo_code_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'
  )),
  refunded_amount_usd NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (refunded_amount_usd >= 0),
  refunded_credits_debited NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (refunded_credits_debited >= 0),
  refund_reason TEXT,
  invoice_number VARCHAR(64) UNIQUE,
  invoice_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_by_webhook BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order_number ON payments(order_number);

-- 14. payment_webhook_events (Idempotency + audit trail for gateway webhooks)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL,
  provider_event_id VARCHAR(160) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  raw_payload JSONB NOT NULL,
  processing_status VARCHAR(30) NOT NULL CHECK (processing_status IN ('PROCESSED', 'IGNORED_DUPLICATE', 'FAILED')),
  error_message TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_payment ON payment_webhook_events(payment_id);
-- ============================================================================
-- NEXORA AI - Migration 004: Multi-Provider AI Engine, Models, Pricing & Budgets
-- ============================================================================

-- 15. ai_providers
CREATE TABLE IF NOT EXISTS ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  adapter_type VARCHAR(30) NOT NULL CHECK (adapter_type IN ('OPENAI', 'GEMINI', 'ANTHROPIC', 'OPENAI_COMPATIBLE')),
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  extra_headers_encrypted TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(30) NOT NULL DEFAULT 'UNCONFIGURED' CHECK (health_status IN (
    'HEALTHY', 'DEGRADED', 'DOWN', 'UNCONFIGURED', 'BUDGET_EXCEEDED'
  )),
  priority INT NOT NULL DEFAULT 100,
  timeout_ms INT NOT NULL DEFAULT 45000 CHECK (timeout_ms >= 1000),
  max_retries INT NOT NULL DEFAULT 2 CHECK (max_retries >= 0 AND max_retries <= 5),
  max_concurrency INT NOT NULL DEFAULT 50 CHECK (max_concurrency >= 1),
  supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
  supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
  supports_image_gen BOOLEAN NOT NULL DEFAULT FALSE,
  supports_video_gen BOOLEAN NOT NULL DEFAULT FALSE,
  supports_audio BOOLEAN NOT NULL DEFAULT FALSE,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error TEXT,
  last_health_check_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. provider_billing_accounts (Owner AI Expense & Budget Protection)
CREATE TABLE IF NOT EXISTS provider_billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL UNIQUE REFERENCES ai_providers(id) ON DELETE CASCADE,
  account_label VARCHAR(120) NOT NULL,
  billing_method VARCHAR(80) NOT NULL DEFAULT 'OWNER_AUTHORIZED_API_BILLING',
  billing_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  monthly_budget_limit_usd NUMERIC(12, 4) NOT NULL DEFAULT 500.0000 CHECK (monthly_budget_limit_usd >= 0),
  daily_budget_limit_usd NUMERIC(12, 4) NOT NULL DEFAULT 50.0000 CHECK (daily_budget_limit_usd >= 0),
  current_month_spend_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (current_month_spend_usd >= 0),
  current_day_spend_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (current_day_spend_usd >= 0),
  provider_reported_month_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  reconciliation_drift_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  alert_threshold_percent NUMERIC(5, 2) NOT NULL DEFAULT 80.00 CHECK (alert_threshold_percent > 0 AND alert_threshold_percent <= 100),
  auto_disable_expensive_on_limit BOOLEAN NOT NULL DEFAULT TRUE,
  hard_stop_on_limit BOOLEAN NOT NULL DEFAULT TRUE,
  billing_period_month VARCHAR(7) NOT NULL DEFAULT '2026-10',
  billing_period_day VARCHAR(10) NOT NULL DEFAULT '2026-10-30',
  last_alert_sent_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. ai_models
CREATE TABLE IF NOT EXISTS ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_key VARCHAR(120) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(30) NOT NULL CHECK (category IN ('CHAT', 'REASONING', 'CODING', 'IMAGE', 'VIDEO', 'AUDIO')),
  tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD' CHECK (tier IN ('FREE', 'STANDARD', 'PREMIUM', 'ENTERPRISE')),
  context_window INT NOT NULL DEFAULT 128000,
  max_output_tokens INT NOT NULL DEFAULT 8192,
  supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
  supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
  supports_sinhala BOOLEAN NOT NULL DEFAULT TRUE,
  supports_function_calling BOOLEAN NOT NULL DEFAULT TRUE,
  is_expensive BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_budget_paused BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_provider_model_key UNIQUE (provider_id, model_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_models_category_enabled ON ai_models(category, is_enabled);

-- 18. ai_model_prices (Provider USD cost + Platform Token Credit pricing)
CREATE TABLE IF NOT EXISTS ai_model_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
  provider_input_cost_per_1k_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_input_cost_per_1k_usd >= 0),
  provider_output_cost_per_1k_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_output_cost_per_1k_usd >= 0),
  provider_image_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_image_cost_usd >= 0),
  provider_video_per_sec_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_video_per_sec_cost_usd >= 0),
  provider_audio_per_min_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_audio_per_min_cost_usd >= 0),
  credit_cost_per_1k_input NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (credit_cost_per_1k_input >= 0),
  credit_cost_per_1k_output NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (credit_cost_per_1k_output >= 0),
  flat_credit_cost_per_request NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (flat_credit_cost_per_request >= 0),
  credit_cost_per_image NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (credit_cost_per_image >= 0),
  credit_cost_per_video_sec NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (credit_cost_per_video_sec >= 0),
  credit_cost_per_audio_min NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (credit_cost_per_audio_min >= 0),
  minimum_credit_charge NUMERIC(12, 4) NOT NULL DEFAULT 0.2500 CHECK (minimum_credit_charge >= 0),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_prices_current ON ai_model_prices(model_id, is_current);
-- ============================================================================
-- NEXORA AI - Migration 005: Conversations, Usage, Media Jobs, Growth & Audit
-- ============================================================================

-- 19. conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
  mode VARCHAR(30) NOT NULL DEFAULT 'CHAT' CHECK (mode IN (
    'CHAT', 'CODING', 'DOCUMENT', 'STUDY', 'TRANSLATION', 'VOICE', 'PRODUCTIVITY'
  )),
  selected_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  system_prompt TEXT,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  message_count INT NOT NULL DEFAULT 0,
  total_credits_used NUMERIC(14, 4) NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_last_msg ON conversations(user_id, last_message_at DESC);

-- 20. messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  requested_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  executed_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  credits_charged NUMERIC(14, 4) NOT NULL DEFAULT 0,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);

-- 21. ai_usage (Granular financial & token usage accounting)
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  model_id UUID NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES credit_reservations(id) ON DELETE SET NULL,
  task_type VARCHAR(40) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  images_generated INT NOT NULL DEFAULT 0,
  video_seconds_generated NUMERIC(8, 2) NOT NULL DEFAULT 0,
  audio_seconds_processed NUMERIC(8, 2) NOT NULL DEFAULT 0,
  provider_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (provider_cost_usd >= 0),
  credits_charged NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  realized_revenue_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (realized_revenue_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);

-- 22. ai_request_logs (Operational telemetry, fallback & retry trace)
CREATE TABLE IF NOT EXISTS ai_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
  requested_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  executed_model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  task_type VARCHAR(40) NOT NULL,
  endpoint VARCHAR(160),
  http_status INT,
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'SUCCESS', 'FALLBACK_SUCCESS', 'FAILED', 'TIMEOUT', 'RATE_LIMITED', 'BUDGET_BLOCKED', 'UNCONFIGURED'
  )),
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  error_code VARCHAR(80),
  error_message TEXT,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_req_logs_created ON ai_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_req_logs_status ON ai_request_logs(status, created_at DESC);

-- Async Image & Video Generation Jobs (BullMQ / Worker backed)
CREATE TABLE IF NOT EXISTS media_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  model_id UUID NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES credit_reservations(id) ON DELETE RESTRICT,
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  operation VARCHAR(30) NOT NULL CHECK (operation IN (
    'TEXT_TO_IMAGE', 'IMAGE_VARIATION', 'IMAGE_EDIT', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'
  )),
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  source_file_id UUID,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(25) NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'
  )),
  progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  output_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_job_id VARCHAR(160),
  estimated_credits NUMERIC(14, 4) NOT NULL,
  actual_credits NUMERIC(14, 4) NOT NULL DEFAULT 0,
  provider_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_user ON media_generation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_generation_jobs(status, created_at ASC);

-- 23. referrals
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code_used VARCHAR(24) NOT NULL,
  referrer_bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0,
  referred_bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0,
  status VARCHAR(25) NOT NULL DEFAULT 'REWARDED' CHECK (status IN ('REWARDED', 'PENDING', 'REJECTED_ABUSE')),
  ip_address VARCHAR(64),
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_no_self_referral CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at DESC);

-- 24. promo_codes
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  reward_type VARCHAR(25) NOT NULL CHECK (reward_type IN ('BONUS_CREDITS', 'DISCOUNT_PERCENT')),
  bonus_credits NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  max_redemptions INT CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
  current_redemptions INT NOT NULL DEFAULT 0 CHECK (current_redemptions >= 0),
  per_user_limit INT NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_tx_id UUID REFERENCES wallet_transactions(id),
  credits_awarded NUMERIC(14, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_promo_user_once UNIQUE (promo_code_id, user_id)
);

-- 25. file_uploads
CREATE TABLE IF NOT EXISTS file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(255) NOT NULL UNIQUE,
  storage_bucket VARCHAR(100) NOT NULL DEFAULT 'nexora-uploads',
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256_hash VARCHAR(64) NOT NULL,
  extracted_text TEXT,
  purpose VARCHAR(40) NOT NULL CHECK (purpose IN (
    'CHAT_ATTACHMENT', 'DOCUMENT_ANALYSIS', 'IMAGE_EDIT', 'VIDEO_SOURCE', 'AVATAR'
  )),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_user ON file_uploads(user_id, created_at DESC);

-- 26. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL CHECK (type IN (
    'SYSTEM', 'BILLING', 'CREDITS', 'FALLBACK_ALERT', 'PROMO', 'OWNER_BUDGET_ALERT', 'SECURITY', 'ANNOUNCEMENT'
  )),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);

-- Announcements (Platform-wide banners managed by Owner/Admin)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  title_si VARCHAR(200),
  body_si TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'PROMO', 'CRITICAL')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 27. system_settings
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 28. admin_audit_logs (Strictly immutable administrative audit trail)
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(50) NOT NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id VARCHAR(120),
  before_state JSONB,
  after_state JSONB,
  step_up_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs(actor_user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_admin_audit_logs_immutable ON admin_audit_logs;
CREATE TRIGGER trg_admin_audit_logs_immutable
BEFORE UPDATE OR DELETE ON admin_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();
-- ============================================================================
-- NEXORA AI - Migration 006: Seed Default Roles, Permissions, Plans, Packages,
-- AI Providers, Models, Pricing & Platform Settings
-- ============================================================================

-- 1. Roles (Owner, Administrator, Support Staff, Normal User)
INSERT INTO roles (name, description, is_system) VALUES
  ('OWNER', 'Platform Owner with unrestricted financial, credential, and governance authority', TRUE),
  ('ADMIN', 'Platform Administrator with operational, model, pricing, and user management access', TRUE),
  ('SUPPORT', 'Support Staff with read-only diagnostics, ticket/user lookup, and support tools', TRUE),
  ('USER', 'Standard NEXORA AI customer account', TRUE)
ON CONFLICT (name) DO NOTHING;

-- 2. Permissions
INSERT INTO permissions (code, module, description) VALUES
  ('owner:manage_admins', 'IAM', 'Promote or revoke Administrator and Support Staff roles'),
  ('owner:manage_credentials', 'AI_PROVIDERS', 'Configure encrypted AI provider and payment gateway secrets'),
  ('owner:manage_budgets', 'FINANCE', 'Configure provider spending limits and hard-stop controls'),
  ('owner:platform_availability', 'SYSTEM', 'Toggle platform maintenance mode and emergency kill-switches'),
  ('admin:manage_models', 'AI_MODELS', 'Enable/disable AI models and configure token credit pricing'),
  ('admin:manage_packages', 'MONETIZATION', 'Configure credit packages, subscription plans, and discounts'),
  ('admin:manage_users', 'USERS', 'Suspend/unsuspend users and issue audited bonus credits'),
  ('admin:manage_promos', 'GROWTH', 'Create promotional codes and platform announcements'),
  ('admin:process_refunds', 'PAYMENTS', 'Process verified payment refunds and credit clawbacks'),
  ('admin:view_analytics', 'ANALYTICS', 'View revenue, deferred credit liability, AI expenses, and profit'),
  ('support:view_users', 'SUPPORT', 'Inspect user profiles, wallet ledgers, and request logs'),
  ('user:use_platform', 'PLATFORM', 'Access AI chat, tools, wallet, and personal history')
ON CONFLICT (code) DO NOTHING;

-- Grant all permissions to OWNER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'OWNER'
ON CONFLICT DO NOTHING;

-- Grant admin/support/user permissions to ADMIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'ADMIN' AND p.code NOT LIKE 'owner:%'
ON CONFLICT DO NOTHING;

-- Grant support + user permissions to SUPPORT
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'SUPPORT' AND (p.code LIKE 'support:%' OR p.code LIKE 'user:%')
ON CONFLICT DO NOTHING;

-- Grant user permissions to USER
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'USER' AND p.code LIKE 'user:%'
ON CONFLICT DO NOTHING;

-- 3. Subscription Plans (Free, Monthly Premium, Annual Premium, Business, Enterprise)
INSERT INTO subscription_plans (
  code, name, description, billing_interval, price_usd, price_lkr,
  included_bonus_credits, daily_free_credits, rate_limit_rpm, concurrent_requests_limit,
  allows_premium_models, allows_image_gen, allows_video_gen, allows_voice, allows_business_api,
  team_seats, features, discount_percent, sort_order
) VALUES
  (
    'FREE', 'Free Explorer', 'Daily Colombo-time free credits with core multilingual & Sinhala AI chat.',
    'NONE', 0.00, 0.00, 0, 25, 15, 2,
    FALSE, TRUE, FALSE, TRUE, FALSE, 1,
    '["25 Daily Free Credits (Colombo TZ)","Standard AI Chat & Sinhala Support","AI Study & Translation Tools","Community Support"]'::jsonb,
    0, 1
  ),
  (
    'MONTHLY_PREMIUM', 'Monthly Premium', 'Unlock flagship reasoning, coding, image & video AI models with monthly bonus credits.',
    'MONTHLY', 14.99, 4500.00, 1500, 60, 60, 5,
    TRUE, TRUE, TRUE, TRUE, FALSE, 1,
    '["1,500 Monthly Bonus Credits","60 Daily Free Credits","All Flagship Models (GPT-4o, Claude Sonnet, Gemini Pro)","Image & Video Generation","Voice Assistant & Document Analysis"]'::jsonb,
    0, 2
  ),
  (
    'ANNUAL_PREMIUM', 'Annual Premium', 'Save 20% annually with generous credits and priority multi-model routing.',
    'ANNUAL', 143.90, 43200.00, 20000, 75, 90, 8,
    TRUE, TRUE, TRUE, TRUE, FALSE, 1,
    '["20,000 Annual Bonus Credits","75 Daily Free Credits","20% Annual Savings","Priority AI Routing & Zero Queue Delay","Full Image, Video & Voice Suite"]'::jsonb,
    20, 3
  ),
  (
    'BUSINESS', 'Business Pro', 'Team-ready AI workspace with Business REST API keys and high rate limits.',
    'MONTHLY', 49.99, 15000.00, 6500, 120, 240, 20,
    TRUE, TRUE, TRUE, TRUE, TRUE, 5,
    '["6,500 Monthly Bonus Credits","Business API Access (nxr_live_ keys)","Up to 5 Team Seats","240 RPM Rate Limit","Priority Multi-Provider Failover"]'::jsonb,
    0, 4
  ),
  (
    'ENTERPRISE', 'Enterprise Unlimited', 'Custom enterprise SLA, dedicated concurrency pools, and 25+ team seats.',
    'MONTHLY', 199.00, 59900.00, 30000, 300, 600, 60,
    TRUE, TRUE, TRUE, TRUE, TRUE, 25,
    '["30,000 Monthly Bonus Credits","Enterprise API & Webhook Access","25 Team Seats","600 RPM High-Throughput Quota","Dedicated Support & Custom Retention"]'::jsonb,
    0, 5
  )
ON CONFLICT (code) DO NOTHING;

-- 4. Daily Credit Settings per Plan
INSERT INTO daily_credit_settings (plan_code, daily_free_credits, reset_timezone, max_claims_per_ip_per_day, is_enabled) VALUES
  ('FREE', 25, 'Asia/Colombo', 4, TRUE),
  ('MONTHLY_PREMIUM', 60, 'Asia/Colombo', 6, TRUE),
  ('ANNUAL_PREMIUM', 75, 'Asia/Colombo', 6, TRUE),
  ('BUSINESS', 120, 'Asia/Colombo', 15, TRUE),
  ('ENTERPRISE', 300, 'Asia/Colombo', 50, TRUE)
ON CONFLICT (plan_code) DO NOTHING;

-- 5. Credit Packages (Starter, Basic, Standard, Premium, Ultimate)
INSERT INTO credit_packages (
  code, name, description, credits, bonus_credits, price_usd, price_lkr, discount_percent, is_popular, sort_order
) VALUES
  ('STARTER', 'Starter Pack', 'Ideal top-up for everyday chat, coding, and Sinhala translation.', 500, 0, 4.99, 1500.00, 0, FALSE, 1),
  ('BASIC', 'Basic Pack', 'Great value credit bundle for students and creators.', 1200, 100, 9.99, 3000.00, 5, FALSE, 2),
  ('STANDARD', 'Standard Pack', 'Most popular package for flagship models and AI image creation.', 3000, 400, 22.99, 6900.00, 12, TRUE, 3),
  ('PREMIUM', 'Premium Pack', 'Heavy-duty balance for AI coding, document analysis, and video jobs.', 7500, 1500, 49.99, 15000.00, 20, FALSE, 4),
  ('ULTIMATE', 'Ultimate Pack', 'Maximum power credit vault with 25% bonus credits.', 20000, 5000, 119.99, 36000.00, 25, FALSE, 5)
ON CONFLICT (code) DO NOTHING;

-- 6. AI Providers (OpenAI, Google Gemini, Anthropic Claude, Open-Source Compatible)
INSERT INTO ai_providers (
  code, name, adapter_type, base_url, is_enabled, health_status, priority,
  timeout_ms, max_retries, max_concurrency,
  supports_streaming, supports_vision, supports_image_gen, supports_video_gen, supports_audio
) VALUES
  ('openai', 'OpenAI', 'OPENAI', 'https://api.openai.com/v1', TRUE, 'UNCONFIGURED', 10, 45000, 2, 60, TRUE, TRUE, TRUE, TRUE, TRUE),
  ('gemini', 'Google Gemini', 'GEMINI', 'https://generativelanguage.googleapis.com/v1beta', TRUE, 'UNCONFIGURED', 20, 45000, 2, 60, TRUE, TRUE, TRUE, TRUE, TRUE),
  ('anthropic', 'Anthropic Claude', 'ANTHROPIC', 'https://api.anthropic.com/v1', TRUE, 'UNCONFIGURED', 30, 45000, 2, 50, TRUE, TRUE, FALSE, FALSE, FALSE),
  ('openrouter_oss', 'Approved Open-Source AI (OpenAI-Compatible)', 'OPENAI_COMPATIBLE', 'https://openrouter.ai/api/v1', TRUE, 'UNCONFIGURED', 40, 45000, 2, 80, TRUE, TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (code) DO NOTHING;

-- Seed Provider Billing Accounts
INSERT INTO provider_billing_accounts (provider_id, account_label, monthly_budget_limit_usd, daily_budget_limit_usd, alert_threshold_percent)
SELECT id, name || ' Owner Billing Account', 500.00, 50.00, 80.00
FROM ai_providers
ON CONFLICT (provider_id) DO NOTHING;

-- 7. Seed Default AI Models & Pricing
DO $$
DECLARE
  v_openai UUID;
  v_gemini UUID;
  v_anthropic UUID;
  v_oss UUID;
  m_gpt4o_mini UUID;
  m_gpt4o UUID;
  m_gemini_flash UUID;
  m_gemini_pro UUID;
  m_claude_sonnet UUID;
  m_llama3 UUID;
  m_gpt_image UUID;
  m_sora_video UUID;
BEGIN
  SELECT id INTO v_openai FROM ai_providers WHERE code = 'openai';
  SELECT id INTO v_gemini FROM ai_providers WHERE code = 'gemini';
  SELECT id INTO v_anthropic FROM ai_providers WHERE code = 'anthropic';
  SELECT id INTO v_oss FROM ai_providers WHERE code = 'openrouter_oss';

  -- GPT-4o Mini (Fast, Free-tier friendly)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive)
  VALUES (v_openai, 'gpt-4o-mini', 'GPT-4o Mini', 'Fast, cost-efficient multimodal assistant for chat, Sinhala, study & quick tasks.', 'CHAT', 'FREE', 128000, 16384, TRUE, TRUE, TRUE, FALSE)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gpt4o_mini;

  -- Gemini 2.5 Flash
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, fallback_model_id)
  VALUES (v_gemini, 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'Ultra-fast 1M-context multimodal model with strong Sinhala & document comprehension.', 'CHAT', 'FREE', 1000000, 8192, TRUE, TRUE, TRUE, FALSE, m_gpt4o_mini)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gemini_flash;

  UPDATE ai_models SET fallback_model_id = m_gemini_flash WHERE id = m_gpt4o_mini;

  -- GPT-4o Flagship
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, fallback_model_id)
  VALUES (v_openai, 'gpt-4o', 'GPT-4o Omnimodel', 'Flagship multimodal reasoning, vision, document analysis & multilingual intelligence.', 'REASONING', 'PREMIUM', 128000, 16384, TRUE, TRUE, TRUE, TRUE, m_gemini_flash)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gpt4o;

  -- Gemini 2.5 Pro
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, fallback_model_id)
  VALUES (v_gemini, 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'Deep reasoning & massive document synthesis with 1M+ token context window.', 'REASONING', 'PREMIUM', 1000000, 8192, TRUE, TRUE, TRUE, TRUE, m_gpt4o)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gemini_pro;

  -- Claude Sonnet 4 (Coding & Architecture Specialist)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, fallback_model_id)
  VALUES (v_anthropic, 'claude-sonnet-4-20250514', 'Claude Sonnet 4', 'World-class software engineering, code generation, debugging, and analytical writing.', 'CODING', 'PREMIUM', 200000, 8192, TRUE, TRUE, TRUE, TRUE, m_gpt4o)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_claude_sonnet;

  -- Open-Source Llama 3.3 70B Instruct
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, fallback_model_id)
  VALUES (v_oss, 'meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B (Open-Source)', 'Approved open-weights 70B model for general chat, coding, and cost-efficient tasks.', 'CHAT', 'STANDARD', 128000, 8192, TRUE, FALSE, TRUE, FALSE, m_gpt4o_mini)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_llama3;

  -- OpenAI Image Generation (gpt-image-1 / dall-e-3)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive)
  VALUES (v_openai, 'gpt-image-1', 'OpenAI Image Studio (gpt-image-1)', 'High-resolution text-to-image, variations, and image editing.', 'IMAGE', 'STANDARD', 4096, 0, FALSE, TRUE, TRUE, TRUE)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gpt_image;

  -- Video Generation (Veo / Sora compatible)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive)
  VALUES (v_gemini, 'veo-2.0-generate-001', 'Google Veo Cinematic Video', 'Cinematic text-to-video and image-to-video generation via background worker.', 'VIDEO', 'PREMIUM', 4096, 0, FALSE, TRUE, TRUE, TRUE)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_sora_video;

  -- Seed Pricing (1 Credit ~= $0.01 retail benchmark; configurable in system_settings)
  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gpt4o_mini AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_gpt4o_mini, 0.000150, 0.000600, 0.1000, 0.3000, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gemini_flash AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_gemini_flash, 0.000150, 0.000600, 0.1000, 0.3000, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gpt4o AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_gpt4o, 0.002500, 0.010000, 0.8000, 2.4000, 1.0000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gemini_pro AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_gemini_pro, 0.001250, 0.005000, 0.6000, 1.8000, 0.8000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_claude_sonnet AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_claude_sonnet, 0.003000, 0.015000, 0.9000, 3.0000, 1.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_llama3 AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_llama3, 0.000200, 0.000400, 0.1200, 0.2500, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gpt_image AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_image_cost_usd, credit_cost_per_image, minimum_credit_charge)
    VALUES (m_gpt_image, 0.040000, 12.0000, 12.0000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_sora_video AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_video_per_sec_cost_usd, credit_cost_per_video_sec, minimum_credit_charge)
    VALUES (m_sora_video, 0.150000, 35.0000, 35.0000);
  END IF;
END $$;

-- 8. Seed Platform System Settings
INSERT INTO system_settings (setting_key, setting_value, category, description, is_public) VALUES
  ('platform.maintenance_mode', '{"enabled": false, "message": "NEXORA AI is undergoing scheduled maintenance."}'::jsonb, 'AVAILABILITY', 'Global maintenance kill-switch (Owner bypasses)', TRUE),
  ('credits.conversion_rates', '{"usd_per_credit_benchmark": 0.01, "lkr_per_usd": 300.0, "signup_bonus_credits": 50, "referrer_reward_credits": 40, "referred_reward_credits": 30}'::jsonb, 'CREDITS', 'Configurable credit valuation, FX rates, and referral rewards', TRUE),
  ('finance.monthly_hosting_expense_usd', '{"amount_usd": 85.00, "notes": "Cloud servers, managed PostgreSQL, Redis & S3 storage"}'::jsonb, 'FINANCE', 'Monthly infrastructure hosting cost factored into Net Profit analytics', FALSE),
  ('payments.gateways', '{"payhere_enabled": true, "stripe_enabled": true, "supported_currencies": ["LKR", "USD", "EUR", "GBP"]}'::jsonb, 'PAYMENTS', 'Active payment gateway toggles for Sri Lanka and International customers', TRUE)
ON CONFLICT (setting_key) DO NOTHING;

-- 9. Seed Welcome Promo Code
INSERT INTO promo_codes (code, description, reward_type, bonus_credits, max_redemptions, per_user_limit, is_active)
VALUES ('NEXORA2026', 'Launch welcome bonus credits for early adopters', 'BONUS_CREDITS', 50, 10000, 1, TRUE)
ON CONFLICT (code) DO NOTHING;
-- ============================================================================
-- NEXORA AI - Migration 007: Free-AI-Only Launch Mode & Zero-Key Free Providers
-- ============================================================================

ALTER TABLE ai_providers
  ADD COLUMN IF NOT EXISTS requires_api_key BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_free_provider BOOLEAN NOT NULL DEFAULT FALSE;

-- 1. Enable Free-AI-Only Launch Mode by default ($0.00 Owner API bill guarantee!)
INSERT INTO system_settings (setting_key, setting_value, category, description) VALUES
  (
    'platform.free_ai_only_mode',
    '{"enabled": true}'::jsonb,
    'FINANCE',
    'When enabled, strictly restricts routing and media generation to $0.00 Free AI providers/models so Owner incurs zero API bills'
  )
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value;

-- 2. Disable purely paid providers initially until Owner chooses to enable them with paid keys
UPDATE ai_providers
SET is_enabled = FALSE
WHERE code IN ('openai', 'anthropic') AND api_key_encrypted IS NULL;

-- 3. Seed Keyless & Free-Tier AI Providers ($0.00 Provider Cost)
INSERT INTO ai_providers (
  code, name, adapter_type, base_url, is_enabled, health_status, priority,
  timeout_ms, max_retries, max_concurrency,
  supports_streaming, supports_vision, supports_image_gen, supports_video_gen, supports_audio,
  requires_api_key, is_free_provider
) VALUES
  (
    'pollinations_free',
    'Pollinations Free AI (No API Key Needed)',
    'OPENAI_COMPATIBLE',
    'https://text.pollinations.ai/openai',
    TRUE,
    'HEALTHY',
    1,
    45000,
    2,
    80,
    TRUE,
    TRUE,
    TRUE,
    FALSE,
    FALSE,
    FALSE,
    TRUE
  ),
  (
    'ollama_local',
    'Ollama Local Open-Source AI (Self-Hosted Free)',
    'OPENAI_COMPATIBLE',
    'http://ollama:11434/v1',
    FALSE,
    'HEALTHY',
    2,
    60000,
    1,
    20,
    TRUE,
    FALSE,
    FALSE,
    FALSE,
    FALSE,
    FALSE,
    TRUE
  ),
  (
    'groq_free',
    'Groq Cloud Free Tier (Free API Key)',
    'OPENAI_COMPATIBLE',
    'https://api.groq.com/openai/v1',
    TRUE,
    'UNCONFIGURED',
    5,
    30000,
    2,
    60,
    TRUE,
    FALSE,
    FALSE,
    FALSE,
    FALSE,
    TRUE,
    TRUE
  )
ON CONFLICT (code) DO UPDATE SET
  requires_api_key = EXCLUDED.requires_api_key,
  is_free_provider = EXCLUDED.is_free_provider,
  supports_image_gen = EXCLUDED.supports_image_gen;

INSERT INTO provider_billing_accounts (provider_id, account_label, monthly_budget_limit_usd, daily_budget_limit_usd, alert_threshold_percent)
SELECT id, name || ' ($0 Free Tier)', 0.00, 0.00, 80.00
FROM ai_providers
WHERE code IN ('pollinations_free', 'ollama_local', 'groq_free')
ON CONFLICT (provider_id) DO NOTHING;

-- 4. Seed $0.00 Cost Free AI Models (Chat, Sinhala, Coding & Image)
DO $$
DECLARE
  v_poll UUID;
  v_ollama UUID;
  v_groq UUID;
  v_gemini UUID;
  v_oss UUID;
  m_poll_chat UUID;
  m_poll_code UUID;
  m_poll_flux UUID;
  m_ollama_chat UUID;
  m_groq_llama UUID;
  m_gemini_free UUID;
  m_or_free UUID;
BEGIN
  SELECT id INTO v_poll FROM ai_providers WHERE code = 'pollinations_free';
  SELECT id INTO v_ollama FROM ai_providers WHERE code = 'ollama_local';
  SELECT id INTO v_groq FROM ai_providers WHERE code = 'groq_free';
  SELECT id INTO v_gemini FROM ai_providers WHERE code = 'gemini';
  SELECT id INTO v_oss FROM ai_providers WHERE code = 'openrouter_oss';

  -- Pollinations Free Chat (Keyless, $0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled)
  VALUES (v_poll, 'openai', 'NEXORA Free Chat (Zero-Key AI)', '100% Free AI model requiring zero API keys ($0.00 owner cost). Supports English, Sinhala, study & vision.', 'CHAT', 'FREE', 128000, 4096, TRUE, TRUE, TRUE, FALSE, TRUE)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name, is_enabled = TRUE
  RETURNING id INTO m_poll_chat;

  -- Pollinations Free Qwen Coder (Keyless, $0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled, fallback_model_id)
  VALUES (v_poll, 'qwen-coder', 'Qwen 2.5 Coder Free (Zero-Key AI)', '100% Free coding & debugging model ($0.00 owner cost) for TypeScript, Python, SQL & Kotlin.', 'CODING', 'FREE', 128000, 4096, TRUE, FALSE, TRUE, FALSE, TRUE, m_poll_chat)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name, is_enabled = TRUE
  RETURNING id INTO m_poll_code;

  -- Pollinations Flux Free Image Studio (Keyless, $0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled)
  VALUES (v_poll, 'flux', 'Flux Free Image Studio (Zero-Key AI)', '100% Free text-to-image generation powered by Pollinations Flux ($0.00 owner API cost).', 'IMAGE', 'FREE', 4096, 0, FALSE, FALSE, TRUE, FALSE, TRUE)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name, is_enabled = TRUE
  RETURNING id INTO m_poll_flux;

  -- Ollama Local Llama 3.2 (Self-hosted $0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled, fallback_model_id)
  VALUES (v_ollama, 'llama3.2', 'Llama 3.2 Local (Self-Hosted Free)', 'Runs 100% locally on your Docker server via Ollama with zero external API calls or cost.', 'CHAT', 'FREE', 128000, 4096, TRUE, FALSE, TRUE, FALSE, TRUE, m_poll_chat)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_ollama_chat;

  -- Groq Llama 3.3 70B Free Tier ($0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled, fallback_model_id)
  VALUES (v_groq, 'llama-3.3-70b-versatile', 'Groq Llama 3.3 70B (Free Tier)', 'Ultra-fast LPU inference using a free Groq API key ($0.00 owner cost on free tier).', 'CHAT', 'FREE', 128000, 8192, TRUE, FALSE, TRUE, FALSE, TRUE, m_poll_chat)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_groq_llama;

  -- Google Gemini 2.0 Flash Free Tier ($0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled, fallback_model_id)
  VALUES (v_gemini, 'gemini-2.0-flash', 'Gemini 2.0 Flash (Google Free Tier)', 'Google AI Studio Free-Tier multimodal & Sinhala model ($0.00 owner cost on free tier).', 'CHAT', 'FREE', 1000000, 8192, TRUE, TRUE, TRUE, FALSE, TRUE, m_poll_chat)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_gemini_free;

  -- OpenRouter Llama 3.3 70B :free ($0.00 cost)
  INSERT INTO ai_models (provider_id, model_key, display_name, description, category, tier, context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled, fallback_model_id)
  VALUES (v_oss, 'meta-llama/llama-3.3-70b-instruct:free', 'OpenRouter Llama 3.3 70B (:free)', 'Zero-cost :free model on OpenRouter ($0.00/1k input & output).', 'CHAT', 'FREE', 128000, 8192, TRUE, FALSE, TRUE, FALSE, TRUE, m_poll_chat)
  ON CONFLICT (provider_id, model_key) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO m_or_free;

  -- Seed $0.00 Provider Cost Pricing (Users still spend platform Free/Purchased credits!)
  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_poll_chat AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_poll_chat, 0.000000, 0.000000, 0.0800, 0.2000, 0.1500);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_poll_code AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_poll_code, 0.000000, 0.000000, 0.1000, 0.2500, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_poll_flux AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_image_cost_usd, credit_cost_per_image, minimum_credit_charge)
    VALUES (m_poll_flux, 0.000000, 5.0000, 5.0000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_ollama_chat AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_ollama_chat, 0.000000, 0.000000, 0.0800, 0.2000, 0.1500);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_groq_llama AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_groq_llama, 0.000000, 0.000000, 0.1000, 0.2500, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_gemini_free AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_gemini_free, 0.000000, 0.000000, 0.1000, 0.2500, 0.2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai_model_prices WHERE model_id = m_or_free AND is_current = TRUE) THEN
    INSERT INTO ai_model_prices (model_id, provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd, credit_cost_per_1k_input, credit_cost_per_1k_output, minimum_credit_charge)
    VALUES (m_or_free, 0.000000, 0.000000, 0.1000, 0.2500, 0.2000);
  END IF;
END $$;
-- ============================================================================
-- NEXORA AI - Migration 008: OpenRouter Strictly Free-Only Models (:free)
-- Disables all non-:free OpenRouter slugs and seeds $0.00 :free models ONLY
-- ============================================================================

-- 1. Lock OpenRouter provider to Free-Only mode (Priority 1)
UPDATE ai_providers
SET name = 'OpenRouter (Free Models Only)',
    is_enabled = TRUE,
    is_free_provider = TRUE,
    requires_api_key = TRUE,
    supports_vision = TRUE,
    priority = 1,
    updated_at = NOW()
WHERE code = 'openrouter_oss';

-- Set $0.01 hard emergency spend stop on OpenRouter billing account ($0.00 :free models pass; any paid charge stops immediately)
UPDATE provider_billing_accounts
SET daily_budget_limit_usd = 0.0100,
    monthly_budget_limit_usd = 0.0100,
    hard_stop_on_limit = TRUE,
    updated_at = NOW()
WHERE provider_id = (SELECT id FROM ai_providers WHERE code = 'openrouter_oss');

-- Keep Zero-Key Pollinations Free AI at Priority 2 as automatic zero-key backup
UPDATE ai_providers
SET priority = 2,
    updated_at = NOW()
WHERE code = 'pollinations_free';

-- 2. Strictly DISABLE any non-free model on OpenRouter (e.g., paid meta-llama/llama-3.3-70b-instruct)
UPDATE ai_models
SET is_enabled = FALSE,
    updated_at = NOW()
WHERE provider_id = (SELECT id FROM ai_providers WHERE code = 'openrouter_oss')
  AND model_key <> 'openrouter/free'
  AND model_key NOT LIKE '%:free';

-- 3. Seed 100% Free ($0.00 Provider Cost) OpenRouter :free Models
INSERT INTO ai_models (
  provider_id, model_key, display_name, description, category, tier,
  context_window, max_output_tokens, supports_streaming, supports_vision, supports_sinhala, is_expensive, is_enabled
)
SELECT p.id, v.model_key, v.display_name, v.description, v.category, v.tier,
       v.ctx, v.max_out, TRUE, v.vision, v.sinhala, FALSE, TRUE
FROM ai_providers p
JOIN (VALUES
  ('openrouter_oss', 'openrouter/free', 'OpenRouter Auto-Free AI (:free)', 'Automatically selects the fastest available $0.00 free model on OpenRouter with Sinhala & Vision support.', 'CHAT', 'FREE', 131072, 4096, TRUE, TRUE),
  ('openrouter_oss', 'meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B Instruct (:free)', 'Meta flagship 70B model via OpenRouter Free Tier ($0.00 API cost).', 'CHAT', 'FREE', 131072, 4096, FALSE, TRUE),
  ('openrouter_oss', 'deepseek/deepseek-r1:free', 'DeepSeek R1 Reasoning (:free)', 'DeepSeek R1 step-by-step math, logic & deep reasoning via OpenRouter Free Tier ($0.00 API cost).', 'REASONING', 'FREE', 131072, 8192, FALSE, TRUE),
  ('openrouter_oss', 'qwen/qwen-2.5-coder-32b-instruct:free', 'Qwen 2.5 Coder 32B (:free)', 'Dedicated 32B software engineering & debugging specialist via OpenRouter Free Tier ($0.00 API cost).', 'CODING', 'FREE', 131072, 8192, FALSE, FALSE),
  ('openrouter_oss', 'google/gemma-3-27b-it:free', 'Google Gemma 3 27B Vision (:free)', 'Multimodal Vision + Sinhala/English chat model via OpenRouter Free Tier ($0.00 API cost).', 'CHAT', 'FREE', 131072, 4096, TRUE, TRUE),
  ('openrouter_oss', 'mistralai/mistral-small-3.1-24b-instruct:free', 'Mistral Small 3.1 24B (:free)', 'Fast multilingual & vision instruction model via OpenRouter Free Tier ($0.00 API cost).', 'CHAT', 'FREE', 96000, 4096, TRUE, FALSE)
) AS v(pcode, model_key, display_name, description, category, tier, ctx, max_out, vision, sinhala)
  ON p.code = v.pcode
ON CONFLICT (provider_id, model_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    tier = 'FREE',
    is_enabled = TRUE,
    supports_vision = EXCLUDED.supports_vision,
    supports_sinhala = EXCLUDED.supports_sinhala,
    updated_at = NOW();

-- 4. Seed $0.00 Provider Cost Pricing for all OpenRouter :free Models
INSERT INTO ai_model_prices (
  model_id,
  provider_input_cost_per_1k_usd, provider_output_cost_per_1k_usd,
  provider_image_cost_usd, provider_video_per_sec_cost_usd,
  credit_cost_per_1k_input, credit_cost_per_1k_output,
  credit_cost_per_image, credit_cost_per_video_sec,
  minimum_credit_charge, is_current
)
SELECT m.id,
       0.000000, 0.000000, 0.000000, 0.000000,
       v.c_in, v.c_out, 0, 0, v.min_c, TRUE
FROM ai_models m
JOIN ai_providers p ON p.id = m.provider_id
JOIN (VALUES
  ('openrouter_oss', 'openrouter/free', 1, 2, 1),
  ('openrouter_oss', 'meta-llama/llama-3.3-70b-instruct:free', 1, 2, 1),
  ('openrouter_oss', 'deepseek/deepseek-r1:free', 2, 4, 2),
  ('openrouter_oss', 'qwen/qwen-2.5-coder-32b-instruct:free', 1, 3, 1),
  ('openrouter_oss', 'google/gemma-3-27b-it:free', 1, 2, 1),
  ('openrouter_oss', 'mistralai/mistral-small-3.1-24b-instruct:free', 1, 2, 1)
) AS v(pcode, mkey, c_in, c_out, min_c)
  ON p.code = v.pcode AND m.model_key = v.mkey
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_prices existing WHERE existing.model_id = m.id AND existing.is_current = TRUE
);

-- 5. Chain OpenRouter specific :free models -> openrouter/free -> pollinations_free so failover stays 100% $0.00
UPDATE ai_models
SET fallback_model_id = (
  SELECT m2.id FROM ai_models m2
  JOIN ai_providers p2 ON p2.id = m2.provider_id
  WHERE p2.code = 'openrouter_oss' AND m2.model_key = 'openrouter/free'
  LIMIT 1
)
WHERE provider_id = (SELECT id FROM ai_providers WHERE code = 'openrouter_oss')
  AND model_key LIKE '%:free';

UPDATE ai_models
SET fallback_model_id = (
  SELECT m2.id FROM ai_models m2
  JOIN ai_providers p2 ON p2.id = m2.provider_id
  WHERE p2.code = 'pollinations_free' AND m2.model_key = 'openai'
  LIMIT 1
)
WHERE provider_id = (SELECT id FROM ai_providers WHERE code = 'openrouter_oss')
  AND model_key = 'openrouter/free';
