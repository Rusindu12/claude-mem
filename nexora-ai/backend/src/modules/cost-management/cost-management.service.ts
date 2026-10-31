import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';

export interface ModelPricingInfo {
  modelId: string;
  providerInputCostPer1kUsd: number;
  providerOutputCostPer1kUsd: number;
  providerImageCostUsd: number;
  providerVideoPerSecCostUsd: number;
  providerAudioPerMinCostUsd: number;
  creditCostPer1kInput: number;
  creditCostPer1kOutput: number;
  flatCreditCostPerRequest: number;
  creditCostPerImage: number;
  creditCostPerVideoSec: number;
  creditCostPerAudioMin: number;
  minimumCreditCharge: number;
}

@Injectable()
export class CostManagementService {
  private readonly logger = new Logger(CostManagementService.name);

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async getModelPricing(modelId: string): Promise<ModelPricingInfo> {
    const res = await this.db.query(
      `SELECT * FROM ai_model_prices
       WHERE model_id = $1 AND is_current = TRUE
       ORDER BY effective_from DESC
       LIMIT 1`,
      [modelId],
    );
    if (res.rowCount === 0) {
      return {
        modelId,
        providerInputCostPer1kUsd: 0.0005,
        providerOutputCostPer1kUsd: 0.0015,
        providerImageCostUsd: 0.04,
        providerVideoPerSecCostUsd: 0.15,
        providerAudioPerMinCostUsd: 0.006,
        creditCostPer1kInput: 0.2,
        creditCostPer1kOutput: 0.6,
        flatCreditCostPerRequest: 0,
        creditCostPerImage: 12,
        creditCostPerVideoSec: 35,
        creditCostPerAudioMin: 2,
        minimumCreditCharge: 0.25,
      };
    }
    const p = res.rows[0];
    return {
      modelId,
      providerInputCostPer1kUsd: Number(p.provider_input_cost_per_1k_usd),
      providerOutputCostPer1kUsd: Number(p.provider_output_cost_per_1k_usd),
      providerImageCostUsd: Number(p.provider_image_cost_usd),
      providerVideoPerSecCostUsd: Number(p.provider_video_per_sec_cost_usd),
      providerAudioPerMinCostUsd: Number(p.provider_audio_per_min_cost_usd),
      creditCostPer1kInput: Number(p.credit_cost_per_1k_input),
      creditCostPer1kOutput: Number(p.credit_cost_per_1k_output),
      flatCreditCostPerRequest: Number(p.flat_credit_cost_per_request),
      creditCostPerImage: Number(p.credit_cost_per_image),
      creditCostPerVideoSec: Number(p.credit_cost_per_video_sec),
      creditCostPerAudioMin: Number(p.credit_cost_per_audio_min),
      minimumCreditCharge: Number(p.minimum_credit_charge),
    };
  }

  estimateTextCredits(pricing: ModelPricingInfo, estimatedInputTokens: number, estimatedOutputTokens: number): {
    estimatedCredits: number;
    estimatedProviderUsd: number;
  } {
    const rawCredits =
      pricing.flatCreditCostPerRequest +
      (estimatedInputTokens / 1000) * pricing.creditCostPer1kInput +
      (estimatedOutputTokens / 1000) * pricing.creditCostPer1kOutput;
    const estimatedCredits = Math.round(Math.max(pricing.minimumCreditCharge, rawCredits) * 10000) / 10000;

    const estimatedProviderUsd =
      Math.round(
        ((estimatedInputTokens / 1000) * pricing.providerInputCostPer1kUsd +
          (estimatedOutputTokens / 1000) * pricing.providerOutputCostPer1kUsd) *
          1000000,
      ) / 1000000;

    return { estimatedCredits, estimatedProviderUsd };
  }

