import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { QueueService } from '../../queue/queue.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { CostManagementService } from '../cost-management/cost-management.service';
import { StorageModule, StorageService } from '../storage/storage.module';
import { ChatModule } from '../chat/chat.module';
import { NexoraRealtimeGateway } from '../chat/realtime.gateway';
import { AuthenticatedUser, CurrentUser } from '../../common/auth.decorators';

interface MediaJobPayload {
  jobId: string;
}

@Injectable()
export class MediaService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(AiProvidersService) private readonly providers: AiProvidersService,
    @Inject(CostManagementService) private readonly costService: CostManagementService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(NexoraRealtimeGateway) private readonly ws: NexoraRealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker<MediaJobPayload>(
      'nexora-media-jobs',
      async (payload, updateProgress) => {
        await this.processMediaJob(payload.jobId, updateProgress);
      },
      4,
    );
  }

  async isFreeAiOnlyMode(): Promise<boolean> {
    const res = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'platform.free_ai_only_mode'",
    );
    return res.rowCount > 0 && Boolean(res.rows[0].setting_value?.enabled);
  }

  /**
   * Only advertises generation capabilities supported by actually connected providers!
   */
  async getConnectedCapabilities() {
    const [freeAiOnly, models] = await Promise.all([
      this.isFreeAiOnlyMode(),
      this.db.query(
        `SELECT m.id, m.model_key, m.display_name, m.category, m.tier,
                p.code AS provider_code, p.name AS provider_name,
                p.api_key_encrypted, p.requires_api_key, p.is_enabled AS prov_enabled,
                p.supports_image_gen, p.supports_video_gen, p.health_status,
                pr.provider_image_cost_usd, pr.provider_video_per_sec_cost_usd,
                pr.credit_cost_per_image, pr.credit_cost_per_video_sec, pr.minimum_credit_charge
         FROM ai_models m
         JOIN ai_providers p ON p.id = m.provider_id
         LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
         WHERE m.is_enabled = TRUE AND m.category IN ('IMAGE', 'VIDEO')
         ORDER BY p.priority ASC`,
      ),
    ]);

    const imageModels: any[] = [];
    const videoModels: any[] = [];

    for (const r of models.rows) {
      const requiresKey = r.requires_api_key !== false;
      const hasKey = !requiresKey || Boolean(this.providers.decryptProviderKey(r.api_key_encrypted));
      const isZeroCost =
        Number(r.provider_image_cost_usd || 0) === 0 &&
        Number(r.provider_video_per_sec_cost_usd || 0) === 0;
      const connected =
        r.prov_enabled &&
        hasKey &&
        r.health_status !== 'BUDGET_EXCEEDED' &&
        (!freeAiOnly || isZeroCost);
      if (!connected) continue;

      if (r.category === 'IMAGE' && r.supports_image_gen) {
        imageModels.push({
          id: r.id,
          displayName: r.display_name,
          modelKey: r.model_key,
          providerName: r.provider_name,
          creditsPerImage: Number(r.credit_cost_per_image || 12),
          operations: ['TEXT_TO_IMAGE', 'IMAGE_VARIATION', 'IMAGE_EDIT'],
        });
      }
      if (r.category === 'VIDEO' && r.supports_video_gen) {
        videoModels.push({
          id: r.id,
          displayName: r.display_name,
          modelKey: r.model_key,
          providerName: r.provider_name,
          creditsPerSecond: Number(r.credit_cost_per_video_sec || 35),
          operations: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'],
        });
      }
    }

    return {
      imageGenerationAvailable: imageModels.length > 0,
      videoGenerationAvailable: videoModels.length > 0,
      connectedImageModels: imageModels,
      connectedVideoModels: videoModels,
      notice:
        imageModels.length === 0 && videoModels.length === 0
          ? 'Connect an OpenAI or Google Gemini/Veo API key in the Owner Dashboard to unlock live Image and Video generation.'
          : null,
    };
  }

  async submitMediaJob(
    userId: string,
    userRole: string,
    dto: {
      mediaType: 'IMAGE' | 'VIDEO';
      operation:
        | 'TEXT_TO_IMAGE'
        | 'IMAGE_VARIATION'
        | 'IMAGE_EDIT'
        | 'TEXT_TO_VIDEO'
        | 'IMAGE_TO_VIDEO';
      prompt: string;
      negativePrompt?: string;
      modelId?: string;
      sourceFileId?: string;
      count?: number;
      size?: string;
      durationSeconds?: number;
    },
  ) {
    if (!dto.prompt || dto.prompt.trim().length < 2) {
      throw new BadRequestException('Generation prompt is required');
    }

    // Check subscription entitlement for Video generation
    const planCode = await this.wallet.getUserPlanCode(userId);
    const planRes = await this.db.query<{ allows_image_gen: boolean; allows_video_gen: boolean }>(
      'SELECT allows_image_gen, allows_video_gen FROM subscription_plans WHERE code = $1',
      [planCode],
    );
    if (
      dto.mediaType === 'VIDEO' &&
      userRole !== 'OWNER' &&
      userRole !== 'ADMIN' &&
      planRes.rowCount > 0 &&
      !planRes.rows[0].allows_video_gen
    ) {
      const wSnap = await this.wallet.getWalletSummary(userId);
      if (wSnap.purchasedCredits <= 0) {
        throw new ForbiddenException(
          'AI Video generation requires a Premium/Business subscription or Purchased Credits',
        );
      }
    }

    // Find connected provider & model
    const freeAiOnly = await this.isFreeAiOnlyMode();
    const mRes = await this.db.query(
      `SELECT m.*, p.id AS prov_id, p.adapter_type, p.base_url, p.api_key_encrypted, p.requires_api_key,
              p.is_enabled AS prov_enabled, p.timeout_ms, p.supports_image_gen, p.supports_video_gen,
              pr.provider_image_cost_usd, pr.provider_video_per_sec_cost_usd
       FROM ai_models m
       JOIN ai_providers p ON p.id = m.provider_id
       LEFT JOIN ai_model_prices pr ON pr.model_id = m.id AND pr.is_current = TRUE
       WHERE m.is_enabled = TRUE
         AND m.category = $1
         AND ($2::uuid IS NULL OR m.id = $2)
       ORDER BY p.priority ASC`,
      [dto.mediaType, dto.modelId || null],
    );

    const connected = mRes.rows.find((r) => {
      const requiresKey = r.requires_api_key !== false;
      const hasKey = !requiresKey || Boolean(this.providers.decryptProviderKey(r.api_key_encrypted));
      const isZeroCost =
        Number(r.provider_image_cost_usd || 0) === 0 &&
        Number(r.provider_video_per_sec_cost_usd || 0) === 0;
      return (
        r.prov_enabled &&
        hasKey &&
        (!freeAiOnly || isZeroCost) &&
        (dto.mediaType === 'IMAGE' ? r.supports_image_gen : r.supports_video_gen)
      );
    });

    if (!connected) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROVIDER_NOT_CONNECTED',
        message: `No connected AI provider currently supports ${dto.mediaType} generation. Configure provider API credentials in the Owner Dashboard.`,
      });
    }

    const budgetCheck = await this.costService.checkProviderBudgetAllowed(
      connected.prov_id,
      connected.is_expensive,
    );
    if (!budgetCheck.allowed) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_BUDGET_PAUSED',
        message: budgetCheck.reason,
      });
    }

    const pricing = await this.costService.getModelPricing(connected.id);
    const count = Math.min(4, Math.max(1, dto.count || 1));
    const durationSeconds = Math.min(15, Math.max(4, dto.durationSeconds || 5));

    const estimatedCredits =
      dto.mediaType === 'IMAGE'
        ? Math.max(pricing.minimumCreditCharge, count * pricing.creditCostPerImage)
        : Math.max(pricing.minimumCreditCharge, durationSeconds * pricing.creditCostPerVideoSec);

    // Reserve credits upfront before enqueuing background job
    const reservation = await this.wallet.reserveCredits({
      userId,
      amount: estimatedCredits,
      taskType: `${dto.mediaType}_${dto.operation}`,
      modelId: connected.id,
      idempotencyKey: `media:${userId}:${crypto.randomUUID()}`,
      ttlSeconds: 900,
    });

    const jobIns = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO media_generation_jobs (
         user_id, provider_id, model_id, reservation_id,
         media_type, operation, prompt, negative_prompt, source_file_id,
         parameters, status, progress_percent, estimated_credits
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'QUEUED', 5, $11)
       RETURNING id, created_at`,
      [
        userId,
        connected.prov_id,
        connected.id,
        reservation.id,
        dto.mediaType,
        dto.operation,
        dto.prompt.trim(),
        dto.negativePrompt || null,
        dto.sourceFileId || null,
        JSON.stringify({ count, size: dto.size || '1024x1024', durationSeconds }),
        estimatedCredits,
      ],
    );

    const jobId = jobIns.rows[0].id;
    await this.queue.enqueue<MediaJobPayload>('nexora-media-jobs', dto.operation, { jobId });

    return {
      jobId,
      status: 'QUEUED',
      progressPercent: 5,
      estimatedCreditsReserved: estimatedCredits,
      modelName: connected.display_name,
      createdAt: jobIns.rows[0].created_at,
    };
  }

  private async processMediaJob(
    jobId: string,
    updateProgress: (pct: number) => Promise<void>,
  ): Promise<void> {
    const jRes = await this.db.query(
      `SELECT j.*, m.model_key, p.adapter_type, p.base_url, p.api_key_encrypted, p.requires_api_key, p.timeout_ms
       FROM media_generation_jobs j
       JOIN ai_models m ON m.id = j.model_id
       JOIN ai_providers p ON p.id = j.provider_id
       WHERE j.id = $1`,
      [jobId],
    );
    if (jRes.rowCount === 0) return;
    const j = jRes.rows[0];

    await this.setJobProgress(jobId, j.user_id, 'PROCESSING', 25);
    await updateProgress(25);

    const requiresKey = j.requires_api_key !== false;
    const apiKey = this.providers.decryptProviderKey(j.api_key_encrypted) || '';
    if (requiresKey && !apiKey) {
      await this.failMediaJob(jobId, j.user_id, j.reservation_id, 'Provider credentials missing');
      return;
    }

    try {
      const params = j.parameters || {};
      let sourceImageBase64: string | undefined;
      if (j.source_file_id) {
        const f = await this.storage.getFileForUser(j.user_id, j.source_file_id);
        sourceImageBase64 = f.buffer.toString('base64');
      }

      await this.setJobProgress(jobId, j.user_id, 'PROCESSING', 60);
      await updateProgress(60);

      const mediaOut =
        j.media_type === 'IMAGE'
          ? await this.providers.executeImageGeneration({
              providerId: j.provider_id,
              adapterType: j.adapter_type,
              baseUrl: j.base_url,
              apiKey,
              modelKey: j.model_key,
              prompt: j.prompt,
              size: params.size,
              count: params.count || 1,
              timeoutMs: j.timeout_ms || 60000,
            })
          : await this.providers.executeVideoGeneration({
              providerId: j.provider_id,
              adapterType: j.adapter_type,
              baseUrl: j.base_url,
              apiKey,
              modelKey: j.model_key,
              prompt: j.prompt,
              durationSeconds: params.durationSeconds || 5,
              sourceImageBase64,
              timeoutMs: Math.max(90000, j.timeout_ms || 90000),
            });

      const pricing = await this.costService.getModelPricing(j.model_id);
      const { creditsToCharge, providerCostUsd } = this.costService.calculateActualUsageCost(
        pricing,
        j.media_type === 'IMAGE'
          ? { imagesGenerated: mediaOut.providerCostUnits }
          : { videoSeconds: mediaOut.providerCostUnits },
      );

      const settlement = await this.wallet.settleReservation(j.reservation_id, creditsToCharge);

      await this.costService.recordUsageAndCheckAlerts({
        userId: j.user_id,
        providerId: j.provider_id,
        modelId: j.model_id,
        reservationId: j.reservation_id,
        taskType: `${j.media_type}_${j.operation}`,
        inputTokens: 0,
        outputTokens: 0,
        imagesGenerated: j.media_type === 'IMAGE' ? mediaOut.providerCostUnits : 0,
        videoSeconds: j.media_type === 'VIDEO' ? mediaOut.providerCostUnits : 0,
        providerCostUsd,
        creditsCharged: settlement.settledCredits,
        realizedRevenueUsd: settlement.realizedRevenueUsd,
      });

      await this.db.query(
        `UPDATE media_generation_jobs
         SET status = 'SUCCEEDED',
             progress_percent = 100,
             output_urls = $1,
             external_job_id = $2,
             actual_credits = $3,
             provider_cost_usd = $4,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $5`,
        [
          JSON.stringify(mediaOut.outputUrls),
          mediaOut.externalJobId || null,
          settlement.settledCredits,
          providerCostUsd,
          jobId,
        ],
      );

      await updateProgress(100);
      this.ws.emitToUser(j.user_id, 'media:job_updated', {
        jobId,
        status: 'SUCCEEDED',
        progressPercent: 100,
        outputUrls: mediaOut.outputUrls,
        actualCredits: settlement.settledCredits,
      });
    } catch (err: any) {
      await this.failMediaJob(
        jobId,
        j.user_id,
        j.reservation_id,
        err?.message || 'Media generation failed',
      );
    }
  }

  private async setJobProgress(jobId: string, userId: string, status: string, pct: number) {
    await this.db.query(
      'UPDATE media_generation_jobs SET status = $1, progress_percent = $2, updated_at = NOW() WHERE id = $3',
      [status, pct, jobId],
    );
    this.ws.emitToUser(userId, 'media:job_updated', {
      jobId,
      status,
      progressPercent: pct,
    });
  }

  private async failMediaJob(jobId: string, userId: string, reservationId: string, reason: string) {
    await this.wallet.refundReservation(reservationId, reason);
    await this.db.query(
      `UPDATE media_generation_jobs
       SET status = 'FAILED', error_message = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reason.slice(0, 500), jobId],
    );
    this.ws.emitToUser(userId, 'media:job_updated', {
      jobId,
      status: 'FAILED',
      errorMessage: reason,
    });
  }

  async getJobStatus(userId: string, jobId: string) {
    const res = await this.db.query(
      `SELECT j.*, m.display_name AS model_name
       FROM media_generation_jobs j
       JOIN ai_models m ON m.id = j.model_id
       WHERE j.id = $1 AND j.user_id = $2`,
      [jobId, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Media generation job not found');
    const r = res.rows[0];
    return {
      ...r,
      estimated_credits: Number(r.estimated_credits),
      actual_credits: Number(r.actual_credits),
    };
  }

  async listUserJobs(userId: string, mediaType?: string) {
    const res = await this.db.query(
      `SELECT j.*, m.display_name AS model_name
       FROM media_generation_jobs j
       JOIN ai_models m ON m.id = j.model_id
       WHERE j.user_id = $1 AND ($2::varchar IS NULL OR j.media_type = $2)
       ORDER BY j.created_at DESC
       LIMIT 40`,
      [userId, mediaType || null],
    );
    return res.rows.map((r) => ({
      ...r,
      estimated_credits: Number(r.estimated_credits),
      actual_credits: Number(r.actual_credits),
    }));
  }
}

@ApiTags('Image & Video Generation (Async Background Jobs)')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly mediaService: MediaService) {}

  @Get('capabilities')
  @ApiOperation({ summary: 'Get live image & video capabilities supported by connected providers' })
  async getCapabilities() {
    return this.mediaService.getConnectedCapabilities();
  }

  @Post('images')
  @ApiOperation({ summary: 'Submit background Image Generation, Variation, or Edit job' })
  async createImageJob(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.mediaService.submitMediaJob(user.id, user.role, {
      ...body,
      mediaType: 'IMAGE',
      operation: body?.operation || 'TEXT_TO_IMAGE',
    });
  }

  @Post('videos')
  @ApiOperation({ summary: 'Submit background Text-to-Video or Image-to-Video job' })
  async createVideoJob(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.mediaService.submitMediaJob(user.id, user.role, {
      ...body,
      mediaType: 'VIDEO',
      operation: body?.operation || 'TEXT_TO_VIDEO',
    });
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List user image and video generation history' })
  async listJobs(@CurrentUser() user: AuthenticatedUser, @Query('mediaType') mediaType?: string) {
    return this.mediaService.listUserJobs(user.id, mediaType);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Poll background job progress & output URLs' })
  async getJob(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.mediaService.getJobStatus(user.id, id);
  }
}

@Module({
  imports: [WalletModule, StorageModule, ChatModule],
  providers: [MediaService],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}
