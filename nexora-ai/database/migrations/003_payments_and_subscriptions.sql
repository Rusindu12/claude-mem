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
