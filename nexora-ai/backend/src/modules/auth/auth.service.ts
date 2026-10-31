import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';
import { CacheService } from '../../cache/cache.service';
import { WalletService } from '../wallet/wallet.service';
import { SystemRole } from '../../common/auth.decorators';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly cryptoService: CryptoService,
    @Inject(CacheService) private readonly cache: CacheService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(WalletService) private readonly walletService: WalletService,
  ) {}

  async register(
    dto: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      countryCode?: string;
      preferredLanguage?: 'en' | 'si';
      referralCode?: string;
      deviceName?: string;
    },
    ipAddress: string,
    userAgent: string,
  ) {
    const rl = await this.cache.checkRateLimit(`auth:register:${ipAddress}`, 10, 60);
    if (!rl.allowed) {
      throw new HttpException('Too many registration attempts; try again shortly', HttpStatus.TOO_MANY_REQUESTS);
    }

    const email = (dto.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email address is required');
    }
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }
    if (!dto.fullName || dto.fullName.trim().length < 2) {
      throw new BadRequestException('Full name is required');
    }

    const existing = await this.db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rowCount > 0) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const myReferralCode = this.cryptoService.generateReferralCode();
    const colomboToday = this.cryptoService.getColomboDateString();

    const conversionSetting = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'credits.conversion_rates'",
    );
    const rates = conversionSetting.rowCount > 0 ? conversionSetting.rows[0].setting_value : {};
    const signupBonus = Number(rates.signup_bonus_credits ?? 50);
    const referrerReward = Number(rates.referrer_reward_credits ?? 40);
    const referredReward = Number(rates.referred_reward_credits ?? 30);

    const dailyFreeRes = await this.db.query<{ daily_free_credits: string }>(
      "SELECT daily_free_credits FROM daily_credit_settings WHERE plan_code = 'FREE'",
    );
    const initialDailyFree = dailyFreeRes.rowCount > 0 ? Number(dailyFreeRes.rows[0].daily_free_credits) : 25;

    const rawRefreshToken = this.cryptoService.randomToken(40);
    const refreshHash = this.cryptoService.sha256(rawRefreshToken);
    const familyId = crypto.randomUUID();

    const created = await this.db.withTransaction(async (tx) => {
      const roleRes = await tx.query<{ id: string }>("SELECT id FROM roles WHERE name = 'USER'");
      const userRoleId = roleRes.rows[0].id;

      let referrerId: string | null = null;
      if (dto.referralCode && dto.referralCode.trim().length > 0) {
        const refLookup = await tx.query<{ id: string }>(
          'SELECT id FROM users WHERE UPPER(referral_code) = UPPER($1) AND is_active = TRUE',
          [dto.referralCode.trim()],
        );
        if (refLookup.rowCount > 0) {
          referrerId = refLookup.rows[0].id;
        }
      }

      const userIns = await tx.query<{ id: string }>(
        `INSERT INTO users (
           email, password_hash, full_name, phone, country_code,
           preferred_language, role_id, referral_code, referred_by_user_id, last_login_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id`,
        [
          email,
          passwordHash,
          dto.fullName.trim(),
          dto.phone || null,
          (dto.countryCode || 'LK').toUpperCase().slice(0, 5),
          dto.preferredLanguage === 'si' ? 'si' : 'en',
          userRoleId,
          myReferralCode,
          referrerId,
        ],
      );
      const userId = userIns.rows[0].id;

      const totalInitialBonus = signupBonus + (referrerId ? referredReward : 0);
      const walletIns = await tx.query<{ id: string }>(
        `INSERT INTO wallets (
           user_id, free_credits, purchased_credits, bonus_credits,
           lifetime_free_granted, lifetime_bonus_granted, last_daily_claim_colombo
         ) VALUES ($1, $2, 0, $3, $2, $3, $4)
         RETURNING id`,
        [userId, initialDailyFree, totalInitialBonus, colomboToday],
      );
      const walletId = walletIns.rows[0].id;

      // Record initial daily free grant + claim
      const freeTx = await tx.query<{ id: string }>(
        `INSERT INTO wallet_transactions (
           wallet_id, user_id, tx_type, credit_bucket, amount,
           free_delta, purchased_delta, bonus_delta,
           balance_free_after, balance_purchased_after, balance_bonus_after,
           reference_type, idempotency_key, description
         ) VALUES ($1, $2, 'DAILY_FREE_GRANT', 'FREE', $3, $3, 0, 0, $3, 0, 0, 'SIGNUP_DAILY', $4, $5)
         RETURNING id`,
        [
          walletId,
          userId,
          initialDailyFree,
          `signup-daily:${userId}:${colomboToday}`,
          `Initial Colombo daily free credit grant (${colomboToday})`,
        ],
      );

      await tx.query(
        `INSERT INTO daily_credit_claims (
           user_id, wallet_id, claim_date_colombo, credits_granted, previous_free_expired, ip_address, wallet_tx_id
         ) VALUES ($1, $2, $3, $4, 0, $5, $6)`,
        [userId, walletId, colomboToday, initialDailyFree, ipAddress, freeTx.rows[0].id],
      );

      // Record welcome bonus credits
      if (signupBonus > 0) {
        await tx.query(
          `INSERT INTO wallet_transactions (
             wallet_id, user_id, tx_type, credit_bucket, amount,
             free_delta, purchased_delta, bonus_delta,
             balance_free_after, balance_purchased_after, balance_bonus_after,
             reference_type, idempotency_key, description
           ) VALUES ($1, $2, 'ADMIN_GRANT', 'BONUS', $3, 0, 0, $3, $4, 0, $3, 'WELCOME_BONUS', $5, 'Welcome bonus credits for joining NEXORA AI')`,
          [walletId, userId, signupBonus, initialDailyFree, `welcome-bonus:${userId}`],
        );
      }

      // Process Referral Rewards atomically
      if (referrerId && referrerId !== userId) {
        await tx.query(
          `INSERT INTO referrals (
             referrer_user_id, referred_user_id, referral_code_used,
             referrer_bonus_credits, referred_bonus_credits, status, ip_address, rewarded_at
           ) VALUES ($1, $2, $3, $4, $5, 'REWARDED', $6, NOW())`,
          [
            referrerId,
            userId,
            dto.referralCode!.trim().toUpperCase(),
            referrerReward,
            referredReward,
            ipAddress,
          ],
        );

        if (referredReward > 0) {
          await tx.query(
            `INSERT INTO wallet_transactions (
               wallet_id, user_id, tx_type, credit_bucket, amount,
               free_delta, purchased_delta, bonus_delta,
               balance_free_after, balance_purchased_after, balance_bonus_after,
               reference_type, reference_id, idempotency_key, description
             ) VALUES ($1, $2, 'REFERRAL_REWARD', 'BONUS', $3, 0, 0, $3, $4, 0, $5, 'REFERRAL', $6, $7, 'Referral signup bonus credits')`,
            [
              walletId,
              userId,
              referredReward,
              initialDailyFree,
              totalInitialBonus,
              referrerId,
              `referred-bonus:${userId}`,
            ],
          );
        }

        if (referrerReward > 0) {
          await this.walletService.grantBonusCreditsTx(tx, {
            userId: referrerId,
            bonusCredits: referrerReward,
            txType: 'REFERRAL_REWARD',
            referenceType: 'REFERRAL',
            referenceId: userId,
            idempotencyKey: `referrer-reward:${referrerId}:${userId}`,
            description: `Referral reward for inviting ${dto.fullName.trim()}`,
          });

          await tx.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata)
             VALUES ($1, 'CREDITS', 'Referral Bonus Earned!', $2, $3)`,
            [
              referrerId,
              `You earned ${referrerReward} bonus credits from a new referral!`,
              JSON.stringify({ referredUserId: userId, credits: referrerReward }),
            ],
          );
        }
      }

      // Welcome notification
      await tx.query(
        `INSERT INTO notifications (user_id, type, title, body)
         VALUES ($1, 'SYSTEM', 'Welcome to NEXORA AI', 'Intelligence Without Limits — your daily free & welcome bonus credits are ready.')`,
        [userId],
      );

      // Create initial session
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const sessIns = await tx.query<{ id: string }>(
        `INSERT INTO sessions (user_id, refresh_token_hash, token_family_id, device_name, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          userId,
          refreshHash,
          familyId,
          dto.deviceName || 'NEXORA Android App',
          ipAddress,
          userAgent,
          expiresAt,
        ],
      );

      return { userId, sessionId: sessIns.rows[0].id };
    });

    const accessToken = await this.issueAccessToken(created.userId, 'USER', created.sessionId);
    const profile = await this.getUserProfile(created.userId);
    const wallet = await this.walletService.getWalletSummary(created.userId);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: profile,
      wallet,
    };
  }

  async login(
    dto: { email: string; password: string; deviceName?: string },
    ipAddress: string,
    userAgent: string,
  ) {
    const rl = await this.cache.checkRateLimit(`auth:login:${ipAddress}`, 20, 60);
    if (!rl.allowed) {
      throw new HttpException('Too many login attempts; please wait 1 minute', HttpStatus.TOO_MANY_REQUESTS);
    }

    const email = (dto.email || '').trim().toLowerCase();
    const res = await this.db.query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      is_active: boolean;
      is_suspended: boolean;
      suspension_reason: string | null;
      failed_login_attempts: number;
      locked_until: string | null;
      role_name: SystemRole;
    }>(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.is_active, u.is_suspended,
              u.suspension_reason, u.failed_login_attempts, u.locked_until, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = $1`,
      [email],
    );

    if (res.rowCount === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const u = res.rows[0];

    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new ForbiddenException('Account temporarily locked due to failed login attempts; try again later');
    }

    const validPwd = await bcrypt.compare(dto.password || '', u.password_hash);
    if (!validPwd) {
      const nextAttempts = u.failed_login_attempts + 1;
      const lockUntil =
        nextAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await this.db.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW() WHERE id = $3',
        [nextAttempts, lockUntil, u.id],
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!u.is_active || u.is_suspended) {
      throw new ForbiddenException(u.suspension_reason || 'Account is suspended');
    }

    const rawRefreshToken = this.cryptoService.randomToken(40);
    const refreshHash = this.cryptoService.sha256(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const sessIns = await this.db.query<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_token_hash, token_family_id, device_name, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        u.id,
        refreshHash,
        familyId,
        dto.deviceName || 'NEXORA Client',
        ipAddress,
        userAgent,
        expiresAt,
      ],
    );

    await this.db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [u.id],
    );

    const accessToken = await this.issueAccessToken(u.id, u.role_name, sessIns.rows[0].id);
    const profile = await this.getUserProfile(u.id);
    const wallet = await this.walletService.getWalletSummary(u.id);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: profile,
      wallet,
    };
  }

  /**
   * Refresh-token rotation with token-family reuse detection!
   */
  async refreshTokens(rawRefreshToken: string, ipAddress: string, userAgent: string) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }
    const tokenHash = this.cryptoService.sha256(rawRefreshToken);

    const sessRes = await this.db.query<{
      id: string;
      user_id: string;
      token_family_id: string;
      device_name: string | null;
      is_revoked: boolean;
      expires_at: string;
      role_name: SystemRole;
      is_active: boolean;
      is_suspended: boolean;
    }>(
      `SELECT s.id, s.user_id, s.token_family_id, s.device_name, s.is_revoked, s.expires_at,
              r.name AS role_name, u.is_active, u.is_suspended
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.refresh_token_hash = $1`,
      [tokenHash],
    );

    if (sessRes.rowCount === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const s = sessRes.rows[0];

    // Reuse detection: if an already-rotated/revoked token is presented again, revoke the entire token family!
    if (s.is_revoked) {
      await this.db.query(
        `UPDATE sessions
         SET is_revoked = TRUE, revoked_reason = 'REFRESH_TOKEN_REUSE_DETECTED'
         WHERE token_family_id = $1`,
        [s.token_family_id],
      );
      throw new UnauthorizedException('Refresh token reuse detected; session family revoked for security');
    }

    if (new Date(s.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!s.is_active || s.is_suspended) {
      throw new ForbiddenException('Account is suspended');
    }

    const nextRefresh = this.cryptoService.randomToken(40);
    const nextHash = this.cryptoService.sha256(nextRefresh);
    const nextExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    const newSessionId = await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE sessions SET is_revoked = TRUE, revoked_reason = 'ROTATED', last_used_at = NOW() WHERE id = $1`,
        [s.id],
      );
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO sessions (user_id, refresh_token_hash, token_family_id, device_name, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [s.user_id, nextHash, s.token_family_id, s.device_name, ipAddress, userAgent, nextExpires],
      );
      return ins.rows[0].id;
    });

    const accessToken = await this.issueAccessToken(s.user_id, s.role_name, newSessionId);
    return {
      accessToken,
      refreshToken: nextRefresh,
    };
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.db.query(
        `UPDATE sessions SET is_revoked = TRUE, revoked_reason = 'USER_LOGOUT' WHERE id = $1 AND user_id = $2`,
        [sessionId, userId],
      );
    } else {
      await this.db.query(
        `UPDATE sessions SET is_revoked = TRUE, revoked_reason = 'USER_LOGOUT_ALL' WHERE user_id = $1`,
        [userId],
      );
    }
    return { loggedOut: true };
  }

  async requestPasswordRecovery(emailInput: string, ipAddress: string) {
    const email = (emailInput || '').trim().toLowerCase();
    const userRes = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email],
    );

    // Always return non-enumerating response; in dev/test mode return resetToken only if SMTP is unconfigured
    if (userRes.rowCount === 0) {
      return {
        accepted: true,
        message: 'If an account matches this email, recovery instructions have been dispatched.',
      };
    }

    const rawToken = this.cryptoService.randomToken(24);
    const tokenHash = this.cryptoService.sha256(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await this.db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)`,
      [userRes.rows[0].id, tokenHash, expiresAt, ipAddress],
    );

    const response: Record<string, any> = {
      accepted: true,
      message: 'If an account matches this email, recovery instructions have been dispatched.',
    };
    if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) {
      response.devResetToken = rawToken;
    }
    return response;
  }

  async resetPassword(rawToken: string, newPassword: string) {
    if (!rawToken || !newPassword || newPassword.length < 8) {
      throw new BadRequestException('Valid recovery token and password (>= 8 chars) required');
    }
    const tokenHash = this.cryptoService.sha256(rawToken);
    const res = await this.db.query<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash],
    );

    if (res.rowCount === 0 || res.rows[0].used_at || new Date(res.rows[0].expires_at) < new Date()) {
      throw new BadRequestException('Invalid or expired password recovery token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const row = res.rows[0];

    await this.db.withTransaction(async (tx) => {
      await tx.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
      await tx.query(
        'UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $2',
        [passwordHash, row.user_id],
      );
      await tx.query(
        `UPDATE sessions SET is_revoked = TRUE, revoked_reason = 'PASSWORD_RESET' WHERE user_id = $1`,
        [row.user_id],
      );
    });

    return { reset: true, message: 'Password updated successfully; all previous sessions revoked.' };
  }

  async getUserProfile(userId: string) {
    const res = await this.db.query<{
      id: string;
      email: string;
      full_name: string;
      phone: string | null;
      country_code: string;
      preferred_language: string;
      theme_preference: string;
      referral_code: string;
      is_email_verified: boolean;
      privacy_marketing_opt_in: boolean;
      data_retention_days: number;
      created_at: string;
      role_name: SystemRole;
    }>(
      `SELECT u.id, u.email, u.full_name, u.phone, u.country_code,
              u.preferred_language, u.theme_preference, u.referral_code,
              u.is_email_verified, u.privacy_marketing_opt_in, u.data_retention_days,
              u.created_at, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [userId],
    );
    const u = res.rows[0];
    const planCode = await this.walletService.getUserPlanCode(userId);
    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      phone: u.phone,
      countryCode: u.country_code,
      preferredLanguage: u.preferred_language,
      themePreference: u.theme_preference,
      referralCode: u.referral_code,
      role: u.role_name,
      activePlanCode: planCode,
      isEmailVerified: u.is_email_verified,
      privacyMarketingOptIn: u.privacy_marketing_opt_in,
      dataRetentionDays: u.data_retention_days,
      createdAt: u.created_at,
    };
  }

  async updateProfile(
    userId: string,
    dto: {
      fullName?: string;
      phone?: string;
      countryCode?: string;
      preferredLanguage?: 'en' | 'si';
      themePreference?: 'dark' | 'light';
      privacyMarketingOptIn?: boolean;
      dataRetentionDays?: number;
    },
  ) {
    await this.db.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           country_code = COALESCE($3, country_code),
           preferred_language = COALESCE($4, preferred_language),
           theme_preference = COALESCE($5, theme_preference),
           privacy_marketing_opt_in = COALESCE($6, privacy_marketing_opt_in),
           data_retention_days = COALESCE($7, data_retention_days),
           updated_at = NOW()
       WHERE id = $8`,
      [
        dto.fullName?.trim() || null,
        dto.phone ?? null,
        dto.countryCode?.toUpperCase() || null,
        dto.preferredLanguage || null,
        dto.themePreference || null,
        dto.privacyMarketingOptIn ?? null,
        dto.dataRetentionDays ?? null,
        userId,
      ],
    );
    return this.getUserProfile(userId);
  }

  async changePassword(userId: string, currentPassword?: string, newPassword?: string) {
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      throw new BadRequestException('Current password and a new password (min 8 chars) are required');
    }
    const res = await this.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    if (res.rowCount === 0) throw new UnauthorizedException('User not found');
    const ok = await bcrypt.compare(currentPassword, res.rows[0].password_hash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    const nextHash = await bcrypt.hash(newPassword, 12);
    await this.db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      nextHash,
      userId,
    ]);
    return { message: 'Password updated successfully.' };
  }

  private async issueAccessToken(userId: string, role: SystemRole, sessionId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, role, sid: sessionId },
      {
        secret: process.env.JWT_ACCESS_SECRET || 'nexora-dev-jwt-access-secret-change-in-prod!',
        expiresIn: '15m',
      },
    );
  }
}
