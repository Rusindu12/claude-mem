import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';
import { CacheService } from '../../cache/cache.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { CostManagementService } from '../cost-management/cost-management.service';
import { PaymentsModule, PaymentsAndSubscriptionsService } from '../payments/payments.module';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  AuthenticatedUser,
  CurrentUser,
  RequireOwnerStepUp,
  Roles,
  SystemRole,
} from '../../common/auth.decorators';
import { RolesGuard } from '../../common/guards';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(CacheService) private readonly cache: CacheService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(CostManagementService) private readonly costService: CostManagementService,
    @Inject(PaymentsAndSubscriptionsService)
    private readonly paymentsService: PaymentsAndSubscriptionsService,
  ) {}

  private async logAudit(params: {
    actor: AuthenticatedUser;
    action: string;
    targetType: string;
    targetId?: string;
    beforeState?: any;
    afterState?: any;
    stepUpVerified?: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    await this.db.query(
      `INSERT INTO admin_audit_logs (
         actor_user_id, actor_role, action, target_type, target_id,
         before_state, after_state, step_up_verified, ip_address, user_agent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.actor.id,
        params.actor.role,
        params.action,
        params.targetType,
        params.targetId || null,
        params.beforeState ? JSON.stringify(params.beforeState) : null,
        params.afterState ? JSON.stringify(params.afterState) : null,
        Boolean(params.stepUpVerified),
        params.ip || null,
        params.userAgent || null,
      ],
    );
  }

  // ---- OWNER-ONLY: Role Management ----
  async assignUserRole(
    actor: AuthenticatedUser,
    targetUserId: string,
    newRole: SystemRole,
    stepUpVerified: boolean,
    ip?: string,
  ) {
    if (!['OWNER', 'ADMIN', 'SUPPORT', 'USER'].includes(newRole)) {
      throw new BadRequestException('Invalid role');
    }
    if (actor.id === targetUserId && newRole !== 'OWNER') {
      throw new ForbiddenException('Owner cannot demote their own active Owner account');
    }

    const roleRes = await this.db.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [
      newRole,
    ]);
    if (roleRes.rowCount === 0) throw new NotFoundException('Role not found');

    const prev = await this.db.query<{ role_name: string }>(
      'SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1',
      [targetUserId],
    );
    if (prev.rowCount === 0) throw new NotFoundException('Target user not found');

    await this.db.query('UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2', [
      roleRes.rows[0].id,
      targetUserId,
    ]);

    await this.logAudit({
      actor,
      action: 'ASSIGN_ROLE',
      targetType: 'USER',
      targetId: targetUserId,
      beforeState: { role: prev.rows[0].role_name },
      afterState: { role: newRole },
      stepUpVerified,
      ip,
    });

    return { userId: targetUserId, previousRole: prev.rows[0].role_name, newRole };
  }

  // ---- OWNER-ONLY: Encrypted Provider Credentials & Budgets ----
  async updateProviderCredentials(
    actor: AuthenticatedUser,
    providerId: string,
    dto: {
      apiKey?: string;
      baseUrl?: string;
      isEnabled?: boolean;
      timeoutMs?: number;
      maxRetries?: number;
      maxConcurrency?: number;
    },
    stepUpVerified: boolean,
    ip?: string,
  ) {
    const pRes = await this.db.query('SELECT * FROM ai_providers WHERE id = $1', [providerId]);
    if (pRes.rowCount === 0) throw new NotFoundException('AI provider not found');
    const prev = pRes.rows[0];

    let encryptedKey = prev.api_key_encrypted;
    let healthStatus = prev.health_status;
    let maskedPreview: string | null = null;

    if (dto.apiKey !== undefined) {
      if (dto.apiKey.trim() === '') {
        encryptedKey = null;
        healthStatus = 'UNCONFIGURED';
      } else {
        encryptedKey = this.crypto.encrypt(dto.apiKey.trim());
        maskedPreview = this.crypto.maskSecret(dto.apiKey.trim());
        if (healthStatus === 'UNCONFIGURED') {
          healthStatus = 'HEALTHY';
        }
      }
    }

    await this.db.query(
      `UPDATE ai_providers
       SET api_key_encrypted = $1,
           base_url = COALESCE($2, base_url),
           is_enabled = COALESCE($3, is_enabled),
           timeout_ms = COALESCE($4, timeout_ms),
           max_retries = COALESCE($5, max_retries),
           max_concurrency = COALESCE($6, max_concurrency),
           health_status = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [
        encryptedKey,
        dto.baseUrl?.trim() || null,
        dto.isEnabled ?? null,
        dto.timeoutMs ?? null,
        dto.maxRetries ?? null,
        dto.maxConcurrency ?? null,
        healthStatus,
        providerId,
      ],
    );

    await this.logAudit({
      actor,
      action: 'UPDATE_PROVIDER_CREDENTIALS',
      targetType: 'AI_PROVIDER',
      targetId: providerId,
      beforeState: {
        baseUrl: prev.base_url,
        isEnabled: prev.is_enabled,
        hadApiKey: Boolean(prev.api_key_encrypted),
      },
      afterState: {
        baseUrl: dto.baseUrl || prev.base_url,
        isEnabled: dto.isEnabled ?? prev.is_enabled,
        apiKeyMasked: maskedPreview || (encryptedKey ? 'UNCHANGED_ENCRYPTED' : 'CLEARED'),
      },
      stepUpVerified,
      ip,
    });

    return {
      updated: true,
      providerId,
      healthStatus,
      hasApiKeyConfigured: Boolean(encryptedKey),
      maskedApiKey: maskedPreview,
    };
  }

  async updateProviderBudget(
    actor: AuthenticatedUser,
    providerId: string,
    dto: {
      monthlyBudgetLimitUsd?: number;
      dailyBudgetLimitUsd?: number;
      alertThresholdPercent?: number;
      autoDisableExpensiveOnLimit?: boolean;
      hardStopOnLimit?: boolean;
      resumeBudgetPausedModels?: boolean;
    },
    stepUpVerified: boolean,
    ip?: string,
  ) {
    const res = await this.db.query(
      `UPDATE provider_billing_accounts
       SET monthly_budget_limit_usd = COALESCE($1, monthly_budget_limit_usd),
           daily_budget_limit_usd = COALESCE($2, daily_budget_limit_usd),
           alert_threshold_percent = COALESCE($3, alert_threshold_percent),
           auto_disable_expensive_on_limit = COALESCE($4, auto_disable_expensive_on_limit),
           hard_stop_on_limit = COALESCE($5, hard_stop_on_limit),
           updated_at = NOW()
       WHERE provider_id = $6
       RETURNING *`,
      [
        dto.monthlyBudgetLimitUsd ?? null,
        dto.dailyBudgetLimitUsd ?? null,
        dto.alertThresholdPercent ?? null,
        dto.autoDisableExpensiveOnLimit ?? null,
        dto.hardStopOnLimit ?? null,
        providerId,
      ],
    );
    if (res.rowCount === 0) throw new NotFoundException('Provider billing account not found');

    if (dto.resumeBudgetPausedModels) {
      await this.db.query(
        'UPDATE ai_models SET is_budget_paused = FALSE, updated_at = NOW() WHERE provider_id = $1',
        [providerId],
      );
      await this.db.query(
        "UPDATE ai_providers SET health_status = CASE WHEN api_key_encrypted IS NOT NULL THEN 'HEALTHY' ELSE 'UNCONFIGURED' END WHERE id = $1",
        [providerId],
      );
    }

    await this.logAudit({
      actor,
      action: 'UPDATE_PROVIDER_BUDGET',
      targetType: 'PROVIDER_BILLING_ACCOUNT',
      targetId: providerId,
      afterState: dto,
      stepUpVerified,
      ip,
    });

    return res.rows[0];
  }

  async reconcileProvider(actor: AuthenticatedUser, providerId: string, reportedUsd: number, ip?: string) {
    const rec = await this.costService.reconcileProviderBilling(providerId, Number(reportedUsd));
    await this.logAudit({
      actor,
      action: 'RECONCILE_PROVIDER_BILLING',
      targetType: 'PROVIDER_BILLING_ACCOUNT',
      targetId: providerId,
      afterState: rec,
      ip,
    });
    return rec;
  }

  // ---- OWNER-ONLY: Platform Availability & System Settings ----
  async updateSystemSetting(
    actor: AuthenticatedUser,
    settingKey: string,
    settingValue: any,
    stepUpVerified: boolean,
    ip?: string,
  ) {
    const res = await this.db.query(
      `UPDATE system_settings
       SET setting_value = $1, updated_by = $2, updated_at = NOW()
       WHERE setting_key = $3
       RETURNING *`,
      [JSON.stringify(settingValue), actor.id, settingKey],
    );
    if (res.rowCount === 0) {
      await this.db.query(
        `INSERT INTO system_settings (setting_key, setting_value, category, description, updated_by)
         VALUES ($1, $2, 'CUSTOM', 'Owner configured setting', $3)`,
        [settingKey, JSON.stringify(settingValue), actor.id],
      );
    }
    if (settingKey === 'platform.maintenance_mode') {
      await this.cache.del('sys:maintenance');
    }

    await this.logAudit({
      actor,
      action: 'UPDATE_SYSTEM_SETTING',
      targetType: 'SYSTEM_SETTING',
      targetId: settingKey,
      afterState: settingValue,
      stepUpVerified,
      ip,
    });

    return { settingKey, settingValue };
  }

  // ---- ADMIN + OWNER: Providers, Models & Pricing ----
  async listProvidersAndModelsForAdmin() {
    const [provs, models, settings] = await Promise.all([
      this.db.query(
        `SELECT p.*, b.monthly_budget_limit_usd, b.daily_budget_limit_usd,
                b.current_month_spend_usd, b.current_day_spend_usd,
                b.alert_threshold_percent, b.auto_disable_expensive_on_limit,
                b.hard_stop_on_limit, b.reconciliation_drift_usd
         FROM ai_providers p
         LEFT JOIN provider_billing_accounts b ON b.provider_id = p.id
         ORDER BY p.priority ASC`,
      ),
      this.db.query(
        `SELECT m.*, p.name AS provider_name,
                pr.provider_input_cost_per_1k_usd, pr.provider_output_cost_per_1k_usd,
                pr.credit_cost_per_1k_input, pr.credit_cost_per_1k_output,
                pr.credit_cost_per_image, pr.credit_cost_per_video_sec, pr.minimum_credit_charge
         FROM ai_models m
         JOIN ai_providers p ON p.id = m.provider_id
         LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
         ORDER BY p.priority ASC, m.display_name ASC`,
      ),
      this.db.query('SELECT setting_key, setting_value, category, description, updated_at FROM system_settings'),
    ]);

    return {
      providers: provs.rows.map((p) => {
        let maskedKey: string | null = null;
        if (p.api_key_encrypted) {
          try {
            maskedKey = this.crypto.maskSecret(this.crypto.decrypt(p.api_key_encrypted));
          } catch {
            maskedKey = '••••••••';
          }
        }
        const requiresKey = p.requires_api_key !== false;
        const { api_key_encrypted, extra_headers_encrypted, ...safe } = p;
        return {
          ...safe,
          requiresApiKey: requiresKey,
          isFreeProvider: Boolean(p.is_free_provider),
          hasApiKeyConfigured: !requiresKey || Boolean(api_key_encrypted),
          maskedApiKey: !requiresKey && !maskedKey ? 'ZERO-KEY FREE AI' : maskedKey,
          monthly_budget_limit_usd: Number(p.monthly_budget_limit_usd || 0),
          daily_budget_limit_usd: Number(p.daily_budget_limit_usd || 0),
          current_month_spend_usd: Number(p.current_month_spend_usd || 0),
          current_day_spend_usd: Number(p.current_day_spend_usd || 0),
        };
      }),
      models: models.rows,
      systemSettings: settings.rows,
    };
  }

  async updateModelAndPricing(
    actor: AuthenticatedUser,
    modelId: string,
    dto: {
      isEnabled?: boolean;
      tier?: string;
      fallbackModelId?: string | null;
      creditCostPer1kInput?: number;
      creditCostPer1kOutput?: number;
      creditCostPerImage?: number;
      creditCostPerVideoSec?: number;
      minimumCreditCharge?: number;
      providerInputCostPer1kUsd?: number;
      providerOutputCostPer1kUsd?: number;
    },
    ip?: string,
  ) {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE ai_models
         SET is_enabled = COALESCE($1, is_enabled),
             tier = COALESCE($2, tier),
             fallback_model_id = COALESCE($3, fallback_model_id),
             updated_at = NOW()
         WHERE id = $4`,
        [dto.isEnabled ?? null, dto.tier || null, dto.fallbackModelId ?? null, modelId],
      );

      if (
        dto.creditCostPer1kInput !== undefined ||
        dto.creditCostPer1kOutput !== undefined ||
        dto.creditCostPerImage !== undefined ||
        dto.creditCostPerVideoSec !== undefined ||
        dto.minimumCreditCharge !== undefined
      ) {
        await tx.query(
          `UPDATE ai_model_prices
           SET credit_cost_per_1k_input = COALESCE($1, credit_cost_per_1k_input),
               credit_cost_per_1k_output = COALESCE($2, credit_cost_per_1k_output),
               credit_cost_per_image = COALESCE($3, credit_cost_per_image),
               credit_cost_per_video_sec = COALESCE($4, credit_cost_per_video_sec),
               minimum_credit_charge = COALESCE($5, minimum_credit_charge),
               provider_input_cost_per_1k_usd = COALESCE($6, provider_input_cost_per_1k_usd),
               provider_output_cost_per_1k_usd = COALESCE($7, provider_output_cost_per_1k_usd)
           WHERE model_id = $8 AND is_current = TRUE`,
          [
            dto.creditCostPer1kInput ?? null,
            dto.creditCostPer1kOutput ?? null,
            dto.creditCostPerImage ?? null,
            dto.creditCostPerVideoSec ?? null,
            dto.minimumCreditCharge ?? null,
            dto.providerInputCostPer1kUsd ?? null,
            dto.providerOutputCostPer1kUsd ?? null,
            modelId,
          ],
        );
      }
    });

    await this.logAudit({
      actor,
      action: 'UPDATE_MODEL_AND_PRICING',
      targetType: 'AI_MODEL',
      targetId: modelId,
      afterState: dto,
      ip,
    });
    return { updated: true, modelId };
  }

  async updateCreditPackage(actor: AuthenticatedUser, packageId: string, dto: any, ip?: string) {
    const res = await this.db.query(
      `UPDATE credit_packages
       SET name = COALESCE($1, name),
           credits = COALESCE($2, credits),
           bonus_credits = COALESCE($3, bonus_credits),
           price_usd = COALESCE($4, price_usd),
           price_lkr = COALESCE($5, price_lkr),
           discount_percent = COALESCE($6, discount_percent),
           is_active = COALESCE($7, is_active),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        dto.name || null,
        dto.credits ?? null,
        dto.bonusCredits ?? null,
        dto.priceUsd ?? null,
        dto.priceLkr ?? null,
        dto.discountPercent ?? null,
        dto.isActive ?? null,
        packageId,
      ],
    );
    if (res.rowCount === 0) throw new NotFoundException('Credit package not found');
    await this.logAudit({
      actor,
      action: 'UPDATE_CREDIT_PACKAGE',
      targetType: 'CREDIT_PACKAGE',
      targetId: packageId,
      afterState: dto,
      ip,
    });
    return res.rows[0];
  }

  async updateSubscriptionPlan(actor: AuthenticatedUser, planId: string, dto: any, ip?: string) {
    const res = await this.db.query(
      `UPDATE subscription_plans
       SET name = COALESCE($1, name),
           price_usd = COALESCE($2, price_usd),
           price_lkr = COALESCE($3, price_lkr),
           included_bonus_credits = COALESCE($4, included_bonus_credits),
           daily_free_credits = COALESCE($5, daily_free_credits),
           discount_percent = COALESCE($6, discount_percent),
           rate_limit_rpm = COALESCE($7, rate_limit_rpm),
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        dto.name || null,
        dto.priceUsd ?? null,
        dto.priceLkr ?? null,
        dto.includedBonusCredits ?? null,
        dto.dailyFreeCredits ?? null,
        dto.discountPercent ?? null,
        dto.rateLimitRpm ?? null,
        dto.isActive ?? null,
        planId,
      ],
    );
    if (res.rowCount === 0) throw new NotFoundException('Subscription plan not found');
    await this.logAudit({
      actor,
      action: 'UPDATE_SUBSCRIPTION_PLAN',
      targetType: 'SUBSCRIPTION_PLAN',
      targetId: planId,
      afterState: dto,
      ip,
    });
    return res.rows[0];
  }

  async updateDailyFreeCredits(
    actor: AuthenticatedUser,
    planCode: string,
    dto: { dailyFreeCredits?: number; maxClaimsPerIpPerDay?: number; isEnabled?: boolean },
    ip?: string,
  ) {
    const res = await this.db.query(
      `UPDATE daily_credit_settings
       SET daily_free_credits = COALESCE($1, daily_free_credits),
           max_claims_per_ip_per_day = COALESCE($2, max_claims_per_ip_per_day),
           is_enabled = COALESCE($3, is_enabled),
           updated_by = $4,
           updated_at = NOW()
       WHERE plan_code = $5
       RETURNING *`,
      [
        dto.dailyFreeCredits ?? null,
        dto.maxClaimsPerIpPerDay ?? null,
        dto.isEnabled ?? null,
        actor.id,
        planCode.toUpperCase(),
      ],
    );
    if (res.rowCount === 0) throw new NotFoundException('Daily credit setting not found');
    await this.logAudit({
      actor,
      action: 'UPDATE_DAILY_FREE_CREDITS',
      targetType: 'DAILY_CREDIT_SETTING',
      targetId: planCode,
      afterState: dto,
      ip,
    });
    return res.rows[0];
  }

  async listUsers(search?: string, limit = 50) {
    const pattern = search ? `%${search.trim()}%` : null;
    const res = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.country_code, u.is_active, u.is_suspended,
              u.last_login_at, u.created_at, r.name AS role_name,
              w.free_credits, w.purchased_credits, w.bonus_credits
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE ($1::varchar IS NULL OR u.email ILIKE $1 OR u.full_name ILIKE $1)
       ORDER BY u.created_at DESC
       LIMIT $2`,
      [pattern, Math.min(200, limit)],
    );
    return res.rows.map((u) => ({
      ...u,
      free_credits: Number(u.free_credits || 0),
      purchased_credits: Number(u.purchased_credits || 0),
      bonus_credits: Number(u.bonus_credits || 0),
    }));
  }

  async setUserSuspension(
    actor: AuthenticatedUser,
    targetUserId: string,
    suspended: boolean,
    reason?: string,
    ip?: string,
  ) {
    const targetRes = await this.db.query<{ role_name: string }>(
      'SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1',
      [targetUserId],
    );
    if (targetRes.rowCount === 0) throw new NotFoundException('User not found');
    if (targetRes.rows[0].role_name === 'OWNER') {
      throw new ForbiddenException('Platform Owner account cannot be suspended');
    }

    await this.db.withTransaction(async (tx) => {
      await tx.query(
        'UPDATE users SET is_suspended = $1, suspension_reason = $2, updated_at = NOW() WHERE id = $3',
        [suspended, reason || null, targetUserId],
      );
      if (suspended) {
        await tx.query(
          "UPDATE sessions SET is_revoked = TRUE, revoked_reason = 'ADMIN_SUSPENDED' WHERE user_id = $1",
          [targetUserId],
        );
      }
    });

    await this.logAudit({
      actor,
      action: suspended ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
      targetType: 'USER',
      targetId: targetUserId,
      afterState: { suspended, reason },
      ip,
    });

    return { userId: targetUserId, suspended };
  }

  async grantBonusCreditsToUser(
    actor: AuthenticatedUser,
    targetUserId: string,
    amount: number,
    reason: string,
    ip?: string,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('Bonus credit grant amount must be > 0');
    }
    const txId = await this.db.withTransaction(async (tx) => {
      return this.wallet.grantBonusCreditsTx(tx, {
        userId: targetUserId,
        bonusCredits: amount,
        txType: 'ADMIN_GRANT',
        referenceType: 'ADMIN_REWARD',
        referenceId: actor.id,
        idempotencyKey: `admin-grant:${actor.id}:${targetUserId}:${Date.now()}`,
        description: reason || 'Admin reward bonus credits',
      });
    });

    await this.logAudit({
      actor,
      action: 'GRANT_BONUS_CREDITS',
      targetType: 'WALLET',
      targetId: targetUserId,
      afterState: { amount, reason, walletTxId: txId },
      ip,
    });

    return { granted: true, userId: targetUserId, bonusCredits: amount, walletTxId: txId };
  }

  async createAnnouncement(actor: AuthenticatedUser, dto: any, ip?: string) {
    const res = await this.db.query(
      `INSERT INTO announcements (title, body, title_si, body_si, severity, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       RETURNING *`,
      [
        dto.title,
        dto.body,
        dto.titleSi || null,
        dto.bodySi || null,
        dto.severity || 'INFO',
        actor.id,
      ],
    );
    await this.logAudit({
      actor,
      action: 'CREATE_ANNOUNCEMENT',
      targetType: 'ANNOUNCEMENT',
      targetId: res.rows[0].id,
      afterState: dto,
      ip,
    });
    return res.rows[0];
  }

  async createPromoCode(actor: AuthenticatedUser, dto: any, ip?: string) {
    const res = await this.db.query(
      `INSERT INTO promo_codes (
         code, description, reward_type, bonus_credits, discount_percent,
         max_redemptions, per_user_limit, expires_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        String(dto.code || '').trim().toUpperCase(),
        dto.description || 'Promotional Offer',
        dto.rewardType || 'BONUS_CREDITS',
        dto.bonusCredits || 0,
        dto.discountPercent || 0,
        dto.maxRedemptions || null,
        dto.perUserLimit || 1,
        dto.expiresAt || null,
        actor.id,
      ],
    );
    await this.logAudit({
      actor,
      action: 'CREATE_PROMO_CODE',
      targetType: 'PROMO_CODE',
      targetId: res.rows[0].id,
      afterState: dto,
      ip,
    });
    return res.rows[0];
  }

  async getAuditLogs(limit = 100) {
    const res = await this.db.query(
      `SELECT a.*, u.email AS actor_email
       FROM admin_audit_logs a
       JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [Math.min(300, limit)],
    );
    return res.rows;
  }

  async getRequestLogs(limit = 100) {
    const res = await this.db.query(
      `SELECT l.id, l.user_id, l.task_type, l.http_status, l.status,
              l.fallback_used, l.fallback_reason, l.retry_count, l.latency_ms,
              l.error_code, l.error_message, l.created_at,
              p.name AS provider_name,
              rm.display_name AS requested_model_name,
              em.display_name AS executed_model_name
       FROM ai_request_logs l
       LEFT JOIN ai_providers p ON p.id = l.provider_id
       LEFT JOIN ai_models rm ON rm.id = l.requested_model_id
       LEFT JOIN ai_models em ON em.id = l.executed_model_id
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [Math.min(300, limit)],
    );
    return res.rows;
  }

  async refundOrder(actor: AuthenticatedUser, paymentId: string, reason: string) {
    return this.paymentsService.processRefund(paymentId, reason || 'Admin refund', actor.id, actor.role);
  }
}

@ApiTags('Owner & Admin Governance Dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly adminService: AdminService,
    @Inject(AnalyticsService) private readonly analyticsService: AnalyticsService,
  ) {}

  @Get('analytics')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary:
      'Get SaaS revenue, GAAP deferred credit obligations, AI API costs, gateway fees, hosting costs, and net profit',
  })
  async getAnalytics() {
    return this.analyticsService.getBusinessAnalytics();
  }

  @Get('providers')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'List AI providers (masked credentials), budgets, models & system settings' })
  async getProviders() {
    return this.adminService.listProvidersAndModelsForAdmin();
  }

  @Patch('providers/:id/credentials')
  @Roles('OWNER')
  @RequireOwnerStepUp()
  @ApiHeader({ name: 'X-Confirm-Password', required: true })
  @ApiOperation({ summary: 'OWNER ONLY: Update encrypted AI provider API credentials (requires step-up password)' })
  async updateCredentials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateProviderCredentials(
      user,
      id,
      body || {},
      Boolean(req.stepUpVerified),
      req.ip,
    );
  }

  @Patch('providers/:id/budget')
  @Roles('OWNER')
  @RequireOwnerStepUp()
  @ApiHeader({ name: 'X-Confirm-Password', required: true })
  @ApiOperation({ summary: 'OWNER ONLY: Configure AI provider daily/monthly USD spending caps & auto-disable' })
  async updateBudget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateProviderBudget(
      user,
      id,
      body || {},
      Boolean(req.stepUpVerified),
      req.ip,
    );
  }

  @Post('providers/:id/reconcile')
  @Roles('OWNER')
  @ApiOperation({ summary: 'OWNER ONLY: Reconcile internal token/media costs against provider invoice report' })
  async reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { providerReportedMonthUsd: number },
    @Req() req: any,
  ) {
    return this.adminService.reconcileProvider(user, id, body?.providerReportedMonthUsd || 0, req.ip);
  }

  @Post('roles/assign')
  @Roles('OWNER')
  @RequireOwnerStepUp()
  @ApiHeader({ name: 'X-Confirm-Password', required: true })
  @ApiOperation({ summary: 'OWNER ONLY: Promote or revoke Administrator / Support roles' })
  async assignRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { userId: string; role: SystemRole },
    @Req() req: any,
  ) {
    return this.adminService.assignUserRole(
      user,
      body?.userId,
      body?.role,
      Boolean(req.stepUpVerified),
      req.ip,
    );
  }

  @Patch('system/settings/:key')
  @Roles('OWNER')
  @RequireOwnerStepUp()
  @ApiHeader({ name: 'X-Confirm-Password', required: true })
  @ApiOperation({ summary: 'OWNER ONLY: Update platform availability, FX rates, or hosting expense settings' })
  async updateSystemSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: { value: any },
    @Req() req: any,
  ) {
    return this.adminService.updateSystemSetting(
      user,
      key,
      body?.value,
      Boolean(req.stepUpVerified),
      req.ip,
    );
  }

  @Patch('models/:id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Enable/disable AI model and configure token credit pricing' })
  async updateModel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateModelAndPricing(user, id, body || {}, req.ip);
  }

  @Patch('packages/:id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update credit package LKR/USD prices, credits & discounts' })
  async updatePackage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateCreditPackage(user, id, body || {}, req.ip);
  }

  @Patch('plans/:id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update subscription plan pricing, benefits & rate limits' })
  async updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateSubscriptionPlan(user, id, body || {}, req.ip);
  }

  @Patch('daily-credits/:planCode')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Configure Colombo daily free credit allowance for a subscription tier' })
  async updateDailyCredits(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planCode') planCode: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateDailyFreeCredits(user, planCode, body || {}, req.ip);
  }

  @Get('users')
  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Search and inspect platform users and wallet balances' })
  async listUsers(@Query('q') q?: string) {
    return this.adminService.listUsers(q);
  }

  @Patch('users/:id/status')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Suspend or reactivate a user account' })
  async setUserStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { suspended: boolean; reason?: string },
    @Req() req: any,
  ) {
    return this.adminService.setUserSuspension(user, id, Boolean(body?.suspended), body?.reason, req.ip);
  }

  @Post('users/:id/grant-credits')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Grant audited bonus credits to a user' })
  async grantCredits(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { amount: number; reason: string },
    @Req() req: any,
  ) {
    return this.adminService.grantBonusCreditsToUser(user, id, Number(body?.amount), body?.reason, req.ip);
  }

  @Post('payments/:id/refund')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Process verified payment refund with safe credit clawback' })
  async refundPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.adminService.refundOrder(user, id, body?.reason);
  }

  @Post('announcements')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Publish platform announcement (English & Sinhala)' })
  async createAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.createAnnouncement(user, body || {}, req.ip);
  }

  @Post('promos')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create promotional bonus-credit or checkout-discount code' })
  async createPromo(@CurrentUser() user: AuthenticatedUser, @Body() body: any, @Req() req: any) {
    return this.adminService.createPromoCode(user, body || {}, req.ip);
  }

  @Get('audit-logs')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'View immutable administrative audit logs' })
  async getAuditLogs() {
    return this.adminService.getAuditLogs();
  }

  @Get('request-logs')
  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  @ApiOperation({ summary: 'Inspect AI router request telemetry & failover history' })
  async getRequestLogs() {
    return this.adminService.getRequestLogs();
  }
}

@Module({
  imports: [WalletModule, PaymentsModule],
  providers: [AnalyticsService, AdminService],
  controllers: [AdminController],
  exports: [AnalyticsService, AdminService],
})
export class AdminModule {}
