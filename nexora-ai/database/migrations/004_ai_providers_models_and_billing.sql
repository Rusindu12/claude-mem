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
