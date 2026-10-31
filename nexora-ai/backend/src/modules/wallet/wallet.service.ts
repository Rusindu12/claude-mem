import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, DbQueryRunner } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';

export interface WalletSummary {
  walletId: string;
  userId: string;
  freeCredits: number;
  purchasedCredits: number;
  bonusCredits: number;
  reservedCredits: number;
  totalAvailableCredits: number;
  unearnedPurchasedLiabilityUsd: number;
  lastDailyClaimColombo: string | null;
  colomboToday: string;
  canClaimDailyToday: boolean;
  dailyAllowance: number;
}

export interface ReservationRecord {
  id: string;
  walletId: string;
  userId: string;
  totalReserved: number;
  reservedFree: number;
  reservedBonus: number;
  reservedPurchased: number;
  purchasedUnitUsd: number;
  status: string;
}

export interface SettlementResult {
  reservationId: string;
  settledCredits: number;
  releasedCredits: number;
  purchasedConsumed: number;
  realizedRevenueUsd: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

@Injectable()
export class WalletService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async getUserPlanCode(userId: string, runner: DbQueryRunner = this.db): Promise<string> {
    const res = await runner.query<{ code: string }>(
      `SELECT sp.code
       FROM subscriptions s
       JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'ACTIVE' AND s.current_period_end > NOW()
       ORDER BY sp.price_usd DESC
       LIMIT 1`,
      [userId],
    );
    return res.rowCount > 0 ? res.rows[0].code : 'FREE';
  }

  async getDailySettingForUser(
    userId: string,
    runner: DbQueryRunner = this.db,
  ): Promise<{ dailyFreeCredits: number; maxClaimsPerIpPerDay: number; isEnabled: boolean }> {
    const planCode = await this.getUserPlanCode(userId, runner);
    const res = await runner.query<{
      daily_free_credits: string;
      max_claims_per_ip_per_day: number;
      is_enabled: boolean;
    }>('SELECT daily_free_credits, max_claims_per_ip_per_day, is_enabled FROM daily_credit_settings WHERE plan_code = $1', [
      planCode,
    ]);
    if (res.rowCount === 0) {
      return { dailyFreeCredits: 25, maxClaimsPerIpPerDay: 5, isEnabled: true };
    }
    return {
      dailyFreeCredits: Number(res.rows[0].daily_free_credits),
      maxClaimsPerIpPerDay: Number(res.rows[0].max_claims_per_ip_per_day),
      isEnabled: res.rows[0].is_enabled,
    };
  }

  async getWalletSummary(userId: string): Promise<WalletSummary> {
    const colomboToday = this.crypto.getColomboDateString();
    const dailySetting = await this.getDailySettingForUser(userId);
    const res = await this.db.query<{
      id: string;
      user_id: string;
      free_credits: string;
      purchased_credits: string;
      bonus_credits: string;
      reserved_credits: string;
      unearned_purchased_liability_usd: string;
      last_daily_claim_colombo: string | null;
    }>('SELECT * FROM wallets WHERE user_id = $1', [userId]);

    if (res.rowCount === 0) {
      throw new NotFoundException('Wallet not found for user');
    }
    const w = res.rows[0];
    const free = Number(w.free_credits);
    const purchased = Number(w.purchased_credits);
    const bonus = Number(w.bonus_credits);
    const reserved = Number(w.reserved_credits);

    const claimCheck = await this.db.query(
      'SELECT id FROM daily_credit_claims WHERE user_id = $1 AND claim_date_colombo = $2',
      [userId, colomboToday],
    );

    return {
      walletId: w.id,
      userId: w.user_id,
      freeCredits: free,
      purchasedCredits: purchased,
      bonusCredits: bonus,
      reservedCredits: reserved,
      totalAvailableCredits: round4(free + purchased + bonus),
      unearnedPurchasedLiabilityUsd: Number(w.unearned_purchased_liability_usd),
      lastDailyClaimColombo: w.last_daily_claim_colombo,
      colomboToday,
      canClaimDailyToday: dailySetting.isEnabled && claimCheck.rowCount === 0,
      dailyAllowance: dailySetting.dailyFreeCredits,
    };
  }

