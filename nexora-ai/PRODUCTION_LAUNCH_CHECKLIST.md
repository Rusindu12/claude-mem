# NEXORA AI — Production Launch Checklist

Use this sign-off checklist prior to opening public traffic and Google Play distribution.

## 1. Security & Secrets Hygiene
- [ ] Generated unique 64-character random values for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `MASTER_ENCRYPTION_KEY` (`openssl rand -hex 32`).
- [ ] Changed `OWNER_BOOTSTRAP_PASSWORD` from default development credentials and verified `X-Confirm-Password` step-up enforcement on `/api/v1/admin/providers/*`, `/roles/assign`, and `/system/settings/*`.
- [ ] Confirmed `nexora-ai/mobile` contains **only** `EXPO_PUBLIC_API_URL` and zero private AI/payment keys (`grep -rn "sk-" nexora-ai/mobile` returns nothing).
- [ ] Enabled HTTPS / TLS 1.2+ on `api.nexora.ai` and `app.nexora.ai` with HSTS.

## 2. Database, Wallet & Accounting Integrity
- [ ] Applied PostgreSQL 16 migrations (`001`..`006`) via `npm run db:migrate` against managed production PostgreSQL.
- [ ] Verified `trg_wallet_transactions_immutable` and `trg_admin_audit_logs_immutable` triggers reject `UPDATE`/`DELETE`.
- [ ] Verified `daily_credit_claims` enforces `Asia/Colombo` single claim per user per calendar day without resetting `purchased_credits` or `bonus_credits`.
- [ ] Verified `/api/v1/admin/analytics` separates `totalFutureServiceObligationUsd` (unspent purchased credits + unearned subscription period) from `totalRealizedRevenueUsd` and `netProfitUsd`.

## 3. Multi-Provider AI & Cost Controls
- [ ] Entered production API keys for at least 2 AI providers (e.g., OpenAI + Google Gemini or Anthropic) in the Owner Governance Dashboard.
- [ ] Configured `daily_budget_limit_usd`, `monthly_budget_limit_usd`, `alert_threshold_percent`, and `auto_disable_expensive_on_limit` per provider.
- [ ] Verified explicit Fallback Notification banner appears in chat whenever failover occurs.

## 4. Payments & Webhook Verification
- [ ] Configured PayHere live `merchant_id`, `merchant_secret`, and `notify_url` (`https://api.nexora.ai/api/v1/payments/webhooks/payhere`) for Sri Lankan LKR payments.
- [ ] Configured Stripe live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`https://api.nexora.ai/api/v1/payments/webhooks/stripe`) for USD/EUR/GBP payments.
- [ ] Executed a real low-value test purchase in LKR and USD, confirming credits allocate **only** upon verified webhook receipt and an invoice is generated.

## 5. Automated QA, Load Testing & Backups
- [ ] `cd nexora-ai/backend && npm test` passes **8/8** E2E suites (auth, Colombo daily credits, RBAC step-up, AI failover, PayHere/Stripe webhooks, GAAP liability, concurrency, isolation).
- [ ] `cd nexora-ai/backend && npm run test:load` passes concurrent burst test with `0` server errors.
- [ ] Scheduled `infra/scripts/backup_postgres.sh` off-site encrypted backups and completed at least one test restore.
- [ ] Built and smoke-tested signed Android `.apk` / `.aab` on physical Android hardware in both English and Sinhala (`සිංහල`) and Dark/Light themes.
