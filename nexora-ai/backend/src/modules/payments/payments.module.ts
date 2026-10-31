import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Body, Controller, Get, Headers, Module, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../config/crypto.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { AuthenticatedUser, CurrentUser, Public } from '../../common/auth.decorators';

@Injectable()
export class PaymentsAndSubscriptionsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly cryptoService: CryptoService,
    @Inject(WalletService) private readonly walletService: WalletService,
  ) {}

  async listCatalog() {
    const [packages, plans, convRes] = await Promise.all([
      this.db.query(
        'SELECT * FROM credit_packages WHERE is_active = TRUE ORDER BY sort_order ASC',
      ),
      this.db.query(
        'SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY sort_order ASC',
      ),
      this.db.query<{ setting_value: any }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'credits.conversion_rates'",
      ),
    ]);

    return {
      fxRates: convRes.rows[0]?.setting_value || { lkr_per_usd: 300 },
      creditPackages: packages.rows.map((p) => ({
        ...p,
        credits: Number(p.credits),
        bonus_credits: Number(p.bonus_credits),
        price_usd: Number(p.price_usd),
        price_lkr: Number(p.price_lkr),
        discount_percent: Number(p.discount_percent),
      })),
      subscriptionPlans: plans.rows.map((s) => ({
        ...s,
        price_usd: Number(s.price_usd),
        price_lkr: Number(s.price_lkr),
        included_bonus_credits: Number(s.included_bonus_credits),
        daily_free_credits: Number(s.daily_free_credits),
        discount_percent: Number(s.discount_percent),
      })),
    };
  }

  async getUserActiveSubscription(userId: string) {
    const res = await this.db.query(
      `SELECT s.*, sp.code AS plan_code, sp.name AS plan_name, sp.billing_interval, sp.features
       FROM subscriptions s
       JOIN subscription_plans sp ON sp.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'ACTIVE' AND s.current_period_end > NOW()
       ORDER BY sp.price_usd DESC
       LIMIT 1`,
      [userId],
    );
    return res.rowCount > 0 ? res.rows[0] : null;
  }

  async cancelSubscriptionAtPeriodEnd(userId: string, subscriptionId: string) {
    const res = await this.db.query(
      `UPDATE subscriptions
       SET cancel_at_period_end = TRUE, canceled_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
       RETURNING *`,
      [subscriptionId, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Active subscription not found');
    return res.rows[0];
  }

  /**
   * Initiates a checkout order in PENDING status.
   * NEVER allocates credits until verified backend webhook arrives!
   */
  async createCheckoutOrder(
    userId: string,
    dto: {
      paymentType: 'CREDIT_PACKAGE' | 'SUBSCRIPTION';
      packageId?: string;
      planId?: string;
      provider: 'PAYHERE' | 'STRIPE';
      currency: 'LKR' | 'USD' | 'EUR' | 'GBP';
      promoCode?: string;
    },
  ) {
    if (!['CREDIT_PACKAGE', 'SUBSCRIPTION'].includes(dto.paymentType)) {
      throw new BadRequestException('Invalid paymentType');
    }
    if (!['PAYHERE', 'STRIPE'].includes(dto.provider)) {
      throw new BadRequestException('Supported providers are PAYHERE (Sri Lanka) and STRIPE (International)');
    }
    const currency = dto.currency || (dto.provider === 'PAYHERE' ? 'LKR' : 'USD');
    if (!['LKR', 'USD', 'EUR', 'GBP'].includes(currency)) {
      throw new BadRequestException('Unsupported currency');
    }

    const ratesRes = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'credits.conversion_rates'",
    );
    const lkrPerUsd = Number(ratesRes.rows[0]?.setting_value?.lkr_per_usd || 300);

    let itemTitle = '';
    let basePriceUsd = 0;
    let basePriceLkr = 0;
    let creditsToGrant = 0;
    let bonusCreditsToGrant = 0;
    let packageId: string | null = null;
    let planId: string | null = null;

    if (dto.paymentType === 'CREDIT_PACKAGE') {
      const pkgRes = await this.db.query(
        'SELECT * FROM credit_packages WHERE id = $1 AND is_active = TRUE',
        [dto.packageId],
      );
      if (pkgRes.rowCount === 0) throw new NotFoundException('Credit package not found');
      const pkg = pkgRes.rows[0];
      packageId = pkg.id;
      itemTitle = `NEXORA AI ${pkg.name}`;
      basePriceUsd = Number(pkg.price_usd);
      basePriceLkr = Number(pkg.price_lkr);
      creditsToGrant = Number(pkg.credits);
      bonusCreditsToGrant = Number(pkg.bonus_credits);
    } else {
      const planRes = await this.db.query(
        'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = TRUE',
        [dto.planId],
      );
      if (planRes.rowCount === 0) throw new NotFoundException('Subscription plan not found');
      const plan = planRes.rows[0];
      if (Number(plan.price_usd) <= 0) {
        throw new BadRequestException('Free tier does not require payment checkout');
      }
      planId = plan.id;
      itemTitle = `NEXORA AI ${plan.name} Subscription`;
      basePriceUsd = Number(plan.price_usd);
      basePriceLkr = Number(plan.price_lkr);
      bonusCreditsToGrant = Number(plan.included_bonus_credits);
    }

    // Optional DISCOUNT_PERCENT promo code
    let discountMultiplier = 1.0;
    let promoId: string | null = null;
    if (dto.promoCode && dto.promoCode.trim()) {
      const pRes = await this.db.query(
        `SELECT * FROM promo_codes
         WHERE UPPER(code) = UPPER($1) AND is_active = TRUE AND reward_type = 'DISCOUNT_PERCENT'`,
        [dto.promoCode.trim()],
      );
      if (pRes.rowCount > 0) {
        const pct = Number(pRes.rows[0].discount_percent);
        discountMultiplier = Math.max(0.05, (100 - pct) / 100);
        promoId = pRes.rows[0].id;
      }
    }

    const finalUsd = Math.round(basePriceUsd * discountMultiplier * 100) / 100;
    const finalLkr = Math.round(basePriceLkr * discountMultiplier * 100) / 100;

    let chargeAmount = finalUsd;
    let fxRateToUsd = 1.0;
    if (currency === 'LKR') {
      chargeAmount = finalLkr;
      fxRateToUsd = 1 / lkrPerUsd;
    } else if (currency === 'EUR') {
      chargeAmount = Math.round(finalUsd * 0.92 * 100) / 100;
      fxRateToUsd = 1 / 0.92;
    } else if (currency === 'GBP') {
      chargeAmount = Math.round(finalUsd * 0.79 * 100) / 100;
      fxRateToUsd = 1 / 0.79;
    }

    // Estimate gateway processing fee (~3.3% PayHere, ~2.9% + $0.30 Stripe)
    const gatewayFeeUsd =
      dto.provider === 'PAYHERE'
        ? Math.round(finalUsd * 0.033 * 10000) / 10000
        : Math.round((finalUsd * 0.029 + 0.3) * 10000) / 10000;
    const netAmountUsd = Math.max(0, Math.round((finalUsd - gatewayFeeUsd) * 10000) / 10000);

    const orderNumber = `NXR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const pIns = await this.db.query<{ id: string; created_at: string }>(
      `INSERT INTO payments (
         user_id, order_number, payment_type, credit_package_id, subscription_plan_id,
         provider, currency, amount, fx_rate_to_usd, amount_usd,
         gateway_fee_usd, net_amount_usd, credits_to_grant, bonus_credits_to_grant,
         promo_code_id, status, verified_by_webhook
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'PENDING', FALSE)
       RETURNING id, created_at`,
      [
        userId,
        orderNumber,
        dto.paymentType,
        packageId,
        planId,
        dto.provider,
        currency,
        chargeAmount,
        fxRateToUsd,
        finalUsd,
        gatewayFeeUsd,
        netAmountUsd,
        creditsToGrant,
        bonusCreditsToGrant,
        promoId,
      ],
    );

    const paymentId = pIns.rows[0].id;

    if (dto.provider === 'PAYHERE') {
      const merchantId = process.env.PAYHERE_MERCHANT_ID || '';
      const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET || '';
      const amountFormatted = chargeAmount.toFixed(2);
      const hashedSecret = merchantSecret
        ? crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase()
        : '';
      const checkoutHash =
        merchantId && hashedSecret
          ? crypto
              .createHash('md5')
              .update(`${merchantId}${orderNumber}${amountFormatted}${currency}${hashedSecret}`)
              .digest('hex')
              .toUpperCase()
          : null;

      return {
        paymentId,
        orderNumber,
        status: 'PENDING',
        provider: 'PAYHERE',
        currency,
        amount: chargeAmount,
        amountUsd: finalUsd,
        creditsToGrant,
        bonusCreditsToGrant,
        gatewayConfigured: Boolean(merchantId && merchantSecret),
        checkoutUrl:
          process.env.PAYHERE_CHECKOUT_URL || 'https://sandbox.payhere.lk/pay/checkout',
        payherePayload: {
          merchant_id: merchantId || 'CONFIGURE_PAYHERE_MERCHANT_ID',
          order_id: orderNumber,
          items: itemTitle,
          currency,
          amount: amountFormatted,
          hash: checkoutHash,
          notify_url: `${process.env.PUBLIC_API_URL || 'https://api.nexora.ai'}/api/v1/payments/webhooks/payhere`,
        },
        securityNote:
          'Credits are strictly allocated only after cryptographic backend webhook verification.',
      };
    }

    // Stripe International Gateway
    let stripeCheckoutUrl: string | null = null;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      const params = new URLSearchParams();
      params.append('mode', 'payment');
      params.append('client_reference_id', orderNumber);
      params.append('metadata[order_number]', orderNumber);
      params.append('line_items[0][price_data][currency]', currency.toLowerCase());
      params.append('line_items[0][price_data][product_data][name]', itemTitle);
      params.append(
        'line_items[0][price_data][unit_amount]',
        String(Math.round(chargeAmount * 100)),
      );
      params.append('line_items[0][quantity]', '1');
      params.append(
        'success_url',
        `${process.env.PUBLIC_WEB_URL || 'https://app.nexora.ai'}/payment-return?id=${paymentId}`,
      );
      params.append(
        'cancel_url',
        `${process.env.PUBLIC_WEB_URL || 'https://app.nexora.ai'}/payment-cancel?id=${paymentId}`,
      );

      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (stripeRes.ok) {
        const sj: any = await stripeRes.json();
        stripeCheckoutUrl = sj.url;
        await this.db.query('UPDATE payments SET external_payment_id = $1 WHERE id = $2', [
          sj.id,
          paymentId,
        ]);
      }
    }

    return {
      paymentId,
      orderNumber,
      status: 'PENDING',
      provider: 'STRIPE',
      currency,
      amount: chargeAmount,
      amountUsd: finalUsd,
      creditsToGrant,
      bonusCreditsToGrant,
      gatewayConfigured: Boolean(stripeKey),
      checkoutUrl: stripeCheckoutUrl,
      securityNote:
        'Credits are strictly allocated only after cryptographic Stripe-Signature webhook verification.',
    };
  }

  /**
   * Client-side return status check — NEVER grants credits!
   */
  async verifyClientReturnStatus(userId: string, paymentId: string) {
    const res = await this.db.query(
      `SELECT id, order_number, status, verified_by_webhook, amount, currency,
              credits_to_grant, bonus_credits_to_grant, invoice_number, verified_at, created_at
       FROM payments
       WHERE id = $1 AND user_id = $2`,
      [paymentId, userId],
    );
    if (res.rowCount === 0) throw new NotFoundException('Payment order not found');
    const p = res.rows[0];
    return {
      ...p,
      amount: Number(p.amount),
      credits_to_grant: Number(p.credits_to_grant),
      bonus_credits_to_grant: Number(p.bonus_credits_to_grant),
      creditsAllocated: p.status === 'SUCCEEDED' && p.verified_by_webhook === true,
      note:
        p.status === 'SUCCEEDED'
          ? 'Backend webhook verified and credits allocated.'
          : 'Awaiting verified server-to-server gateway webhook. Client callbacks never allocate credits.',
    };
  }

  /**
   * Verifies authentic PayHere server-to-server notify_url MD5 signature & allocates credits atomically.
   */
  async handlePayHereWebhook(payload: Record<string, any>) {
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET;
    if (!merchantSecret) {
      throw new UnauthorizedException('PAYHERE_MERCHANT_SECRET is not configured on backend');
    }

    const {
      merchant_id = '',
      order_id = '',
      payment_id = '',
      payhere_amount = '',
      payhere_currency = '',
      status_code = '',
      md5sig = '',
    } = payload;

    const secretMd5 = crypto
      .createHash('md5')
      .update(merchantSecret)
      .digest('hex')
      .toUpperCase();
    const expectedSig = crypto
      .createHash('md5')
      .update(`${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${secretMd5}`)
      .digest('hex')
      .toUpperCase();

    if (!md5sig || !this.cryptoService.timingSafeEqualStr(String(md5sig).toUpperCase(), expectedSig)) {
      throw new UnauthorizedException('Invalid PayHere webhook md5sig signature');
    }

    const eventId = `payhere:${payment_id || order_id}:${status_code}`;
    if (String(status_code) !== '2') {
      await this.recordFailedOrderFromWebhook('PAYHERE', eventId, order_id, payload);
      return { received: true, status: 'PAYMENT_NOT_SUCCESSFUL' };
    }

    return this.fulfillVerifiedOrder({
      provider: 'PAYHERE',
      providerEventId: eventId,
      eventType: 'payhere.payment.succeeded',
      orderNumber: String(order_id),
      externalPaymentId: String(payment_id || order_id),
      paidAmount: Number(payhere_amount),
      paidCurrency: String(payhere_currency).toUpperCase(),
      rawPayload: payload,
    });
  }

  /**
   * Verifies authentic Stripe HMAC-SHA256 webhook signature & allocates credits atomically.
   */
  async handleStripeWebhook(rawBody: string, signatureHeader: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new UnauthorizedException('STRIPE_WEBHOOK_SECRET is not configured on backend');
    }
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing Stripe-Signature header');
    }

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k?.trim(), v?.trim()];
      }),
    );
    const ts = Number(parts.t);
    const v1 = parts.v1;
    if (!ts || !v1) {
      throw new UnauthorizedException('Malformed Stripe-Signature header');
    }

    // Anti-replay check (5-minute window)
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSeconds > 300) {
      throw new UnauthorizedException('Stripe webhook timestamp outside 5-minute tolerance');
    }

    const expectedHmac = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts}.${rawBody}`, 'utf8')
      .digest('hex');

    if (!this.cryptoService.timingSafeEqualStr(v1, expectedHmac)) {
      throw new UnauthorizedException('Invalid Stripe webhook HMAC signature');
    }

    const event = JSON.parse(rawBody);
    const obj = event?.data?.object || {};
    const orderNumber: string =
      obj.metadata?.order_number || obj.client_reference_id || '';

    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'payment_intent.succeeded'
    ) {
      return { received: true, ignoredEventType: event.type };
    }

    const paidCents = Number(obj.amount_total ?? obj.amount_received ?? 0);
    const paidCurrency = String(obj.currency || '').toUpperCase();

    return this.fulfillVerifiedOrder({
      provider: 'STRIPE',
      providerEventId: String(event.id),
      eventType: String(event.type),
      orderNumber,
      externalPaymentId: String(obj.payment_intent || obj.id),
      paidAmount: paidCents / 100,
      paidCurrency,
      rawPayload: event,
    });
  }

  private async recordFailedOrderFromWebhook(
    provider: string,
    eventId: string,
    orderNumber: string,
    rawPayload: any,
  ) {
    await this.db.withTransaction(async (tx) => {
      const pRes = await tx.query<{ id: string; status: string }>(
        'SELECT id, status FROM payments WHERE order_number = $1 FOR UPDATE',
        [orderNumber],
      );
      const pid = pRes.rowCount > 0 ? pRes.rows[0].id : null;
      await tx.query(
        `INSERT INTO payment_webhook_events (
           provider, provider_event_id, event_type, signature_verified, payment_id, raw_payload, processing_status
         ) VALUES ($1, $2, 'payment.failed', TRUE, $3, $4, 'PROCESSED')
         ON CONFLICT (provider, provider_event_id) DO NOTHING`,
        [provider, eventId, pid, JSON.stringify(rawPayload)],
      );
      if (pid && pRes.rows[0].status === 'PENDING') {
        await tx.query("UPDATE payments SET status = 'FAILED', updated_at = NOW() WHERE id = $1", [
          pid,
        ]);
      }
    });
  }

  private async fulfillVerifiedOrder(params: {
    provider: 'PAYHERE' | 'STRIPE';
    providerEventId: string;
    eventType: string;
    orderNumber: string;
    externalPaymentId: string;
    paidAmount: number;
    paidCurrency: string;
    rawPayload: any;
  }) {
    return this.db.withTransaction(async (tx) => {
      // 1. Check webhook idempotency table first
      const dupEvent = await tx.query(
        'SELECT id FROM payment_webhook_events WHERE provider = $1 AND provider_event_id = $2',
        [params.provider, params.providerEventId],
      );
      if (dupEvent.rowCount > 0) {
        return { received: true, duplicateIgnored: true };
      }

      // 2. Lock payment order row
      const pRes = await tx.query(
        'SELECT * FROM payments WHERE order_number = $1 FOR UPDATE',
        [params.orderNumber],
      );
      if (pRes.rowCount === 0) {
        throw new NotFoundException(`Order ${params.orderNumber} not found`);
      }
      const p = pRes.rows[0];

      // 3. Guard against duplicate fulfillment even across distinct webhook event IDs!
      if (p.status === 'SUCCEEDED') {
        await tx.query(
          `INSERT INTO payment_webhook_events (
             provider, provider_event_id, event_type, signature_verified, payment_id, raw_payload, processing_status
           ) VALUES ($1, $2, $3, TRUE, $4, $5, 'IGNORED_DUPLICATE')`,
          [
            params.provider,
            params.providerEventId,
            params.eventType,
            p.id,
            JSON.stringify(params.rawPayload),
          ],
        );
        return { received: true, duplicateIgnored: true };
      }

      // 4. Verify currency & amount match order to prevent amount-manipulation fraud
      const expectedAmount = Number(p.amount);
      if (
        p.currency !== params.paidCurrency ||
        Math.abs(expectedAmount - params.paidAmount) > 0.02
      ) {
        throw new BadRequestException(
          `Payment amount/currency mismatch: expected ${expectedAmount} ${p.currency}, got ${params.paidAmount} ${params.paidCurrency}`,
        );
      }

      const invoiceNumber = `INV-${params.orderNumber}`;
      const invoicePayload = {
        invoiceNumber,
        issuedAt: new Date().toISOString(),
        seller: 'NEXORA AI Platform',
        orderNumber: params.orderNumber,
        provider: params.provider,
        currency: p.currency,
        amountPaid: expectedAmount,
        amountUsd: Number(p.amount_usd),
        paymentType: p.payment_type,
        creditsGranted: Number(p.credits_to_grant),
        bonusCreditsGranted: Number(p.bonus_credits_to_grant),
      };

      await tx.query(
        `UPDATE payments
         SET status = 'SUCCEEDED',
             external_payment_id = $1,
             verified_by_webhook = TRUE,
             verified_at = NOW(),
             invoice_number = $2,
             invoice_payload = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [params.externalPaymentId, invoiceNumber, JSON.stringify(invoicePayload), p.id],
      );

      await tx.query(
        `INSERT INTO payment_webhook_events (
           provider, provider_event_id, event_type, signature_verified, payment_id, raw_payload, processing_status
         ) VALUES ($1, $2, $3, TRUE, $4, $5, 'PROCESSED')`,
        [
          params.provider,
          params.providerEventId,
          params.eventType,
          p.id,
          JSON.stringify(params.rawPayload),
        ],
      );

      // 5. Grant Credits OR Activate Subscription
      if (p.payment_type === 'CREDIT_PACKAGE') {
        await this.walletService.grantPurchasedCreditsTx(tx, {
          userId: p.user_id,
          purchasedCredits: Number(p.credits_to_grant),
          bonusCredits: Number(p.bonus_credits_to_grant),
          netCashUsd: Number(p.net_amount_usd),
          paymentId: p.id,
          idempotencyKey: `payment-fulfill:${p.id}`,
          description: `Purchased credit package (${params.orderNumber})`,
        });
      } else if (p.payment_type === 'SUBSCRIPTION' && p.subscription_plan_id) {
        const planRes = await tx.query(
          'SELECT * FROM subscription_plans WHERE id = $1',
          [p.subscription_plan_id],
        );
        const plan = planRes.rows[0];
        const days = plan.billing_interval === 'ANNUAL' ? 365 : 30;
        const periodEnd = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

        // Expire older active subscriptions for clean single active plan
        await tx.query(
          "UPDATE subscriptions SET status = 'CANCELED', updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'",
          [p.user_id],
        );

        const subIns = await tx.query<{ id: string }>(
          `INSERT INTO subscriptions (
             user_id, plan_id, status, payment_provider, external_subscription_id,
             currency, amount_paid, amount_paid_usd, current_period_start, current_period_end
           ) VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, NOW(), $8)
           RETURNING id`,
          [
            p.user_id,
            plan.id,
            params.provider,
            params.externalPaymentId,
            p.currency,
            expectedAmount,
            Number(p.amount_usd),
            periodEnd,
          ],
        );

        if (Number(p.bonus_credits_to_grant) > 0) {
          await this.walletService.grantBonusCreditsTx(tx, {
            userId: p.user_id,
            bonusCredits: Number(p.bonus_credits_to_grant),
            txType: 'SUBSCRIPTION_BONUS',
            referenceType: 'SUBSCRIPTION',
            referenceId: subIns.rows[0].id,
            idempotencyKey: `sub-bonus:${p.id}`,
            description: `${plan.name} subscription bonus credits`,
          });
        }
      }

      await tx.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata)
         VALUES ($1, 'BILLING', 'Payment Verified — Credits Added', $2, $3)`,
        [
          p.user_id,
          `Order ${params.orderNumber} (${expectedAmount} ${p.currency}) verified. Invoice ${invoiceNumber} generated.`,
          JSON.stringify({ paymentId: p.id, invoiceNumber }),
        ],
      );

      return {
        received: true,
        fulfilled: true,
        paymentId: p.id,
        invoiceNumber,
      };
    });
  }

  /**
   * Processes an audited payment refund, clawing back remaining unspent purchased credits safely.
   */
  async processRefund(paymentId: string, reason: string, actorUserId: string, actorRole: string) {
    return this.db.withTransaction(async (tx) => {
      const pRes = await tx.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (pRes.rowCount === 0) throw new NotFoundException('Payment not found');
      const p = pRes.rows[0];
      if (p.status !== 'SUCCEEDED') {
        throw new ConflictException(`Only SUCCEEDED payments can be refunded (current: ${p.status})`);
      }

      const wRes = await tx.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [
        p.user_id,
      ]);
      const w = wRes.rows[0];

      const purchasedGranted = Number(p.credits_to_grant);
      const bonusGranted = Number(p.bonus_credits_to_grant);
      const currentPurchased = Number(w.purchased_credits);
      const currentBonus = Number(w.bonus_credits);

      const clawbackPurchased = Math.min(currentPurchased, purchasedGranted);
      const clawbackBonus = Math.min(currentBonus, bonusGranted);
      const newPurchased = Math.max(0, Math.round((currentPurchased - clawbackPurchased) * 10000) / 10000);
      const newBonus = Math.max(0, Math.round((currentBonus - clawbackBonus) * 10000) / 10000);

      const currentLiability = Number(w.unearned_purchased_liability_usd);
      const liabilityReduction = Math.min(currentLiability, Number(p.net_amount_usd));
      const newLiability = Math.max(0, Math.round((currentLiability - liabilityReduction) * 1000000) / 1000000);

      await tx.query(
        `UPDATE wallets
         SET purchased_credits = $1,
             bonus_credits = $2,
             unearned_purchased_liability_usd = $3,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $4`,
        [newPurchased, newBonus, newLiability, w.id],
      );

      if (clawbackPurchased > 0 || clawbackBonus > 0) {
        await tx.query(
          `INSERT INTO wallet_transactions (
             wallet_id, user_id, tx_type, credit_bucket, amount,
             free_delta, purchased_delta, bonus_delta,
             balance_free_after, balance_purchased_after, balance_bonus_after,
             reference_type, reference_id, idempotency_key, description
           ) VALUES ($1, $2, 'PAYMENT_REFUND_DEBIT', 'MIXED', $3, 0, $4, $5, $6, $7, $8, 'PAYMENT_REFUND', $9, $10, $11)`,
          [
            w.id,
            p.user_id,
            -(clawbackPurchased + clawbackBonus),
            -clawbackPurchased,
            -clawbackBonus,
            Number(w.free_credits),
            newPurchased,
            newBonus,
            p.id,
            `payment-refund:${p.id}`,
            `Credit clawback for refunded payment ${p.order_number}: ${reason}`,
          ],
        );
      }

      if (p.payment_type === 'SUBSCRIPTION') {
        await tx.query(
          "UPDATE subscriptions SET status = 'CANCELED', canceled_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'",
          [p.user_id],
        );
      }

      await tx.query(
        `UPDATE payments
         SET status = 'REFUNDED',
             refunded_amount_usd = amount_usd,
             refunded_credits_debited = $1,
             refund_reason = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [clawbackPurchased + clawbackBonus, reason, p.id],
      );

      await tx.query(
        `INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, after_state)
         VALUES ($1, $2, 'PAYMENT_REFUNDED', 'PAYMENT', $3, $4)`,
        [
          actorUserId,
          actorRole,
          p.id,
          JSON.stringify({
            orderNumber: p.order_number,
            refundedUsd: Number(p.amount_usd),
            clawbackPurchased,
            clawbackBonus,
            reason,
          }),
        ],
      );

      return {
        refunded: true,
        paymentId: p.id,
        orderNumber: p.order_number,
        refundedAmountUsd: Number(p.amount_usd),
        creditsClawedBack: clawbackPurchased + clawbackBonus,
      };
    });
  }

  async listUserPayments(userId: string) {
    const res = await this.db.query(
      `SELECT id, order_number, payment_type, provider, currency, amount, amount_usd,
              credits_to_grant, bonus_credits_to_grant, status, refunded_amount_usd,
              invoice_number, invoice_payload, verified_by_webhook, verified_at, created_at
       FROM payments
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );
    return res.rows.map((p) => ({
      ...p,
      amount: Number(p.amount),
      amount_usd: Number(p.amount_usd),
      credits_to_grant: Number(p.credits_to_grant),
      bonus_credits_to_grant: Number(p.bonus_credits_to_grant),
      refunded_amount_usd: Number(p.refunded_amount_usd),
    }));
  }
}