  /**
   * Claims daily free credits strictly once per Colombo (Asia/Colombo) calendar day.
   * Resets previous-day unused free credits without touching purchased or bonus credits!
   */
  async claimDailyFreeCredits(
    userId: string,
    ipAddress?: string,
    deviceFingerprint?: string,
    overrideColomboDate?: string, // Only used in deterministic timezone rollover unit tests
  ): Promise<{
    claimedDateColombo: string;
    creditsGranted: number;
    previousFreeExpired: number;
    wallet: WalletSummary;
  }> {
    const colomboToday = overrideColomboDate || this.crypto.getColomboDateString();

    const result = await this.db.withTransaction(async (tx) => {
      const setting = await this.getDailySettingForUser(userId, tx);
      if (!setting.isEnabled || setting.dailyFreeCredits <= 0) {
        throw new ForbiddenException('Daily free credit allowance is currently disabled');
      }

      // Lock user's wallet row
      const wRes = await tx.query<{
        id: string;
        free_credits: string;
        purchased_credits: string;
        bonus_credits: string;
      }>('SELECT id, free_credits, purchased_credits, bonus_credits FROM wallets WHERE user_id = $1 FOR UPDATE', [
        userId,
      ]);
      if (wRes.rowCount === 0) {
        throw new NotFoundException('Wallet not found');
      }
      const wallet = wRes.rows[0];

      // Check existing claim for this Colombo calendar date
      const existingClaim = await tx.query(
        'SELECT id FROM daily_credit_claims WHERE user_id = $1 AND claim_date_colombo = $2',
        [userId, colomboToday],
      );
      if (existingClaim.rowCount > 0) {
        throw new ConflictException(
          `Daily free credits already claimed for Colombo calendar day ${colomboToday}`,
        );
      }

      // Abuse prevention: IP daily claim limit
      if (ipAddress && ipAddress !== '127.0.0.1' && ipAddress !== '::1') {
        const ipClaims = await tx.query<{ cnt: string }>(
          'SELECT COUNT(*)::text AS cnt FROM daily_credit_claims WHERE ip_address = $1 AND claim_date_colombo = $2',
          [ipAddress, colomboToday],
        );
        if (Number(ipClaims.rows[0].cnt) >= setting.maxClaimsPerIpPerDay) {
          throw new HttpException(
            'Daily free credit abuse protection triggered: maximum claims reached for this network today',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      const prevFree = Number(wallet.free_credits);
      const purchased = Number(wallet.purchased_credits);
      const bonus = Number(wallet.bonus_credits);
      const newFree = round4(setting.dailyFreeCredits);

      // 1. If previous day's free credits remained, record expiry in immutable ledger
      if (prevFree > 0) {
        await tx.query(
          `INSERT INTO wallet_transactions (
             wallet_id, user_id, tx_type, credit_bucket, amount,
             free_delta, purchased_delta, bonus_delta,
             balance_free_after, balance_purchased_after, balance_bonus_after,
             reference_type, idempotency_key, description
           ) VALUES ($1, $2, 'DAILY_FREE_EXPIRE', 'FREE', $3, $4, 0, 0, 0, $5, $6, 'DAILY_RESET', $7, $8)`,
          [
            wallet.id,
            userId,
            prevFree,
            -prevFree,
            purchased,
            bonus,
            `daily-expire:${userId}:${colomboToday}`,
            `Expired unused free credits prior to ${colomboToday} renewal (purchased & bonus untouched)`,
          ],
        );
      }

      // 2. Grant fresh Colombo daily free allowance
      await tx.query(
        `UPDATE wallets
         SET free_credits = $1,
             lifetime_free_granted = lifetime_free_granted + $1,
             last_daily_claim_colombo = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $3`,
        [newFree, colomboToday, wallet.id],
      );

      const grantTx = await tx.query<{ id: string }>(
        `INSERT INTO wallet_transactions (
           wallet_id, user_id, tx_type, credit_bucket, amount,
           free_delta, purchased_delta, bonus_delta,
           balance_free_after, balance_purchased_after, balance_bonus_after,
           reference_type, idempotency_key, description
         ) VALUES ($1, $2, 'DAILY_FREE_GRANT', 'FREE', $3, $3, 0, 0, $3, $4, $5, 'DAILY_CLAIM', $6, $7)
         RETURNING id`,
        [
          wallet.id,
          userId,
          newFree,
          purchased,
          bonus,
          `daily-grant:${userId}:${colomboToday}`,
          `Colombo daily free credit renewal for ${colomboToday}`,
        ],
      );

      await tx.query(
        `INSERT INTO daily_credit_claims (
           user_id, wallet_id, claim_date_colombo, credits_granted, previous_free_expired,
           ip_address, device_fingerprint, wallet_tx_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          wallet.id,
          colomboToday,
          newFree,
          prevFree,
          ipAddress || null,
          deviceFingerprint || null,
          grantTx.rows[0].id,
        ],
      );

      return {
        claimedDateColombo: colomboToday,
        creditsGranted: newFree,
        previousFreeExpired: prevFree,
      };
    });

    const summary = await this.getWalletSummary(userId);
    return { ...result, wallet: summary };
  }

  /**
   * Atomically reserves credits BEFORE sending an AI request.
   * Priority order: Free Credits -> Bonus Credits -> Purchased Credits.
   */
  async reserveCredits(params: {
    userId: string;
    amount: number;
    taskType: string;
    modelId?: string;
    idempotencyKey: string;
    ttlSeconds?: number;
  }): Promise<ReservationRecord> {
    const requested = round4(params.amount);
    if (requested <= 0) {
      throw new BadRequestException('Reservation credit amount must be positive');
    }

    return this.db.withTransaction(async (tx) => {
      // Idempotency check
      const existing = await tx.query<{
        id: string;
        wallet_id: string;
        user_id: string;
        total_reserved: string;
        reserved_free: string;
        reserved_bonus: string;
        reserved_purchased: string;
        purchased_unit_usd: string;
        status: string;
      }>('SELECT * FROM credit_reservations WHERE idempotency_key = $1', [params.idempotencyKey]);

      if (existing.rowCount > 0) {
        const r = existing.rows[0];
        return {
          id: r.id,
          walletId: r.wallet_id,
          userId: r.user_id,
          totalReserved: Number(r.total_reserved),
          reservedFree: Number(r.reserved_free),
          reservedBonus: Number(r.reserved_bonus),
          reservedPurchased: Number(r.reserved_purchased),
          purchasedUnitUsd: Number(r.purchased_unit_usd),
          status: r.status,
        };
      }

      const wRes = await tx.query<{
        id: string;
        free_credits: string;
        purchased_credits: string;
        bonus_credits: string;
        reserved_credits: string;
        unearned_purchased_liability_usd: string;
      }>('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [params.userId]);

      if (wRes.rowCount === 0) {
        throw new NotFoundException('Wallet not found');
      }

      const w = wRes.rows[0];
      const free = Number(w.free_credits);
      const bonus = Number(w.bonus_credits);
      const purchased = Number(w.purchased_credits);
      const available = round4(free + bonus + purchased);

      if (available < requested) {
        throw new HttpException(
          {
            code: 'INSUFFICIENT_CREDITS',
            message: `Insufficient credits: required ${requested}, available ${available}`,
            details: { required: requested, available, free, bonus, purchased },
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      let rem = requested;
      const fromFree = round4(Math.min(free, rem));
      rem = round4(rem - fromFree);
      const fromBonus = round4(Math.min(bonus, rem));
      rem = round4(rem - fromBonus);
      const fromPurchased = round4(rem);

      const newFree = round4(free - fromFree);
      const newBonus = round4(bonus - fromBonus);
      const newPurchased = round4(purchased - fromPurchased);
      const newReserved = round4(Number(w.reserved_credits) + requested);

      // Snapshot effective USD value per purchased credit for GAAP revenue recognition on settle
      const unearnedUsd = Number(w.unearned_purchased_liability_usd);
      const purchasedUnitUsd =
        purchased > 0 && fromPurchased > 0 ? round6(unearnedUsd / purchased) : 0;

      await tx.query(
        `UPDATE wallets
         SET free_credits = $1,
             bonus_credits = $2,
             purchased_credits = $3,
             reserved_credits = $4,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $5`,
        [newFree, newBonus, newPurchased, newReserved, w.id],
      );

      const expiresAt = new Date(Date.now() + (params.ttlSeconds || 300) * 1000).toISOString();
      const resIns = await tx.query<{ id: string }>(
        `INSERT INTO credit_reservations (
           wallet_id, user_id, idempotency_key, task_type, model_id,
           total_reserved, reserved_free, reserved_bonus, reserved_purchased,
           purchased_unit_usd, status, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'RESERVED', $11)
         RETURNING id`,
        [
          w.id,
          params.userId,
          params.idempotencyKey,
          params.taskType,
          params.modelId || null,
          requested,
          fromFree,
          fromBonus,
          fromPurchased,
          purchasedUnitUsd,
          expiresAt,
        ],
      );

      const bucket =
        (fromFree > 0 ? 1 : 0) + (fromBonus > 0 ? 1 : 0) + (fromPurchased > 0 ? 1 : 0) > 1
          ? 'MIXED'
          : fromFree > 0
            ? 'FREE'
            : fromBonus > 0
              ? 'BONUS'
              : 'PURCHASED';

      await tx.query(
        `INSERT INTO wallet_transactions (
           wallet_id, user_id, tx_type, credit_bucket, amount,
           free_delta, purchased_delta, bonus_delta,
           balance_free_after, balance_purchased_after, balance_bonus_after,
           reference_type, reference_id, idempotency_key, description
         ) VALUES ($1, $2, 'RESERVE', $3, $4, $5, $6, $7, $8, $9, $10, 'RESERVATION', $11, $12, $13)`,
        [
          w.id,
          params.userId,
          bucket,
          -requested,
          -fromFree,
          -fromPurchased,
          -fromBonus,
          newFree,
          newPurchased,
          newBonus,
          resIns.rows[0].id,
          `reserve:${params.idempotencyKey}`,
          `Reserved ${requested} credits for ${params.taskType}`,
        ],
      );

      return {
        id: resIns.rows[0].id,
        walletId: w.id,
        userId: params.userId,
        totalReserved: requested,
        reservedFree: fromFree,
        reservedBonus: fromBonus,
        reservedPurchased: fromPurchased,
        purchasedUnitUsd,
        status: 'RESERVED',
      };
    });
  }

  /**
   * Settles a credit reservation after successful AI completion.
   * Releases any unused reserved credits (restoring Purchased first, then Bonus, then Free).
   * Prevents duplicate deductions and updates GAAP realized revenue!
   */
  async settleReservation(reservationId: string, actualCreditsUsed: number): Promise<SettlementResult> {
    const desiredActual = Math.max(0, round4(actualCreditsUsed));

    return this.db.withTransaction(async (tx) => {
      const rRes = await tx.query<{
        id: string;
        wallet_id: string;
        user_id: string;
        total_reserved: string;
        reserved_free: string;
        reserved_bonus: string;
        reserved_purchased: string;
        purchased_unit_usd: string;
        settled_amount: string;
        released_amount: string;
        purchased_consumed: string;
        realized_revenue_usd: string;
        status: string;
      }>('SELECT * FROM credit_reservations WHERE id = $1 FOR UPDATE', [reservationId]);

      if (rRes.rowCount === 0) {
        throw new NotFoundException('Credit reservation not found');
      }
      const r = rRes.rows[0];

      // Idempotent guard against duplicate settlement
      if (r.status === 'SETTLED') {
        return {
          reservationId: r.id,
          settledCredits: Number(r.settled_amount),
          releasedCredits: Number(r.released_amount),
          purchasedConsumed: Number(r.purchased_consumed),
          realizedRevenueUsd: Number(r.realized_revenue_usd),
        };
      }
      if (r.status !== 'RESERVED') {
        throw new ConflictException(`Cannot settle reservation in status ${r.status}`);
      }

      const wRes = await tx.query<{
        id: string;
        free_credits: string;
        purchased_credits: string;
        bonus_credits: string;
        reserved_credits: string;
        unearned_purchased_liability_usd: string;
      }>('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [r.wallet_id]);
      const w = wRes.rows[0];

      const totalReserved = Number(r.total_reserved);
      const resFree = Number(r.reserved_free);
      const resBonus = Number(r.reserved_bonus);
      const resPurchased = Number(r.reserved_purchased);
      const unitUsd = Number(r.purchased_unit_usd);

      let free = Number(w.free_credits);
      let bonus = Number(w.bonus_credits);
      let purchased = Number(w.purchased_credits);
      const newReservedPool = Math.max(0, round4(Number(w.reserved_credits) - totalReserved));
      let unearnedUsd = Number(w.unearned_purchased_liability_usd);

      let settledCredits = desiredActual;
      let releasedCredits = 0;
      let releaseToPurchased = 0;
      let releaseToBonus = 0;
      let releaseToFree = 0;
      let extraFree = 0;
      let extraBonus = 0;
      let extraPurchased = 0;

      if (desiredActual <= totalReserved) {
        releasedCredits = round4(totalReserved - desiredActual);
        let remRelease = releasedCredits;
        // Restore paid credits FIRST so free/bonus credits absorb usage first
        releaseToPurchased = round4(Math.min(resPurchased, remRelease));
        remRelease = round4(remRelease - releaseToPurchased);
        releaseToBonus = round4(Math.min(resBonus, remRelease));
        remRelease = round4(remRelease - releaseToBonus);
        releaseToFree = round4(remRelease);

        purchased = round4(purchased + releaseToPurchased);
        bonus = round4(bonus + releaseToBonus);
        free = round4(free + releaseToFree);
      } else {
        // Usage slightly exceeded initial estimate: deduct delta up to available wallet balance (never < 0)
        const extraNeeded = round4(desiredActual - totalReserved);
        let remExtra = Math.min(extraNeeded, round4(free + bonus + purchased));
        settledCredits = round4(totalReserved + remExtra);

        extraFree = round4(Math.min(free, remExtra));
        remExtra = round4(remExtra - extraFree);
        extraBonus = round4(Math.min(bonus, remExtra));
        remExtra = round4(remExtra - extraBonus);
        extraPurchased = round4(remExtra);

        free = round4(free - extraFree);
        bonus = round4(bonus - extraBonus);
        purchased = round4(purchased - extraPurchased);
      }

      const purchasedConsumed = round4(resPurchased - releaseToPurchased + extraPurchased);
      const currentUnitUsd =
        unitUsd > 0
          ? unitUsd
          : Number(w.purchased_credits) > 0
            ? round6(unearnedUsd / Number(w.purchased_credits))
            : 0.01;
      const realizedRevenueUsd = Math.min(
        unearnedUsd,
        round6(purchasedConsumed * currentUnitUsd),
      );
      unearnedUsd = Math.max(0, round6(unearnedUsd - realizedRevenueUsd));

      await tx.query(
        `UPDATE wallets
         SET free_credits = $1,
             bonus_credits = $2,
             purchased_credits = $3,
             reserved_credits = $4,
             unearned_purchased_liability_usd = $5,
             lifetime_spent = lifetime_spent + $6,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $7`,
        [free, bonus, purchased, newReservedPool, unearnedUsd, settledCredits, w.id],
      );

      await tx.query(
        `UPDATE credit_reservations
         SET settled_amount = $1,
             released_amount = $2,
             purchased_consumed = $3,
             realized_revenue_usd = $4,
             status = 'SETTLED',
             settled_at = NOW()
         WHERE id = $5`,
        [settledCredits, releasedCredits, purchasedConsumed, realizedRevenueUsd, r.id],
      );

      if (releasedCredits > 0) {
        await tx.query(
          `INSERT INTO wallet_transactions (
             wallet_id, user_id, tx_type, credit_bucket, amount,
             free_delta, purchased_delta, bonus_delta,
             balance_free_after, balance_purchased_after, balance_bonus_after,
             realized_revenue_usd, reference_type, reference_id, idempotency_key, description
           ) VALUES ($1, $2, 'RELEASE_UNUSED', 'MIXED', $3, $4, $5, $6, $7, $8, $9, 0, 'RESERVATION', $10, $11, $12)`,
          [
            w.id,
            r.user_id,
            releasedCredits,
            releaseToFree,
            releaseToPurchased,
            releaseToBonus,
            free,
            purchased,
            bonus,
            r.id,
            `release:${r.id}`,
            `Released ${releasedCredits} unused reserved credits`,
          ],
        );
      }

      await tx.query(
        `INSERT INTO wallet_transactions (
           wallet_id, user_id, tx_type, credit_bucket, amount,
           free_delta, purchased_delta, bonus_delta,
           balance_free_after, balance_purchased_after, balance_bonus_after,
           realized_revenue_usd, reference_type, reference_id, idempotency_key, description
         ) VALUES ($1, $2, 'SETTLE', 'MIXED', $3, $4, $5, $6, $7, $8, $9, $10, 'RESERVATION', $11, $12, $13)`,
        [
          w.id,
          r.user_id,
          -settledCredits,
          -extraFree,
          -extraPurchased,
          -extraBonus,
          free,
          purchased,
          bonus,
          realizedRevenueUsd,
          r.id,
          `settle:${r.id}`,
          `Settled ${settledCredits} credits for completed AI request`,
        ],
      );

      return {
        reservationId: r.id,
        settledCredits,
        releasedCredits,
        purchasedConsumed,
        realizedRevenueUsd,
      };
    });
  }

  /**
   * Refunds 100% of reserved credits when an AI provider call fails or is aborted.
   */
  async refundReservation(reservationId: string, reason: string): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      const rRes = await tx.query<{
        id: string;
        wallet_id: string;
        user_id: string;
        total_reserved: string;
        reserved_free: string;
        reserved_bonus: string;
        reserved_purchased: string;
        status: string;
      }>('SELECT * FROM credit_reservations WHERE id = $1 FOR UPDATE', [reservationId]);

      if (rRes.rowCount === 0) return;
      const r = rRes.rows[0];
      if (r.status !== 'RESERVED') return; // Idempotent

      const wRes = await tx.query<{
        id: string;
        free_credits: string;
        purchased_credits: string;
        bonus_credits: string;
        reserved_credits: string;
      }>('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [r.wallet_id]);
      const w = wRes.rows[0];

      const resFree = Number(r.reserved_free);
      const resBonus = Number(r.reserved_bonus);
      const resPurchased = Number(r.reserved_purchased);
      const total = Number(r.total_reserved);

      const newFree = round4(Number(w.free_credits) + resFree);
      const newBonus = round4(Number(w.bonus_credits) + resBonus);
      const newPurchased = round4(Number(w.purchased_credits) + resPurchased);
      const newReserved = Math.max(0, round4(Number(w.reserved_credits) - total));

      await tx.query(
        `UPDATE wallets
         SET free_credits = $1,
             bonus_credits = $2,
             purchased_credits = $3,
             reserved_credits = $4,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $5`,
        [newFree, newBonus, newPurchased, newReserved, w.id],
      );

      await tx.query(
        `UPDATE credit_reservations
         SET status = 'REFUNDED',
             released_amount = total_reserved,
             failure_reason = $1,
             settled_at = NOW()
         WHERE id = $2`,
        [reason, r.id],
      );

      await tx.query(
        `INSERT INTO wallet_transactions (
           wallet_id, user_id, tx_type, credit_bucket, amount,
           free_delta, purchased_delta, bonus_delta,
           balance_free_after, balance_purchased_after, balance_bonus_after,
           reference_type, reference_id, idempotency_key, description
         ) VALUES ($1, $2, 'REFUND_FAILED_REQUEST', 'MIXED', $3, $4, $5, $6, $7, $8, $9, 'RESERVATION', $10, $11, $12)`,
        [
          w.id,
          r.user_id,
          total,
          resFree,
          resPurchased,
          resBonus,
          newFree,
          newPurchased,
          newBonus,
          r.id,
          `refund:${r.id}`,
          `Refunded reserved credits due to failed request: ${reason}`,
        ],
      );
    });
  }

  /**
   * Grants purchased + bonus credits inside an existing transaction (used by verified Payment Webhooks).
   */
  async grantPurchasedCreditsTx(
    tx: DbQueryRunner,
    params: {
      userId: string;
      purchasedCredits: number;
      bonusCredits: number;
      netCashUsd: number;
      paymentId: string;
      idempotencyKey: string;
      description: string;
    },
  ): Promise<void> {
    const wRes = await tx.query<{
      id: string;
      free_credits: string;
      purchased_credits: string;
      bonus_credits: string;
      unearned_purchased_liability_usd: string;
    }>('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [params.userId]);
    if (wRes.rowCount === 0) throw new NotFoundException('Wallet not found');
    const w = wRes.rows[0];

    const addPurchased = round4(params.purchasedCredits);
    const addBonus = round4(params.bonusCredits);
    const newFree = Number(w.free_credits);
    const newPurchased = round4(Number(w.purchased_credits) + addPurchased);
    const newBonus = round4(Number(w.bonus_credits) + addBonus);
    const newLiability = round6(
      Number(w.unearned_purchased_liability_usd) + Math.max(0, params.netCashUsd),
    );

    await tx.query(
      `UPDATE wallets
       SET purchased_credits = $1,
           bonus_credits = $2,
           unearned_purchased_liability_usd = $3,
           lifetime_purchased = lifetime_purchased + $4,
           lifetime_bonus_granted = lifetime_bonus_granted + $5,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $6`,
      [newPurchased, newBonus, newLiability, addPurchased, addBonus, w.id],
    );

    await tx.query(
      `INSERT INTO wallet_transactions (
         wallet_id, user_id, tx_type, credit_bucket, amount,
         free_delta, purchased_delta, bonus_delta,
         balance_free_after, balance_purchased_after, balance_bonus_after,
         reference_type, reference_id, idempotency_key, description
       ) VALUES ($1, $2, 'CREDIT_PURCHASE', $3, $4, 0, $5, $6, $7, $8, $9, 'PAYMENT', $10, $11, $12)`,
      [
        w.id,
        params.userId,
        addBonus > 0 && addPurchased > 0 ? 'MIXED' : addPurchased > 0 ? 'PURCHASED' : 'BONUS',
        round4(addPurchased + addBonus),
        addPurchased,
        addBonus,
        newFree,
        newPurchased,
        newBonus,
        params.paymentId,
        params.idempotencyKey,
        params.description,
      ],
    );
  }

  /**
   * Grants bonus credits (Referrals, Promo Codes, Subscriptions, Admin Rewards).
   */
  async grantBonusCreditsTx(
    tx: DbQueryRunner,
    params: {
      userId: string;
      bonusCredits: number;
      txType: 'SUBSCRIPTION_BONUS' | 'REFERRAL_REWARD' | 'PROMO_REWARD' | 'ADMIN_GRANT';
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
      description: string;
    },
  ): Promise<string> {
    const wRes = await tx.query<{
      id: string;
      free_credits: string;
      purchased_credits: string;
      bonus_credits: string;
    }>('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [params.userId]);
    if (wRes.rowCount === 0) throw new NotFoundException('Wallet not found');
    const w = wRes.rows[0];

    const addBonus = round4(params.bonusCredits);
    const newBonus = round4(Number(w.bonus_credits) + addBonus);

    await tx.query(
      `UPDATE wallets
       SET bonus_credits = $1,
           lifetime_bonus_granted = lifetime_bonus_granted + $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $3`,
      [newBonus, addBonus, w.id],
    );

    const txIns = await tx.query<{ id: string }>(
      `INSERT INTO wallet_transactions (
         wallet_id, user_id, tx_type, credit_bucket, amount,
         free_delta, purchased_delta, bonus_delta,
         balance_free_after, balance_purchased_after, balance_bonus_after,
         reference_type, reference_id, idempotency_key, description
       ) VALUES ($1, $2, $3, 'BONUS', $4, 0, 0, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        w.id,
        params.userId,
        params.txType,
        addBonus,
        Number(w.free_credits),
        Number(w.purchased_credits),
        newBonus,
        params.referenceType,
        params.referenceId,
        params.idempotencyKey,
        params.description,
      ],
    );
    return txIns.rows[0].id;
  }

  async getTransactions(userId: string, limit = 50, offset = 0) {
    const res = await this.db.query(
      `SELECT id, tx_type, credit_bucket, amount,
              free_delta, purchased_delta, bonus_delta,
              balance_free_after, balance_purchased_after, balance_bonus_after,
              realized_revenue_usd, reference_type, reference_id, description, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, Math.min(limit, 200), Math.max(0, offset)],
    );
    return res.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      free_delta: Number(r.free_delta),
      purchased_delta: Number(r.purchased_delta),
      bonus_delta: Number(r.bonus_delta),
      balance_free_after: Number(r.balance_free_after),
      balance_purchased_after: Number(r.balance_purchased_after),
      balance_bonus_after: Number(r.balance_bonus_after),
      realized_revenue_usd: Number(r.realized_revenue_usd),
    }));
  }
}
