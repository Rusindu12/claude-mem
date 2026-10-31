import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as http from 'http';
import * as crypto from 'crypto';
import { createRequire } from 'module';
import { INestApplication } from '@nestjs/common';

const cjsRequire = createRequire(__filename);
const { createNexoraApp } = cjsRequire('../dist/main');
const { DatabaseService } = cjsRequire('../dist/database/database.service');
const { WalletService } = cjsRequire('../dist/modules/wallet/wallet.service');

describe('NEXORA AI — Full Commercial Platform E2E, Security & Concurrency Suite', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let walletService: WalletService;

  // Ephemeral local HTTP servers speaking real OpenAI & Gemini wire protocols
  let mockOpenAiServer: http.Server;
  let mockOpenAiPort = 0;
  let openAiShouldFail = false;

  let mockGeminiServer: http.Server;
  let mockGeminiPort = 0;

  const ownerEmail = 'owner@nexora.ai';
  const ownerPassword = 'NexoraOwner#2026!';
  const payhereSecret = 'test_payhere_merchant_secret_lk_2026';
  const stripeWebhookSecret = 'whsec_test_nexora_intl_2026';

  let ownerAccessToken = '';
  let userAAccessToken = '';
  let userARefreshToken = '';
  let userAId = '';
  let userAReferralCode = '';

  let userBAccessToken = '';
  let userBId = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'pglite://memory';
    process.env.REDIS_URL = 'embedded';
    process.env.OWNER_BOOTSTRAP_EMAIL = ownerEmail;
    process.env.OWNER_BOOTSTRAP_PASSWORD = ownerPassword;
    process.env.PAYHERE_MERCHANT_ID = '1219999';
    process.env.PAYHERE_MERCHANT_SECRET = payhereSecret;
    process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;

    // Start local OpenAI-protocol test upstream
    mockOpenAiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (openAiShouldFail) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Upstream OpenAI capacity overloaded' } }));
          return;
        }
        if (req.url?.includes('/images/generations')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              data: [{ url: 'https://cdn.nexora.ai/generated/sample-image-1.png' }],
            }),
          );
          return;
        }
        const parsed = JSON.parse(body || '{}');
        if (parsed.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'ආයුබෝවන්! ' } }] })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Welcome to NEXORA AI.' } }], usage: { prompt_tokens: 42, completion_tokens: 18 } })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'OpenAI primary response: Intelligence Without Limits.',
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 25 },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      mockOpenAiServer.listen(0, '127.0.0.1', () => {
        mockOpenAiPort = (mockOpenAiServer.address() as any).port;
        resolve();
      });
    });

    // Start local Gemini-protocol test upstream
    mockGeminiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Gemini fallback response: ආයුබෝවන් from NEXORA failover!' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 48,
              candidatesTokenCount: 22,
            },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      mockGeminiServer.listen(0, '127.0.0.1', () => {
        mockGeminiPort = (mockGeminiServer.address() as any).port;
        resolve();
      });
    });

    app = await createNexoraApp();
    await app.init();
    db = app.get(DatabaseService, { strict: false });
    walletService = app.get(WalletService, { strict: false });
  });

  afterAll(async () => {
    await app?.close();
    mockOpenAiServer?.close();
    mockGeminiServer?.close();
  });

  it('1. Health check & Prometheus metrics expose operational telemetry', async () => {
    const h = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(h.body.status).toBe('healthy');
    expect(h.body.tagline).toBe('INTELLIGENCE WITHOUT LIMITS');

    const m = await request(app.getHttpServer()).get('/api/v1/health/metrics').expect(200);
    expect(m.text).toContain('nexora_users_total');
  });

  it('2. Registration, Referral Rewards, Login & Refresh-Token Reuse Security', async () => {
    // Register User A
    const regA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'kasun@example.lk',
        password: 'StrongPassword#2026',
        fullName: 'Kasun Perera',
        countryCode: 'LK',
        preferredLanguage: 'si',
      })
      .expect(201);

    expect(regA.body.accessToken).toBeTruthy();
    expect(regA.body.user.preferredLanguage).toBe('si');
    expect(regA.body.wallet.freeCredits).toBe(25);
    expect(regA.body.wallet.bonusCredits).toBe(50);

    userAAccessToken = regA.body.accessToken;
    userARefreshToken = regA.body.refreshToken;
    userAId = regA.body.user.id;
    userAReferralCode = regA.body.user.referralCode;

    // Register User B using User A's referral code
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'amaya@example.lk',
        password: 'StrongPassword#2026',
        fullName: 'Amaya Silva',
        referralCode: userAReferralCode,
      })
      .expect(201);

    userBAccessToken = regB.body.accessToken;
    userBId = regB.body.user.id;
    // User B gets 50 signup + 30 referred bonus = 80 bonus credits
    expect(regB.body.wallet.bonusCredits).toBe(80);

    // User A earned +40 referrer bonus credits -> 90 bonus credits
    const walletA = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(200);
    expect(walletA.body.bonusCredits).toBe(90);

    // Rotate User A refresh token
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: userARefreshToken })
      .expect(201);
    expect(rotated.body.refreshToken).not.toBe(userARefreshToken);

    // Replaying old rotated refresh token triggers token-family reuse revocation!
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: userARefreshToken })
      .expect(401);

    // Re-login cleanly after family revocation
    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'kasun@example.lk', password: 'StrongPassword#2026' })
      .expect(201);
    userAAccessToken = relogin.body.accessToken;
  });

  it('3. Daily Free Credits: one claim per Colombo calendar day & preserves purchased/bonus on rollover', async () => {
    // Already claimed today during signup -> second claim on same Colombo day must return 409 Conflict
    await request(app.getHttpServer())
      .post('/api/v1/wallet/claim-daily')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(409);

    // Simulate next Colombo calendar day (+24h): expires remaining free credits & renews 25, keeping 90 bonus untouched!
    const tomorrowColombo = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const nextDay = await walletService.claimDailyFreeCredits(
      userAId,
      '127.0.0.1',
      'test-device',
      tomorrowColombo,
    );
    expect(nextDay.creditsGranted).toBe(25);
    expect(nextDay.previousFreeExpired).toBe(25);
    expect(nextDay.wallet.freeCredits).toBe(25);
    expect(nextDay.wallet.bonusCredits).toBe(90);
  });

  it('4. Owner RBAC, Step-Up Password Protection & Encrypted Provider Credential Configuration', async () => {
    // Login as Platform Owner
    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: ownerPassword })
      .expect(201);
    ownerAccessToken = ownerLogin.body.accessToken;

    // Normal User MUST be blocked from Admin/Owner endpoints (403 Forbidden)
    await request(app.getHttpServer())
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(403);

    // List providers as Owner
    const provList = await request(app.getHttpServer())
      .get('/api/v1/admin/providers')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);

    const pollFreeProv = provList.body.providers.find((p: any) => p.code === 'pollinations_free');
    const openRouterProv = provList.body.providers.find((p: any) => p.code === 'openrouter_oss');
    const openAiProv = provList.body.providers.find((p: any) => p.code === 'openai');
    const geminiProv = provList.body.providers.find((p: any) => p.code === 'gemini');

    // Out of the box: Free-AI-Only Launch Mode is ACTIVE, Zero-Key Free AI is ready, OpenRouter is Free-Only, and Paid models are LOCKED!
    expect(pollFreeProv.isFreeProvider).toBe(true);
    expect(pollFreeProv.requiresApiKey).toBe(false);
    expect(pollFreeProv.hasApiKeyConfigured).toBe(true);
    expect(openRouterProv.isFreeProvider).toBe(true);

    // Configure OpenRouter key and verify ONLY :free models are enabled & $0 max_price guard works
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/providers/${openRouterProv.id}/credentials`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Confirm-Password', ownerPassword)
      .send({
        apiKey: 'sk-or-v1-test-openrouter-free-only-key',
        baseUrl: `http://127.0.0.1:${mockOpenAiPort}/v1`,
        isEnabled: true,
      })
      .expect(200);

    const bootModels = await request(app.getHttpServer())
      .get('/api/v1/chat/models')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(200);
    const openRouterModels = bootModels.body.filter((m: any) => m.providerCode === 'openrouter_oss');
    expect(openRouterModels.length).toBeGreaterThanOrEqual(6);
    for (const orm of openRouterModels) {
      expect(orm.modelKey === 'openrouter/free' || orm.modelKey.endsWith(':free')).toBe(true);
      expect(orm.isFreeModel).toBe(true);
      expect(orm.isAvailableNow).toBe(true);
    }

    const freeChatModel = bootModels.body.find(
      (m: any) => m.providerCode === 'openrouter_oss' && m.modelKey === 'openrouter/free',
    );
    const paidGptOnBoot = bootModels.body.find((m: any) => m.modelKey === 'gpt-4o-mini');
    expect(freeChatModel.isAvailableNow).toBe(true);
    expect(freeChatModel.isFreeModel).toBe(true);
    expect(paidGptOnBoot.isAvailableNow).toBe(false);
    expect(paidGptOnBoot.unavailableReason).toContain('Free-AI-Only Launch Mode');

    // Execute a Zero-Key Free AI chat turn and verify $0.00 provider USD cost!
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/providers/${pollFreeProv.id}/credentials`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Confirm-Password', ownerPassword)
      .send({ baseUrl: `http://127.0.0.1:${mockOpenAiPort}/v1`, isEnabled: true })
      .expect(200);

    const freeConv = await request(app.getHttpServer())
      .post('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ title: 'Zero-Cost Free AI Test', mode: 'CHAT', selectedModelId: freeChatModel.id })
      .expect(201);

    const freeTurn = await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${freeConv.body.id}/messages`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ content: 'Hello Free AI!', modelId: freeChatModel.id })
      .expect(201);
    expect(freeTurn.body.assistantMessage.content).toContain('Welcome to NEXORA AI');

    const analyticsInFreeMode = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(analyticsInFreeMode.body.apiCostSettlementFromPayments.freeAiOnlyMode).toBe(true);
    expect(analyticsInFreeMode.body.summary.aiApiExpensesUsd).toBe(0);

    // Owner now unlocks Paid + Free Hybrid Mode (using X-Confirm-Password) to test paid providers too
    await request(app.getHttpServer())
      .patch('/api/v1/admin/system/settings/platform.free_ai_only_mode')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Confirm-Password', ownerPassword)
      .send({ value: { enabled: false } })
      .expect(200);

    // Sensitive Owner action WITHOUT X-Confirm-Password must fail with 403
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/providers/${openAiProv.id}/credentials`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ apiKey: 'sk-live-openai-secret-key-123456' })
      .expect(403);

    // With valid X-Confirm-Password, credentials are encrypted in DB and masked in response
    const updOpenAi = await request(app.getHttpServer())
      .patch(`/api/v1/admin/providers/${openAiProv.id}/credentials`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Confirm-Password', ownerPassword)
      .send({
        apiKey: 'sk-live-openai-secret-key-123456',
        baseUrl: `http://127.0.0.1:${mockOpenAiPort}/v1`,
        isEnabled: true,
      })
      .expect(200);
    expect(updOpenAi.body.hasApiKeyConfigured).toBe(true);
    expect(updOpenAi.body.maskedApiKey).toContain('••••');
    expect(updOpenAi.body.maskedApiKey).not.toContain('secret-key');

    // Configure Gemini fallback upstream
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/providers/${geminiProv.id}/credentials`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .set('X-Confirm-Password', ownerPassword)
      .send({
        apiKey: 'AIzaSyTestGeminiKey987654321',
        baseUrl: `http://127.0.0.1:${mockGeminiPort}/v1beta`,
      })
      .expect(200);
  });

  it('5. AI Chat, Streaming SSE, Credit Reservation -> Settlement -> Release & Automatic Fallback Alert', async () => {
    const modelsRes = await request(app.getHttpServer())
      .get('/api/v1/chat/models')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(200);
    const gpt4oMini = modelsRes.body.find((m: any) => m.modelKey === 'gpt-4o-mini');
    expect(gpt4oMini.isAvailableNow).toBe(true);

    // Create conversation
    const convRes = await request(app.getHttpServer())
      .post('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ title: 'Sinhala Architecture Chat', mode: 'CHAT', selectedModelId: gpt4oMini.id, language: 'si' })
      .expect(201);
    const convId = convRes.body.id;

    // Send non-streaming chat message
    const msgRes = await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ content: 'Explain microservices in Sinhala and English.' })
      .expect(201);

    expect(msgRes.body.assistantMessage.content).toContain('Welcome to NEXORA AI');
    expect(msgRes.body.assistantMessage.fallbackUsed).toBe(false);
    expect(msgRes.body.assistantMessage.usage.creditsCharged).toBeGreaterThan(0);

    // Test SSE streaming endpoint
    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${convId}/stream`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ content: 'Stream a Sinhala greeting!' })
      .expect(201);
    expect(streamRes.text).toContain('event: delta');
    expect(streamRes.text).toContain('ආයුබෝවන්!');
    expect(streamRes.text).toContain('event: completed');

    // Simulate OpenAI outage -> verify automatic fallback to Gemini WITH EXPLICIT FALLBACK NOTICE!
    openAiShouldFail = true;
    const fallbackRes = await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ content: 'Test resilient failover', modelId: gpt4oMini.id })
      .expect(201);

    expect(fallbackRes.body.assistantMessage.fallbackUsed).toBe(true);
    expect(fallbackRes.body.assistantMessage.executedModel.modelKey).toBe('gemini-2.5-flash');
    expect(fallbackRes.body.assistantMessage.fallbackNotice).toBeTruthy();
    expect(fallbackRes.body.assistantMessage.fallbackNotice.requestedModel).toBe('GPT-4o Mini');

    // When allowFallback = false, NEVER switch models and REFUND 100% of reserved credits!
    const walletBeforeFail = await walletService.getWalletSummary(userAId);
    await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ content: 'Strict model lock test', modelId: gpt4oMini.id, allowFallback: false })
      .expect(502);

    const walletAfterFail = await walletService.getWalletSummary(userAId);
    expect(walletAfterFail.totalAvailableCredits).toBeCloseTo(walletBeforeFail.totalAvailableCredits, 4);
    expect(walletAfterFail.reservedCredits).toBe(0);
    openAiShouldFail = false;

    // User Data Isolation: User B MUST receive 404 when accessing or deleting User A's conversation!
    await request(app.getHttpServer())
      .get(`/api/v1/chat/conversations/${convId}`)
      .set('Authorization', `Bearer ${userBAccessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/chat/conversations/${convId}`)
      .set('Authorization', `Bearer ${userBAccessToken}`)
      .expect(404);
  });

  it('6. Payments (Sri Lanka PayHere LKR + International Stripe USD), Webhook Security, Refunds & GAAP Deferred Liability', async () => {
    const catalog = await request(app.getHttpServer()).get('/api/v1/payments/catalog').expect(200);
    const starterPkg = catalog.body.creditPackages.find((p: any) => p.code === 'STARTER');

    // Initiate Sri Lanka LKR PayHere Checkout
    const checkout = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({
        paymentType: 'CREDIT_PACKAGE',
        packageId: starterPkg.id,
        provider: 'PAYHERE',
        currency: 'LKR',
      })
      .expect(201);

    expect(checkout.body.status).toBe('PENDING');

    // Client return check MUST NOT allocate credits!
    const clientReturn = await request(app.getHttpServer())
      .post(`/api/v1/payments/${checkout.body.paymentId}/client-return`)
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(201);
    expect(clientReturn.body.creditsAllocated).toBe(false);

    const wBefore = await walletService.getWalletSummary(userAId);
    expect(wBefore.purchasedCredits).toBe(0);

    // Forged PayHere signature MUST be rejected with 401
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/payhere')
      .send({
        merchant_id: '1219999',
        order_id: checkout.body.orderNumber,
        payment_id: 'PH_998877',
        payhere_amount: '1500.00',
        payhere_currency: 'LKR',
        status_code: '2',
        md5sig: 'FORGED_SIGNATURE_12345',
      })
      .expect(401);

    // Authentic PayHere MD5 signature fulfills order & allocates 500 purchased credits
    const secretMd5 = crypto.createHash('md5').update(payhereSecret).digest('hex').toUpperCase();
    const validMd5Sig = crypto
      .createHash('md5')
      .update(`1219999${checkout.body.orderNumber}1500.00LKR2${secretMd5}`)
      .digest('hex')
      .toUpperCase();

    const whOk = await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/payhere')
      .send({
        merchant_id: '1219999',
        order_id: checkout.body.orderNumber,
        payment_id: 'PH_998877',
        payhere_amount: '1500.00',
        payhere_currency: 'LKR',
        status_code: '2',
        md5sig: validMd5Sig,
      })
      .expect(201);
    expect(whOk.body.fulfilled).toBe(true);

    // Duplicate replay of exact same webhook MUST be ignored idempotently!
    const whDup = await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/payhere')
      .send({
        merchant_id: '1219999',
        order_id: checkout.body.orderNumber,
        payment_id: 'PH_998877',
        payhere_amount: '1500.00',
        payhere_currency: 'LKR',
        status_code: '2',
        md5sig: validMd5Sig,
      })
      .expect(201);
    expect(whDup.body.duplicateIgnored).toBe(true);

    const wAfter = await walletService.getWalletSummary(userAId);
    expect(wAfter.purchasedCredits).toBe(500);
    expect(wAfter.unearnedPurchasedLiabilityUsd).toBeGreaterThan(4.5);

    // Check GAAP Business Analytics: unspent purchased credits are tracked in unearnedCreditLiabilityUsd, NOT realized revenue!
    const analytics = await request(app.getHttpServer())
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(analytics.body.summary.creditSalesUsd).toBeCloseTo(4.99, 2);
    expect(analytics.body.summary.unearnedCreditLiabilityUsd).toBeGreaterThan(4.5);
    expect(analytics.body.summary.realizedCreditRevenueUsd).toBe(0);
    expect(analytics.body.apiCostSettlementFromPayments).toBeDefined();
    expect(analytics.body.apiCostSettlementFromPayments.netPaymentsAfterGatewayFeesUsd).toBeGreaterThan(4.5);
    expect(analytics.body.apiCostSettlementFromPayments.aiApiCostDeductedUsd).toBeGreaterThan(0);
    expect(analytics.body.apiCostSettlementFromPayments.ownerNetAfterApiCostLkr).toBeGreaterThan(1000);

    // Test Stripe International Subscription Checkout + HMAC-SHA256 Webhook
    const businessPlan = catalog.body.subscriptionPlans.find((s: any) => s.code === 'BUSINESS');
    const subCheckout = await request(app.getHttpServer())
      .post('/api/v1/payments/checkout')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({
        paymentType: 'SUBSCRIPTION',
        planId: businessPlan.id,
        provider: 'STRIPE',
        currency: 'USD',
      })
      .expect(201);

    const stripeEventPayload = JSON.stringify({
      id: 'evt_stripe_live_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_live_001',
          payment_intent: 'pi_live_001',
          client_reference_id: subCheckout.body.orderNumber,
          amount_total: Math.round(subCheckout.body.amount * 100),
          currency: 'usd',
          metadata: { order_number: subCheckout.body.orderNumber },
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const hmac = crypto
      .createHmac('sha256', stripeWebhookSecret)
      .update(`${ts}.${stripeEventPayload}`, 'utf8')
      .digest('hex');

    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', `t=${ts},v1=${hmac}`)
      .send(stripeEventPayload)
      .expect(201);

    // User A is now on BUSINESS plan -> can create a Business API key and call AI via X-API-Key!
    const apiKeyRes = await request(app.getHttpServer())
      .post('/api/v1/platform/api-keys')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({ name: 'ERP Integration Key' })
      .expect(201);
    expect(apiKeyRes.body.apiKey).toMatch(/^nxr_live_/);

    const bizToolCall = await request(app.getHttpServer())
      .post('/api/v1/chat/tools/execute')
      .set('X-API-Key', apiKeyRes.body.apiKey)
      .send({ mode: 'TRANSLATION', targetLanguage: 'si', prompt: 'Hello Sri Lanka' })
      .expect(201);
    expect(bizToolCall.body.assistantMessage.content).toBeTruthy();

    // Process Refund on the PayHere credit package order -> claws back 500 purchased credits!
    const refundRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${checkout.body.paymentId}/refund`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ reason: 'Customer requested package refund' })
      .expect(201);
    expect(refundRes.body.refunded).toBe(true);
    expect(refundRes.body.creditsClawedBack).toBe(500);

    const wPostRefund = await walletService.getWalletSummary(userAId);
    expect(wPostRefund.purchasedCredits).toBe(0);
  });

  it('7. Concurrent Atomic Credit Reservations & Immutable PostgreSQL Ledger Triggers', async () => {
    // Register fresh User C with exactly 100 total credits (25 free + 50 welcome bonus + redeem 0 -> let's check exact balance = 75)
    const regC = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'concurrency@example.lk',
        password: 'StrongPassword#2026',
        fullName: 'Concurrency Tester',
      })
      .expect(201);
    const userCId = regC.body.user.id;
    expect(regC.body.wallet.totalAvailableCredits).toBe(75);

    // Fire 20 simultaneous 15-credit reservations against 75 available credits!
    // Exactly 5 MUST succeed (5 * 15 = 75), and 15 MUST fail with 402 INSUFFICIENT_CREDITS!
    const attempts = Array.from({ length: 20 }, (_, i) =>
      walletService
        .reserveCredits({
          userId: userCId,
          amount: 15,
          taskType: 'CONCURRENT_STRESS_TEST',
          idempotencyKey: `conc-stress-${i}`,
        })
        .then(() => 'OK')
        .catch((err) => (err?.status === 402 ? 'INSUFFICIENT' : 'ERR')),
    );

    const outcomes = await Promise.all(attempts);
    const succeeded = outcomes.filter((o) => o === 'OK').length;
    const rejected = outcomes.filter((o) => o === 'INSUFFICIENT').length;

    expect(succeeded).toBe(5);
    expect(rejected).toBe(15);

    const finalWalletC = await walletService.getWalletSummary(userCId);
    expect(finalWalletC.freeCredits).toBe(0);
    expect(finalWalletC.bonusCredits).toBe(0);
    expect(finalWalletC.purchasedCredits).toBe(0);
    expect(finalWalletC.totalAvailableCredits).toBe(0);
    expect(finalWalletC.reservedCredits).toBe(75);

    // Verify PostgreSQL database trigger strictly blocks mutating or deleting wallet_transactions & admin_audit_logs!
    await expect(
      db.query("DELETE FROM wallet_transactions WHERE tx_type = 'RESERVE'"),
    ).rejects.toThrow(/strictly immutable/i);

    await expect(db.query('DELETE FROM admin_audit_logs')).rejects.toThrow(/strictly immutable/i);
  });

  it('8. Document Upload Isolation, Async Image Job Worker, Password Recovery & Budget Reconciliation', async () => {
    // 1. Secure Document Upload + User Isolation
    const docB64 = Buffer.from('NEXORA Quarterly Strategy: Expand Sinhala AI education across Sri Lanka.').toString('base64');
    const upRes = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({
        filename: 'strategy.txt',
        mimeType: 'text/plain',
        contentBase64: docB64,
        purpose: 'DOCUMENT_ANALYSIS',
      })
      .expect(201);
    expect(upRes.body.hasExtractedText).toBe(true);

    // User B cannot delete User A's file
    await request(app.getHttpServer())
      .delete(`/api/v1/files/${upRes.body.id}`)
      .set('Authorization', `Bearer ${userBAccessToken}`)
      .expect(404);

    // Document Analysis AI call
    const docAi = await request(app.getHttpServer())
      .post('/api/v1/chat/tools/execute')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({
        mode: 'DOCUMENT',
        prompt: 'Summarize the attached strategy document.',
        fileId: upRes.body.id,
      })
      .expect(201);
    expect(docAi.body.assistantMessage.content).toBeTruthy();

    // 2. Async Image Generation Job via Queue Worker
    const caps = await request(app.getHttpServer())
      .get('/api/v1/media/capabilities')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .expect(200);
    expect(caps.body.imageGenerationAvailable).toBe(true);

    const imgJob = await request(app.getHttpServer())
      .post('/api/v1/media/images')
      .set('Authorization', `Bearer ${userAAccessToken}`)
      .send({
        operation: 'TEXT_TO_IMAGE',
        prompt: 'Futuristic Colombo skyline at night with neon purple lights',
        count: 1,
      })
      .expect(201);
    expect(imgJob.body.jobId).toBeTruthy();

    // Poll background worker completion
    let jobStatus: any = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 80));
      const poll = await request(app.getHttpServer())
        .get(`/api/v1/media/jobs/${imgJob.body.jobId}`)
        .set('Authorization', `Bearer ${userAAccessToken}`)
        .expect(200);
      jobStatus = poll.body;
      if (jobStatus.status === 'SUCCEEDED' || jobStatus.status === 'FAILED') break;
    }
    expect(jobStatus.status).toBe('SUCCEEDED');
    expect(jobStatus.output_urls.length).toBeGreaterThan(0);
    expect(jobStatus.actual_credits).toBe(5); // Flux Free Image Studio default (5 credits, $0.00 owner cost)

    // 3. Password Recovery Flow
    const forgot = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'amaya@example.lk' })
      .expect(201);
    expect(forgot.body.devResetToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: forgot.body.devResetToken, newPassword: 'NewSecurePassword#2026' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'amaya@example.lk', password: 'NewSecurePassword#2026' })
      .expect(201);

    // 4. Provider Billing Reconciliation & Audit Trail
    const provs = await request(app.getHttpServer())
      .get('/api/v1/admin/providers')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    const openAi = provs.body.providers.find((p: any) => p.code === 'openai');

    const rec = await request(app.getHttpServer())
      .post(`/api/v1/admin/providers/${openAi.id}/reconcile`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ providerReportedMonthUsd: 0.05 })
      .expect(201);
    expect(rec.body.providerReportedMonthUsd).toBe(0.05);

    const audits = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(audits.body.length).toBeGreaterThanOrEqual(3);
  });
});
