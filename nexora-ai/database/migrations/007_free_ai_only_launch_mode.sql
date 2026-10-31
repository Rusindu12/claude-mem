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
