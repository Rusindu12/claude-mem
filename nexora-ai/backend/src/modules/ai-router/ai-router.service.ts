import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CacheService } from '../../cache/cache.service';
import { WalletService } from '../wallet/wallet.service';
import { AiProvidersService, ChatTurnMessage } from '../ai-providers/ai-providers.service';
import { CostManagementService } from '../cost-management/cost-management.service';

export interface ModelCatalogItem {
  id: string;
  modelKey: string;
  displayName: string;
  description: string;
  category: string;
  tier: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsSinhala: boolean;
  isExpensive: boolean;
  isFreeModel: boolean;
  requiresApiKey: boolean;
  isAvailableNow: boolean;
  unavailableReason: string | null;
  providerCode: string;
  providerName: string;
  pricing: {
    creditCostPer1kInput: number;
    creditCostPer1kOutput: number;
    creditCostPerImage: number;
    creditCostPerVideoSec: number;
    minimumCreditCharge: number;
  };
}

@Injectable()
export class AiRouterService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CacheService) private readonly cache: CacheService,
    @Inject(WalletService) private readonly walletService: WalletService,
    @Inject(AiProvidersService) private readonly providersService: AiProvidersService,
    @Inject(CostManagementService) private readonly costService: CostManagementService,
  ) {}

  async isFreeAiOnlyMode(): Promise<boolean> {
    const res = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'platform.free_ai_only_mode'",
    );
    if (res.rowCount === 0) return false;
    return Boolean(res.rows[0].setting_value?.enabled);
  }

  /**
   * Lists models with real-time provider capability & credential availability.
   * Per Section 9: Only displays generation capabilities supported by connected providers!
   */
  async listAvailableModels(category?: string): Promise<ModelCatalogItem[]> {
    const [freeAiOnly, res] = await Promise.all([
      this.isFreeAiOnlyMode(),
      this.db.query(
        `SELECT m.*,
                p.code AS provider_code, p.name AS provider_name,
                p.is_enabled AS provider_enabled, p.health_status,
                p.api_key_encrypted, p.requires_api_key, p.is_free_provider,
                p.supports_image_gen, p.supports_video_gen,
                pr.provider_input_cost_per_1k_usd, pr.provider_output_cost_per_1k_usd,
                pr.provider_image_cost_usd, pr.provider_video_per_sec_cost_usd,
                pr.credit_cost_per_1k_input, pr.credit_cost_per_1k_output,
                pr.credit_cost_per_image, pr.credit_cost_per_video_sec, pr.minimum_credit_charge
         FROM ai_models m
         JOIN ai_providers p ON p.id = m.provider_id
         LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
         WHERE m.is_enabled = TRUE
           AND ($1::varchar IS NULL OR m.category = $1)
         ORDER BY p.priority ASC, m.display_name ASC`,
        [category || null],
      ),
    ]);

    return res.rows.map((r) => {
      const requiresKey = r.requires_api_key !== false;
      const hasKey = !requiresKey || Boolean(this.providersService.decryptProviderKey(r.api_key_encrypted));
      const isZeroCostModel =
        Number(r.provider_input_cost_per_1k_usd || 0) === 0 &&
        Number(r.provider_output_cost_per_1k_usd || 0) === 0 &&
        Number(r.provider_image_cost_usd || 0) === 0 &&
        Number(r.provider_video_per_sec_cost_usd || 0) === 0;
      const isOpenRouterNonFree =
        r.provider_code === 'openrouter_oss' &&
        (freeAiOnly || Boolean(r.is_free_provider)) &&
        r.model_key !== 'openrouter/free' &&
        !String(r.model_key).endsWith(':free');

      let available =
        r.provider_enabled &&
        hasKey &&
        !r.is_budget_paused &&
        r.health_status !== 'BUDGET_EXCEEDED' &&
        (!freeAiOnly || isZeroCostModel) &&
        !isOpenRouterNonFree;

      let reason: string | null = null;
      if (isOpenRouterNonFree) {
        reason = 'Locked: OpenRouter key is restricted strictly to :free models ($0.00 cost)';
      } else if (freeAiOnly && !isZeroCostModel) {
        reason = 'Locked while Free-AI-Only Launch Mode is ON ($0 API cost protection)';
      } else if (!r.provider_enabled) {
        reason = 'Provider disabled by administrator';
      } else if (!hasKey) {
        reason = 'Provider API credentials not yet configured';
      } else if (r.is_budget_paused || r.health_status === 'BUDGET_EXCEEDED') {
        reason = 'Paused due to Owner spending cap';
      }

      if (r.category === 'IMAGE' && !r.supports_image_gen) {
        available = false;
        reason = 'Provider does not support image generation';
      }
      if (r.category === 'VIDEO' && !r.supports_video_gen) {
        available = false;
        reason = 'Provider does not support video generation';
      }

      return {
        id: r.id,
        modelKey: r.model_key,
        displayName: r.display_name,
        description: r.description,
        category: r.category,
        tier: r.tier,
        contextWindow: r.context_window,
        maxOutputTokens: r.max_output_tokens,
        supportsStreaming: r.supports_streaming,
        supportsVision: r.supports_vision,
        supportsSinhala: r.supports_sinhala,
        isExpensive: r.is_expensive,
        isFreeModel: isZeroCostModel,
        requiresApiKey: requiresKey,
        isAvailableNow: available,
        unavailableReason: reason,
        providerCode: r.provider_code,
        providerName: r.provider_name,
        pricing: {
          creditCostPer1kInput: Number(r.credit_cost_per_1k_input || 0.2),
          creditCostPer1kOutput: Number(r.credit_cost_per_1k_output || 0.6),
          creditCostPerImage: Number(r.credit_cost_per_image || 12),
          creditCostPerVideoSec: Number(r.credit_cost_per_video_sec || 35),
          minimumCreditCharge: Number(r.minimum_credit_charge || 0.25),
        },
      };
    });
  }

  /**
   * Pre-execution transparent credit estimate shown to users before expensive operations.
   */
  async estimateOperationCost(params: {
    modelId?: string;
    taskType: string;
    promptText?: string;
    maxOutputTokens?: number;
    imageCount?: number;
    videoDurationSeconds?: number;
  }) {
    const model = await this.resolveCandidateModel(params.modelId, params.taskType, false);
    const pricing = await this.costService.getModelPricing(model.id);

    if (params.taskType === 'IMAGE') {
      const units = Math.max(1, params.imageCount || 1);
      return {
        modelId: model.id,
        modelName: model.display_name,
        taskType: 'IMAGE',
        estimatedCredits: Math.max(pricing.minimumCreditCharge, units * pricing.creditCostPerImage),
        breakdown: { images: units, creditsPerImage: pricing.creditCostPerImage },
      };
    }

    if (params.taskType === 'VIDEO') {
      const secs = Math.max(4, params.videoDurationSeconds || 5);
      return {
        modelId: model.id,
        modelName: model.display_name,
        taskType: 'VIDEO',
        estimatedCredits: Math.max(pricing.minimumCreditCharge, secs * pricing.creditCostPerVideoSec),
        breakdown: { durationSeconds: secs, creditsPerSecond: pricing.creditCostPerVideoSec },
      };
    }

    const estIn = this.providersService.estimateTokenCount(params.promptText || '') + 120;
    const estOut = Math.min(model.max_output_tokens, params.maxOutputTokens || 800);
    const est = this.costService.estimateTextCredits(pricing, estIn, estOut);

    return {
      modelId: model.id,
      modelName: model.display_name,
      taskType: params.taskType,
      estimatedCredits: est.estimatedCredits,
      breakdown: {
        estimatedInputTokens: estIn,
        estimatedMaxOutputTokens: estOut,
        creditCostPer1kInput: pricing.creditCostPer1kInput,
        creditCostPer1kOutput: pricing.creditCostPer1kOutput,
      },
    };
  }

  /**
   * Intelligent AI Router + Credit Reservation + Automatic Fallback (NEVER silent!) + Cost Accounting.
   */
  async routeAndExecuteChat(params: {
    userId: string;
    userRole: string;
    requestedModelId?: string;
    taskType: string;
    messages: ChatTurnMessage[];
    maxOutputTokens?: number;
    temperature?: number;
    allowFallback?: boolean;
    idempotencyKey: string;
    conversationId?: string;
    ipAddress?: string;
    onTokenDelta?: (delta: string) => void;
  }) {
    const allowFallback = params.allowFallback !== false;
    const requiresVision = params.messages.some((m) => Boolean(m.imageBase64));

    // 1. Check user subscription quotas & rate limits
    const planCode = await this.walletService.getUserPlanCode(params.userId);
    const planRes = await this.db.query<{
      rate_limit_rpm: number;
      concurrent_requests_limit: number;
      allows_premium_models: boolean;
    }>('SELECT rate_limit_rpm, concurrent_requests_limit, allows_premium_models FROM subscription_plans WHERE code = $1', [
      planCode,
    ]);
    const plan = planRes.rows[0] || {
      rate_limit_rpm: 15,
      concurrent_requests_limit: 2,
      allows_premium_models: false,
    };

    const userRl = await this.cache.checkRateLimit(`user:ai:${params.userId}`, plan.rate_limit_rpm, 60);
    if (!userRl.allowed) {
      throw new HttpException(
        `Rate limit of ${plan.rate_limit_rpm} requests/min exceeded for your ${planCode} plan`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const hasUserSlot = await this.cache.acquireConcurrencySlot(
      `user-conc:${params.userId}`,
      plan.concurrent_requests_limit,
      90,
    );
    if (!hasUserSlot) {
      throw new HttpException(
        `Maximum concurrent AI requests (${plan.concurrent_requests_limit}) reached for your plan`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      // 2. Resolve requested model (or intelligent task-based selection)
      const requestedModel = await this.resolveCandidateModel(
        params.requestedModelId,
        params.taskType,
        requiresVision,
      );

      if (
        (requestedModel.tier === 'PREMIUM' || requestedModel.tier === 'ENTERPRISE') &&
        !plan.allows_premium_models &&
        params.userRole !== 'OWNER' &&
        params.userRole !== 'ADMIN'
      ) {
        // Users can still unlock premium models if they have purchased credits OR upgrade subscription
        const walletSnap = await this.walletService.getWalletSummary(params.userId);
        if (walletSnap.purchasedCredits <= 0) {
          throw new ForbiddenException(
            `${requestedModel.display_name} requires a Premium subscription or Purchased Credits`,
          );
        }
      }

      // 3. Build candidate execution chain: [requestedModel, ...compatibleFallbacks]
      const candidates = await this.buildCandidateChain(
        requestedModel,
        requiresVision,
        allowFallback,
      );

      if (candidates.length === 0) {
        await this.logAiRequest({
          userId: params.userId,
          providerId: requestedModel.provider_id,
          requestedModelId: requestedModel.id,
          taskType: params.taskType,
          status: 'UNCONFIGURED',
          latencyMs: 0,
          errorCode: 'NO_CONFIGURED_PROVIDER',
          errorMessage: 'No connected AI provider has valid API credentials configured.',
          ipAddress: params.ipAddress,
        });
        throw new ServiceUnavailableException({
          code: 'PROVIDER_CREDENTIALS_REQUIRED',
          message:
            'No AI provider credentials are currently configured or within budget. Configure an OpenAI, Google Gemini, Anthropic Claude, or Open-Source API key in the Owner Dashboard.',
        });
      }

      // 4. Estimate and atomically RESERVE credits BEFORE calling external AI API
      const firstPricing = await this.costService.getModelPricing(candidates[0].model.id);
      const estInputTokens =
        this.providersService.estimateTokenCount(params.messages.map((m) => m.content).join('\n')) + 80;
      const maxOut = Math.min(candidates[0].model.max_output_tokens, params.maxOutputTokens || 1024);
      const { estimatedCredits } = this.costService.estimateTextCredits(
        firstPricing,
        estInputTokens,
        maxOut,
      );

      const reservation = await this.walletService.reserveCredits({
        userId: params.userId,
        amount: estimatedCredits,
        taskType: params.taskType,
        modelId: candidates[0].model.id,
        idempotencyKey: params.idempotencyKey,
      });

      // 5. Execute across candidate chain with automatic failover & explicit fallback notice
      let lastFailureReason = candidates[0].preFallbackReason || '';

      for (let idx = 0; idx < candidates.length; idx++) {
        const cand = candidates[idx];
        const isFallback = cand.model.id !== requestedModel.id;
        const fallbackReason = isFallback
          ? lastFailureReason || `${requestedModel.display_name} provider unavailable`
          : null;

        const gotProvSlot = await this.cache.acquireConcurrencySlot(
          `prov-conc:${cand.provider.id}`,
          cand.provider.max_concurrency,
          90,
        );
        if (!gotProvSlot) {
          lastFailureReason = `${cand.provider.name} reached maximum concurrency`;
          continue;
        }

        try {
          const chatRes = await this.providersService.executeChat({
            providerId: cand.provider.id,
            providerCode: cand.provider.code,
            enforceFreeOnly: cand.provider.enforceFreeOnly,
            adapterType: cand.provider.adapter_type,
            baseUrl: cand.provider.base_url,
            apiKey: cand.decryptedKey,
            modelKey: cand.model.model_key,
            messages: params.messages,
            maxOutputTokens: maxOut,
            temperature: params.temperature,
            timeoutMs: cand.provider.timeout_ms,
            maxRetries: cand.provider.max_retries,
            // Only stream directly on first attempt or before tokens emitted
            onTokenDelta: params.onTokenDelta,
          });

          // 6. Settle actual usage credits & release unused reserved credits
          const execPricing = await this.costService.getModelPricing(cand.model.id);
          const { creditsToCharge, providerCostUsd } = this.costService.calculateActualUsageCost(
            execPricing,
            {
              inputTokens: chatRes.inputTokens,
              outputTokens: chatRes.outputTokens,
            },
          );

          const settlement = await this.walletService.settleReservation(
            reservation.id,
            creditsToCharge,
          );

          // 7. Record provider billing cost & usage analytics
          await this.costService.recordUsageAndCheckAlerts({
            userId: params.userId,
            conversationId: params.conversationId,
            providerId: cand.provider.id,
            modelId: cand.model.id,
            reservationId: reservation.id,
            taskType: params.taskType,
            inputTokens: chatRes.inputTokens,
            outputTokens: chatRes.outputTokens,
            providerCostUsd,
            creditsCharged: settlement.settledCredits,
            realizedRevenueUsd: settlement.realizedRevenueUsd,
          });

          await this.logAiRequest({
            userId: params.userId,
            providerId: cand.provider.id,
            requestedModelId: requestedModel.id,
            executedModelId: cand.model.id,
            taskType: params.taskType,
            status: isFallback ? 'FALLBACK_SUCCESS' : 'SUCCESS',
            httpStatus: 200,
            fallbackUsed: isFallback,
            fallbackReason: fallbackReason || undefined,
            retryCount: chatRes.retryCount,
            latencyMs: chatRes.latencyMs,
            ipAddress: params.ipAddress,
          });

          // Explicitly notify user when a fallback model answered (NEVER silent!)
          let fallbackNotice: {
            requestedModel: string;
            executedModel: string;
            reason: string;
          } | null = null;

          if (isFallback) {
            fallbackNotice = {
              requestedModel: requestedModel.display_name,
              executedModel: cand.model.display_name,
              reason: fallbackReason!,
            };
            await this.db.query(
              `INSERT INTO notifications (user_id, type, title, body, metadata)
               VALUES ($1, 'FALLBACK_ALERT', 'Fallback AI Model Used', $2, $3)`,
              [
                params.userId,
                `Your request for ${requestedModel.display_name} was routed to ${cand.model.display_name} (${fallbackReason}).`,
                JSON.stringify(fallbackNotice),
              ],
            );
          }

          return {
            content: chatRes.content,
            requestedModel: {
              id: requestedModel.id,
              displayName: requestedModel.display_name,
              modelKey: requestedModel.model_key,
            },
            executedModel: {
              id: cand.model.id,
              displayName: cand.model.display_name,
              modelKey: cand.model.model_key,
              providerName: cand.provider.name,
            },
            fallbackUsed: isFallback,
            fallbackNotice,
            usage: {
              inputTokens: chatRes.inputTokens,
              outputTokens: chatRes.outputTokens,
              reservedCredits: reservation.totalReserved,
              creditsCharged: settlement.settledCredits,
              unusedCreditsReleased: settlement.releasedCredits,
              latencyMs: chatRes.latencyMs,
            },
            reservationId: reservation.id,
          };
        } catch (err: any) {
          lastFailureReason = `${cand.model.display_name} failed (${err?.message || 'upstream error'})`;
          await this.logAiRequest({
            userId: params.userId,
            providerId: cand.provider.id,
            requestedModelId: requestedModel.id,
            executedModelId: cand.model.id,
            taskType: params.taskType,
            status: err?.status === 504 ? 'TIMEOUT' : 'FAILED',
            httpStatus: err?.upstreamStatus || err?.status || 502,
            fallbackUsed: isFallback,
            fallbackReason: fallbackReason || undefined,
            retryCount: err?.retryCount || 0,
            latencyMs: 0,
            errorCode: 'UPSTREAM_ERROR',
            errorMessage: lastFailureReason,
            ipAddress: params.ipAddress,
          });

          if (!allowFallback) {
            break;
          }
        } finally {
          await this.cache.releaseConcurrencySlot(`prov-conc:${cand.provider.id}`);
        }
      }

      // All candidates failed -> Atomically refund 100% of reserved credits!
      await this.walletService.refundReservation(reservation.id, lastFailureReason || 'All providers failed');
      throw new HttpException(
        {
          code: 'AI_EXECUTION_FAILED_CREDITS_REFUNDED',
          message: `AI request could not be completed (${lastFailureReason}). All reserved credits (${reservation.totalReserved}) have been refunded to your wallet.`,
        },
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      await this.cache.releaseConcurrencySlot(`user-conc:${params.userId}`);
    }
  }

  private async resolveCandidateModel(
    requestedModelId: string | undefined,
    taskType: string,
    requiresVision: boolean,
  ): Promise<any> {
    const freeAiOnly = await this.isFreeAiOnlyMode();
    if (requestedModelId) {
      const mRes = await this.db.query(
        `SELECT m.*,
                pr.provider_input_cost_per_1k_usd, pr.provider_output_cost_per_1k_usd,
                pr.provider_image_cost_usd, pr.provider_video_per_sec_cost_usd
         FROM ai_models m
         LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
         WHERE m.id = $1 AND m.is_enabled = TRUE`,
        [requestedModelId],
      );
      if (mRes.rowCount === 0) {
        throw new NotFoundException('Selected AI model is not available or disabled');
      }
      if (requiresVision && !mRes.rows[0].supports_vision) {
        throw new BadRequestException(
          `${mRes.rows[0].display_name} does not support image/vision inputs`,
        );
      }
      return mRes.rows[0];
    }

    // Task-aware intelligent default selection preferring configured, healthy, $0-cost-compliant providers
    const preferredCategory =
      taskType === 'CODING'
        ? 'CODING'
        : taskType === 'IMAGE'
          ? 'IMAGE'
          : taskType === 'VIDEO'
            ? 'VIDEO'
            : 'CHAT';

    const autoRes = await this.db.query(
      `SELECT m.*, p.api_key_encrypted, p.requires_api_key, p.is_enabled AS prov_enabled, p.priority,
              pr.provider_input_cost_per_1k_usd, pr.provider_output_cost_per_1k_usd
       FROM ai_models m
       JOIN ai_providers p ON p.id = m.provider_id
       LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
       WHERE m.is_enabled = TRUE
         AND ($1::boolean = FALSE OR m.supports_vision = TRUE)
         AND (m.category = $2 OR ($2 NOT IN ('IMAGE', 'VIDEO') AND m.category IN ('CHAT', 'REASONING', 'CODING')))
         AND (
           $3::boolean = FALSE OR (
             COALESCE(pr.provider_input_cost_per_1k_usd, 0) = 0
             AND COALESCE(pr.provider_output_cost_per_1k_usd, 0) = 0
             AND COALESCE(pr.provider_image_cost_usd, 0) = 0
             AND COALESCE(pr.provider_video_per_sec_cost_usd, 0) = 0
           )
         )
       ORDER BY
         (CASE WHEN (p.requires_api_key = FALSE OR p.api_key_encrypted IS NOT NULL) AND p.is_enabled = TRUE AND m.is_budget_paused = FALSE THEN 0 ELSE 1 END) ASC,
         (CASE WHEN m.category = $2 THEN 0 ELSE 1 END) ASC,
         p.priority ASC
       LIMIT 1`,
      [requiresVision, preferredCategory, freeAiOnly],
    );

    if (autoRes.rowCount === 0) {
      throw new NotFoundException(`No enabled AI model found for task ${taskType}`);
    }
    return autoRes.rows[0];
  }

  private async buildCandidateChain(
    requestedModel: any,
    requiresVision: boolean,
    allowFallback: boolean,
  ): Promise<Array<{ model: any; provider: any; decryptedKey: string; preFallbackReason?: string }>> {
    const freeAiOnly = await this.isFreeAiOnlyMode();
    const allRes = await this.db.query(
      `SELECT m.*,
              p.id AS prov_id, p.code AS prov_code, p.name AS prov_name,
              p.adapter_type, p.base_url, p.api_key_encrypted, p.requires_api_key, p.is_free_provider,
              p.is_enabled AS prov_enabled, p.health_status,
              p.timeout_ms, p.max_retries, p.max_concurrency, p.priority,
              pr.provider_input_cost_per_1k_usd, pr.provider_output_cost_per_1k_usd
       FROM ai_models m
       JOIN ai_providers p ON p.id = m.provider_id
       LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
       WHERE m.is_enabled = TRUE
         AND m.category IN ('CHAT', 'REASONING', 'CODING')
         AND ($1::boolean = FALSE OR m.supports_vision = TRUE)
       ORDER BY p.priority ASC`,
      [requiresVision],
    );

    const byId = new Map<string, any>();
    for (const row of allRes.rows) {
      byId.set(row.id, row);
    }

    const orderedRows: any[] = [];
    const primaryRow = byId.get(requestedModel.id);
    if (primaryRow) orderedRows.push(primaryRow);

    if (allowFallback) {
      if (requestedModel.fallback_model_id && byId.has(requestedModel.fallback_model_id)) {
        orderedRows.push(byId.get(requestedModel.fallback_model_id));
      }
      for (const row of allRes.rows) {
        if (!orderedRows.some((x) => x.id === row.id)) {
          orderedRows.push(row);
        }
      }
    }

    const valid: Array<{ model: any; provider: any; decryptedKey: string; preFallbackReason?: string }> = [];
    let primarySkipReason: string | undefined;

    for (const r of orderedRows) {
      const enforceFreeOnly = freeAiOnly || Boolean(r.is_free_provider);
      const isZeroCost =
        Number(r.provider_input_cost_per_1k_usd || 0) === 0 &&
        Number(r.provider_output_cost_per_1k_usd || 0) === 0;
      const isOpenRouterNonFree =
        r.prov_code === 'openrouter_oss' &&
        enforceFreeOnly &&
        r.model_key !== 'openrouter/free' &&
        !String(r.model_key).endsWith(':free');

      if (isOpenRouterNonFree || (freeAiOnly && !isZeroCost)) {
        if (r.id === requestedModel.id) {
          primarySkipReason = isOpenRouterNonFree
            ? `${r.display_name} blocked: OpenRouter key allows ONLY :free models`
            : `${r.display_name} is a paid model and Free-AI-Only Launch Mode is active`;
        }
        continue;
      }

      const requiresKey = r.requires_api_key !== false;
      const key = this.providersService.decryptProviderKey(r.api_key_encrypted) || '';
      if (!r.prov_enabled || (requiresKey && !key)) {
        if (r.id === requestedModel.id) {
          primarySkipReason = !r.prov_enabled
            ? `${r.prov_name} is disabled`
            : `${r.prov_name} API key is not configured`;
        }
        continue;
      }

      const budget = await this.costService.checkProviderBudgetAllowed(r.prov_id, r.is_expensive);
      if (!budget.allowed) {
        if (r.id === requestedModel.id) {
          primarySkipReason = budget.reason;
        }
        continue;
      }

      valid.push({
        model: r,
        provider: {
          id: r.prov_id,
          code: r.prov_code,
          name: r.prov_name,
          adapter_type: r.adapter_type,
          base_url: r.base_url,
          timeout_ms: r.timeout_ms,
          max_retries: r.max_retries,
          max_concurrency: r.max_concurrency,
          enforceFreeOnly,
        },
        decryptedKey: key,
        preFallbackReason: primarySkipReason,
      });
    }

    return valid;
  }

  private async logAiRequest(entry: {
    userId: string;
    providerId?: string;
    requestedModelId?: string;
    executedModelId?: string;
    taskType: string;
    status: string;
    httpStatus?: number;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    retryCount?: number;
    latencyMs: number;
    errorCode?: string;
    errorMessage?: string;
    ipAddress?: string;
  }) {
    await this.db.query(
      `INSERT INTO ai_request_logs (
         user_id, provider_id, requested_model_id, executed_model_id,
         task_type, http_status, status, fallback_used, fallback_reason,
         retry_count, latency_ms, error_code, error_message, ip_address
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        entry.userId,
        entry.providerId || null,
        entry.requestedModelId || null,
        entry.executedModelId || null,
        entry.taskType,
        entry.httpStatus || null,
        entry.status,
        Boolean(entry.fallbackUsed),
        entry.fallbackReason || null,
        entry.retryCount || 0,
        entry.latencyMs,
        entry.errorCode || null,
        entry.errorMessage || null,
        entry.ipAddress || null,
      ],
    );
  }
}
