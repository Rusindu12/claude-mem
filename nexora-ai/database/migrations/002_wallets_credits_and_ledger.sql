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