  calculateActualUsageCost(
    pricing: ModelPricingInfo,
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      imagesGenerated?: number;
      videoSeconds?: number;
      audioSeconds?: number;
    },
  ): { creditsToCharge: number; providerCostUsd: number } {
    const inTok = usage.inputTokens || 0;
    const outTok = usage.outputTokens || 0;
    const imgs = usage.imagesGenerated || 0;
    const vidSec = usage.videoSeconds || 0;
    const audMin = (usage.audioSeconds || 0) / 60;

    const rawCredits =
      pricing.flatCreditCostPerRequest +
      (inTok / 1000) * pricing.creditCostPer1kInput +
      (outTok / 1000) * pricing.creditCostPer1kOutput +
      imgs * pricing.creditCostPerImage +
      vidSec * pricing.creditCostPerVideoSec +
      audMin * pricing.creditCostPerAudioMin;

    const creditsToCharge =
      Math.round(Math.max(pricing.minimumCreditCharge, rawCredits) * 10000) / 10000;

    const rawUsd =
      (inTok / 1000) * pricing.providerInputCostPer1kUsd +
      (outTok / 1000) * pricing.providerOutputCostPer1kUsd +
      imgs * pricing.providerImageCostUsd +
      vidSec * pricing.providerVideoPerSecCostUsd +
      audMin * pricing.providerAudioPerMinCostUsd;

    const providerCostUsd = Math.round(rawUsd * 1000000) / 1000000;
    return { creditsToCharge, providerCostUsd };
  }

  /**
   * Checks whether a provider is within Owner-configured daily and monthly spending caps.
   */
  async checkProviderBudgetAllowed(
    providerId: string,
    isExpensiveModel: boolean,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const today = this.crypto.getColomboDateString();
    const month = this.crypto.getColomboMonthString();

    const res = await this.db.query<{
      id: string;
      monthly_budget_limit_usd: string;
      daily_budget_limit_usd: string;
      current_month_spend_usd: string;
      current_day_spend_usd: string;
      billing_period_month: string;
      billing_period_day: string;
      auto_disable_expensive_on_limit: boolean;
      hard_stop_on_limit: boolean;
    }>('SELECT * FROM provider_billing_accounts WHERE provider_id = $1', [providerId]);

    if (res.rowCount === 0) return { allowed: true };
    const b = res.rows[0];

    let daySpend = Number(b.current_day_spend_usd);
    let monthSpend = Number(b.current_month_spend_usd);

    // Rollover daily or monthly spend counters when Colombo period advances
    if (b.billing_period_day !== today || b.billing_period_month !== month) {
      daySpend = b.billing_period_day === today ? daySpend : 0;
      monthSpend = b.billing_period_month === month ? monthSpend : 0;
      await this.db.query(
        `UPDATE provider_billing_accounts
         SET current_day_spend_usd = $1,
             current_month_spend_usd = $2,
             billing_period_day = $3,
             billing_period_month = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [daySpend, monthSpend, today, month, b.id],
      );
    }

    const dayLimit = Number(b.daily_budget_limit_usd);
    const monthLimit = Number(b.monthly_budget_limit_usd);
    const dayExceeded = dayLimit > 0 && daySpend >= dayLimit;
    const monthExceeded = monthLimit > 0 && monthSpend >= monthLimit;

    if (dayExceeded || monthExceeded) {
      const limitLabel = monthExceeded
        ? `monthly budget ($${monthLimit.toFixed(2)})`
        : `daily budget ($${dayLimit.toFixed(2)})`;

      if (b.auto_disable_expensive_on_limit && isExpensiveModel) {
        await this.db.query(
          'UPDATE ai_models SET is_budget_paused = TRUE, updated_at = NOW() WHERE provider_id = $1 AND is_expensive = TRUE',
          [providerId],
        );
        return {
          allowed: false,
          reason: `Expensive AI model paused because provider reached ${limitLabel}`,
        };
      }

      if (b.hard_stop_on_limit) {
        await this.db.query(
          "UPDATE ai_providers SET health_status = 'BUDGET_EXCEEDED', updated_at = NOW() WHERE id = $1",
          [providerId],
        );
        return {
          allowed: false,
          reason: `Provider hard-stopped after reaching ${limitLabel}`,
        };
      }
    }

    // Optional Strict Payment-Funded API Reserve Guard:
    // Ensures AI API key spend never exceeds the reserve automatically deducted from verified customer payments + Owner float
    const guardSetting = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'finance.payment_funded_api_guard'",
    );
    const guardCfg = guardSetting.rows[0]?.setting_value;
    if (guardCfg?.enabled) {
      const allocPct = Number(guardCfg.reserveAllocationPercent ?? 35);
      const floatUsd = Number(guardCfg.initialFloatUsd ?? 0);
      const [payAgg, usageAgg] = await Promise.all([
        this.db.query<{ net_usd: string }>(
          `SELECT COALESCE(SUM(net_amount_usd - refunded_amount_usd), 0)::text AS net_usd
           FROM payments WHERE status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')`,
        ),
        this.db.query<{ spent_usd: string }>(
          `SELECT COALESCE(SUM(provider_cost_usd), 0)::text AS spent_usd FROM ai_usage`,
        ),
      ]);
      const fundedPoolUsd = floatUsd + (Number(payAgg.rows[0].net_usd) * allocPct) / 100;
      const spentUsd = Number(usageAgg.rows[0].spent_usd);
      if (spentUsd >= fundedPoolUsd) {
        return {
          allowed: false,
          reason: `Payment-funded AI API reserve ($${fundedPoolUsd.toFixed(2)}) reached; awaiting new customer payments or Owner float`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Records actual provider USD cost, updates billing ledger, and alerts Owner if threshold crossed.
   */
  async recordUsageAndCheckAlerts(params: {
    userId: string;
    conversationId?: string;
    messageId?: string;
    providerId: string;
    modelId: string;
    reservationId?: string;
    taskType: string;
    inputTokens: number;
    outputTokens: number;
    imagesGenerated?: number;
    videoSeconds?: number;
    audioSeconds?: number;
    providerCostUsd: number;
    creditsCharged: number;
    realizedRevenueUsd: number;
  }): Promise<void> {
    const today = this.crypto.getColomboDateString();
    const month = this.crypto.getColomboMonthString();

    await this.db.query(
      `INSERT INTO ai_usage (
         user_id, conversation_id, message_id, provider_id, model_id, reservation_id,
         task_type, input_tokens, output_tokens, total_tokens,
         images_generated, video_seconds_generated, audio_seconds_processed,
         provider_cost_usd, credits_charged, realized_revenue_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        params.userId,
        params.conversationId || null,
        params.messageId || null,
        params.providerId,
        params.modelId,
        params.reservationId || null,
        params.taskType,
        params.inputTokens,
        params.outputTokens,
        params.inputTokens + params.outputTokens,
        params.imagesGenerated || 0,
        params.videoSeconds || 0,
        params.audioSeconds || 0,
        params.providerCostUsd,
        params.creditsCharged,
        params.realizedRevenueUsd,
      ],
    );

    const bRes = await this.db.query<{
      id: string;
      account_label: string;
      monthly_budget_limit_usd: string;
      daily_budget_limit_usd: string;
      current_month_spend_usd: string;
      current_day_spend_usd: string;
      alert_threshold_percent: string;
      auto_disable_expensive_on_limit: boolean;
    }>(
      `UPDATE provider_billing_accounts
       SET current_day_spend_usd = CASE WHEN billing_period_day = $1 THEN current_day_spend_usd + $3 ELSE $3 END,
           current_month_spend_usd = CASE WHEN billing_period_month = $2 THEN current_month_spend_usd + $3 ELSE $3 END,
           billing_period_day = $1,
           billing_period_month = $2,
           updated_at = NOW()
       WHERE provider_id = $4
       RETURNING *`,
      [today, month, params.providerCostUsd, params.providerId],
    );

    if (bRes.rowCount > 0) {
      const b = bRes.rows[0];
      const monthSpend = Number(b.current_month_spend_usd);
      const monthLimit = Number(b.monthly_budget_limit_usd);
      const daySpend = Number(b.current_day_spend_usd);
      const dayLimit = Number(b.daily_budget_limit_usd);
      const thresholdPct = Number(b.alert_threshold_percent);

      const monthPct = monthLimit > 0 ? (monthSpend / monthLimit) * 100 : 0;
      const dayPct = dayLimit > 0 ? (daySpend / dayLimit) * 100 : 0;

      if (monthPct >= thresholdPct || dayPct >= thresholdPct) {
        if ((monthPct >= 100 || dayPct >= 100) && b.auto_disable_expensive_on_limit) {
          await this.db.query(
            'UPDATE ai_models SET is_budget_paused = TRUE, updated_at = NOW() WHERE provider_id = $1 AND is_expensive = TRUE',
            [params.providerId],
          );
        }

        // Notify Platform Owners
        const owners = await this.db.query<{ id: string }>(
          `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'OWNER'`,
        );
        for (const owner of owners.rows) {
          await this.db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata)
             VALUES ($1, 'OWNER_BUDGET_ALERT', $2, $3, $4)`,
            [
              owner.id,
              `AI Budget Alert: ${b.account_label}`,
              `Provider spend reached $${daySpend.toFixed(4)} today (${dayPct.toFixed(1)}% of daily cap) and $${monthSpend.toFixed(4)} this month (${monthPct.toFixed(1)}% of monthly cap).`,
              JSON.stringify({ providerId: params.providerId, daySpend, monthSpend }),
            ],
          );
        }
        this.logger.warn(`Owner AI budget threshold reached for ${b.account_label}`);
      }
    }
  }

  /**
   * Reconciles internal token/media expense logs against external provider billing report total.
   */
  async reconcileProviderBilling(providerId: string, providerReportedMonthUsd: number) {
    const res = await this.db.query<{
      id: string;
      current_month_spend_usd: string;
    }>('SELECT id, current_month_spend_usd FROM provider_billing_accounts WHERE provider_id = $1', [
      providerId,
    ]);
    if (res.rowCount === 0) return null;

    const tracked = Number(res.rows[0].current_month_spend_usd);
    const drift = Math.round((providerReportedMonthUsd - tracked) * 1000000) / 1000000;

    await this.db.query(
      `UPDATE provider_billing_accounts
       SET provider_reported_month_usd = $1,
           reconciliation_drift_usd = $2,
           last_reconciled_at = NOW(),
           updated_at = NOW()
       WHERE provider_id = $3`,
      [providerReportedMonthUsd, drift, providerId],
    );

    return {
      providerId,
      trackedMonthSpendUsd: tracked,
      providerReportedMonthUsd,
      reconciliationDriftUsd: drift,
      reconciledAt: new Date().toISOString(),
    };
  }
}