@ApiTags('Payments, Subscriptions, Invoices & Verified Webhooks')
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsAndSubscriptionsService)
    private readonly paymentsService: PaymentsAndSubscriptionsService,
  ) {}

  @Public()
  @Get('catalog')
  @ApiOperation({ summary: 'List active Credit Packages and Subscription Plans (LKR & USD)' })
  async getCatalog() {
    return this.paymentsService.listCatalog();
  }

  @ApiBearerAuth()
  @Get('subscription')
  @ApiOperation({ summary: 'Get authenticated user active subscription' })
  async getSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getUserActiveSubscription(user.id);
  }

  @ApiBearerAuth()
  @Post('subscription/:id/cancel')
  @ApiOperation({ summary: 'Cancel subscription renewal at period end' })
  async cancelSub(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.paymentsService.cancelSubscriptionAtPeriodEnd(user.id, id);
  }

  @ApiBearerAuth()
  @Post('checkout')
  @ApiOperation({ summary: 'Create PayHere (Sri Lanka LKR) or Stripe (International) checkout order' })
  async createCheckout(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.paymentsService.createCheckoutOrder(user.id, body || {});
  }

  @ApiBearerAuth()
  @Post(':id/client-return')
  @ApiOperation({
    summary:
      'Check backend payment verification status after frontend redirect (NEVER grants credits directly)',
  })
  async clientReturn(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.paymentsService.verifyClientReturnStatus(user.id, id);
  }

  @ApiBearerAuth()
  @Get('history')
  @ApiOperation({ summary: 'List payment history and downloadable invoice records' })
  async history(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.listUserPayments(user.id);
  }

  @Public()
  @Post('webhooks/payhere')
  @ApiOperation({ summary: 'PayHere server-to-server notify_url webhook (MD5 verified)' })
  async payhereWebhook(@Body() body: any) {
    return this.paymentsService.handlePayHereWebhook(body || {});
  }

  @Public()
  @Post('webhooks/stripe')
  @ApiOperation({ summary: 'Stripe server-to-server webhook (HMAC-SHA256 verified)' })
  async stripeWebhook(
    @Req() req: any,
    @Body() body: any,
    @Headers('stripe-signature') sig: string,
  ) {
    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : req.rawBody instanceof Buffer
          ? req.rawBody.toString('utf8')
          : JSON.stringify(body);
    return this.paymentsService.handleStripeWebhook(raw, sig);
  }
}

@Module({
  imports: [WalletModule],
  providers: [PaymentsAndSubscriptionsService],
  controllers: [PaymentsController],
  exports: [PaymentsAndSubscriptionsService],
})
export class PaymentsModule {}
