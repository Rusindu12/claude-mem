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
