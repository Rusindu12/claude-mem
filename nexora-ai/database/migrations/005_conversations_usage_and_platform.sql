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
