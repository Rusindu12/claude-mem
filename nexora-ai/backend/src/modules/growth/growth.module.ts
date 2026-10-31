import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Controller, Delete, Get, Param, Patch, Post, Body, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletModule } from '../wallet/wallet.module';
import { AuthenticatedUser, CurrentUser } from '../../common/auth.decorators';

@Injectable()
export class GrowthAndPlatformService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(WalletService) private readonly walletService: WalletService,
  ) {}

  async getReferralDashboard(userId: string) {
    const userRes = await this.db.query<{ referral_code: string }>(
      'SELECT referral_code FROM users WHERE id = $1',
      [userId],
    );
    const listRes = await this.db.query<{
      id: string;
      referred_name: string;
      referrer_bonus_credits: string;
      status: string;
      created_at: string;
    }>(
      `SELECT r.id, u.full_name AS referred_name, r.referrer_bonus_credits, r.status, r.created_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_user_id
       WHERE r.referrer_user_id = $1
       ORDER BY r.created_at DESC`,
      [userId],
    );

    const totalEarned = listRes.rows.reduce(
      (acc, r) => acc + Number(r.referrer_bonus_credits),
      0,
    );

    return {
      referralCode: userRes.rows[0]?.referral_code,
      shareMessage: `Join me on NEXORA AI — Intelligence Without Limits! Use my code ${userRes.rows[0]?.referral_code} for free bonus AI credits.`,
      totalReferrals: listRes.rowCount,
      totalBonusCreditsEarned: totalEarned,
      referrals: listRes.rows.map((r) => ({
        id: r.id,
        referredName: r.referred_name,
        bonusCredits: Number(r.referrer_bonus_credits),
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  }

  async redeemPromoCode(userId: string, rawCode: string) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Promo code is required');

    const walletTxResult = await this.db.withTransaction(async (tx) => {
      const pRes = await tx.query<{
        id: string;
        code: string;
        reward_type: string;
        bonus_credits: string;
        max_redemptions: number | null;
        current_redemptions: number;
        starts_at: string;
        expires_at: string | null;
        is_active: boolean;
      }>('SELECT * FROM promo_codes WHERE UPPER(code) = $1 FOR UPDATE', [code]);

      if (pRes.rowCount === 0 || !pRes.rows[0].is_active) {
        throw new NotFoundException('Invalid or inactive promotional code');
      }
      const promo = pRes.rows[0];
      const now = new Date();
      if (new Date(promo.starts_at) > now || (promo.expires_at && new Date(promo.expires_at) < now)) {
        throw new BadRequestException('Promotional code is outside its valid redemption window');
      }
      if (promo.max_redemptions !== null && promo.current_redemptions >= promo.max_redemptions) {
        throw new ConflictException('Promotional code has reached maximum redemptions');
      }

      const dup = await tx.query(
        'SELECT id FROM promo_code_redemptions WHERE promo_code_id = $1 AND user_id = $2',
        [promo.id, userId],
      );
      if (dup.rowCount > 0) {
        throw new ConflictException('You have already redeemed this promotional code');
      }

      if (promo.reward_type !== 'BONUS_CREDITS' || Number(promo.bonus_credits) <= 0) {
        throw new BadRequestException('This code is a checkout discount code; apply it during package purchase');
      }

      const credits = Number(promo.bonus_credits);
      const txId = await this.walletService.grantBonusCreditsTx(tx, {
        userId,
        bonusCredits: credits,
        txType: 'PROMO_REWARD',
        referenceType: 'PROMO_CODE',
        referenceId: promo.id,
        idempotencyKey: `promo:${promo.id}:${userId}`,
        description: `Redeemed promo code ${promo.code}`,
      });

      await tx.query(
        'UPDATE promo_codes SET current_redemptions = current_redemptions + 1 WHERE id = $1',
        [promo.id],
      );

      await tx.query(
        `INSERT INTO promo_code_redemptions (promo_code_id, user_id, wallet_tx_id, credits_awarded)
         VALUES ($1, $2, $3, $4)`,
        [promo.id, userId, txId, credits],
      );

      return { code: promo.code, creditsAwarded: credits };
    });

    const wallet = await this.walletService.getWalletSummary(userId);
    return { ...walletTxResult, wallet };
  }

  async getNotifications(userId: string) {
    const [notifs, announcements] = await Promise.all([
      this.db.query(
        `SELECT id, type, title, body, metadata, is_read, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId],
      ),
      this.db.query(
        `SELECT id, title, body, title_si, body_si, severity, created_at
         FROM announcements
         WHERE is_active = TRUE AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
    ]);

    return {
      unreadCount: notifs.rows.filter((n) => !n.is_read).length,
      notifications: notifs.rows,
      announcements: announcements.rows,
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    await this.db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2',
      [notificationId, userId],
    );
    return { updated: true };
  }

  async listBusinessApiKeys(userId: string) {
    const res = await this.db.query(
      `SELECT id, name, key_prefix, scopes, rate_limit_rpm, is_active, last_used_at, expires_at, created_at
       FROM business_api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows;
  }

  async createBusinessApiKey(userId: string, role: string, name: string) {
    const planCode = await this.walletService.getUserPlanCode(userId);
    const planRes = await this.db.query<{ allows_business_api: boolean; rate_limit_rpm: number }>(
      'SELECT allows_business_api, rate_limit_rpm FROM subscription_plans WHERE code = $1',
      [planCode],
    );
    const allowed =
      role === 'OWNER' ||
      role === 'ADMIN' ||
      (planRes.rowCount > 0 && planRes.rows[0].allows_business_api);

    if (!allowed) {
      throw new ForbiddenException(
        'Business API access requires an active Business or Enterprise subscription plan',
      );
    }

    const rawSecret = `nxr_live_${this.crypto.randomToken(28)}`;
    const prefix = rawSecret.slice(0, 14);
    const keyHash = this.crypto.sha256(rawSecret);
    const rpm = planRes.rowCount > 0 ? planRes.rows[0].rate_limit_rpm : 120;

    const ins = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO business_api_keys (user_id, name, key_prefix, key_hash, rate_limit_rpm)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [userId, (name || 'Production API Key').trim(), prefix, keyHash, rpm],
    );

    return {
      id: ins.rows[0].id,
      name: (name || 'Production API Key').trim(),
      apiKey: rawSecret, // Shown ONCE upon creation
      keyPrefix: prefix,
      rateLimitRpm: rpm,
      createdAt: ins.rows[0].created_at,
    };
  }

  async revokeBusinessApiKey(userId: string, keyId: string) {
    await this.db.query(
      'UPDATE business_api_keys SET is_active = FALSE WHERE id = $1 AND user_id = $2',
      [keyId, userId],
    );
    return { revoked: true };
  }
}

@ApiTags('Referrals, Promos, Notifications & Business API')
@ApiBearerAuth()
@Controller('platform')
export class GrowthAndPlatformController {
  constructor(
    @Inject(GrowthAndPlatformService) private readonly service: GrowthAndPlatformService,
  ) {}

  @Get('referrals')
  @ApiOperation({ summary: 'Get user referral code, share message, and earned bonus history' })
  async getReferrals(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getReferralDashboard(user.id);
  }

  @Post('promos/redeem')
  @ApiOperation({ summary: 'Redeem a promotional bonus credit code' })
  async redeemPromo(@CurrentUser() user: AuthenticatedUser, @Body() body: { code: string }) {
    return this.service.redeemPromoCode(user.id, body?.code);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Get user notifications and active platform announcements' })
  async getNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getNotifications(user.id);
  }

  @Patch('notifications/:id/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.markNotificationRead(user.id, id);
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'List Business API keys for the authenticated account' })
  async listKeys(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listBusinessApiKeys(user.id);
  }

  @Post('api-keys')
  @ApiOperation({ summary: 'Create a new Business API key (Business/Enterprise plans)' })
  async createKey(@CurrentUser() user: AuthenticatedUser, @Body() body: { name: string }) {
    return this.service.createBusinessApiKey(user.id, user.role, body?.name);
  }

  @Delete('api-keys/:id')
  async revokeKey(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.revokeBusinessApiKey(user.id, id);
  }
}

@Module({
  imports: [WalletModule],
  providers: [GrowthAndPlatformService],
  controllers: [GrowthAndPlatformController],
  exports: [GrowthAndPlatformService],
})
export class GrowthModule {}
