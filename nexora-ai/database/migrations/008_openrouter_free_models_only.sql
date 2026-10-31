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
