# NEXORA AI — Production API Documentation (`v1.0.0`)

**Base URL:** `/api/v1` (Interactive OpenAPI / Swagger UI served at `/api/docs`)
**Real-Time Gateway:** Socket.IO WebSocket at `/ws` & Server-Sent Events (SSE) at `/api/v1/chat/conversations/:id/stream`

---

## 1. Authentication & Security Headers

| Header | Purpose |
|---|---|
| `Authorization: Bearer <accessToken>` | 15-minute signed JWT for Android & Web user sessions |
| `X-API-Key: nxr_live_...` | Hashed Business / Enterprise programmatic API key |
| `X-Confirm-Password: <ownerPassword>` | Step-up re-authentication required on sensitive `@RequireOwnerStepUp()` routes |
| `Stripe-Signature: t=...,v1=...` | Cryptographic HMAC-SHA256 signature verified against raw request bytes |

---

## 2. IAM, Sessions & Profile (`/api/v1/auth`)

- `POST /api/v1/auth/register` — Creates user, 3-balance `wallets` row, initial Colombo daily free credits, and processes optional `referralCode` atomically.
- `POST /api/v1/auth/login` — Brute-force-protected login (auto-locks after 5 failed attempts); returns `accessToken` + rotating `refreshToken`.
- `POST /api/v1/auth/refresh` — Rotates `refreshToken`; detects stolen/replayed refresh tokens and revokes the entire session family immediately.
- `POST /api/v1/auth/logout` — Revokes current device session or all active devices (`{ "allDevices": true }`).
- `POST /api/v1/auth/forgot-password` — Issues single-use SHA-256 hashed recovery token (30-minute expiry).
- `POST /api/v1/auth/reset-password` — Consumes recovery token, updates bcrypt hash, and revokes all prior sessions.
- `POST /api/v1/auth/change-password` — Authenticated password change.
- `GET /api/v1/auth/me` & `PATCH /api/v1/auth/me` — Read/update profile, `preferredLanguage` (`en` | `si`), `themePreference` (`dark` | `light`), and privacy settings.

---

## 3. 3-Bucket Token Credit Wallet (`/api/v1/wallet`)

- `GET /api/v1/wallet` — Returns `freeCredits`, `purchasedCredits`, `bonusCredits`, `reservedCredits`, `totalAvailableCredits`, `colomboToday` (`Asia/Colombo`), and `canClaimDailyToday`.
- `POST /api/v1/wallet/claim-daily` — Enforces `UNIQUE (user_id, claimed_date_colombo)` so each user can claim daily free credits **at most once per Colombo calendar day**, without ever touching `purchased_credits` or `bonus_credits`.
- `GET /api/v1/wallet/transactions` — Paginated read of the append-only `wallet_transactions` ledger (protected by PostgreSQL immutability trigger `trg_wallet_transactions_immutable`).

---

## 4. Multi-Model AI Chat, Streaming & Tools (`/api/v1/chat`)

- `GET /api/v1/chat/models` — Dynamic catalog of enabled models (`OpenAI`, `Google Gemini`, `Anthropic Claude`, `OpenAI-Compatible OSS`), live health status, context window, Sinhala/Vision flags, and exact credit pricing.
- `POST /api/v1/chat/estimate` — Pre-flight token & credit cost estimator (`{ modelId, taskType, prompt }`).
- `GET /api/v1/chat/conversations` & `POST /api/v1/chat/conversations` — List/search (`?q=`) and create conversations.
- `GET / PATCH / DELETE /api/v1/chat/conversations/:id` — Fetch messages, rename/pin, or soft-delete a conversation (strictly scoped to `user_id`).
- `POST /api/v1/chat/conversations/:id/messages` — Synchronous AI turn with atomic credit reservation -> provider execution -> exact token settlement (or 100% release on upstream failure).
- `POST /api/v1/chat/conversations/:id/stream` — SSE token-by-token stream emitting `event: delta`, `event: completed` (including explicit `fallbackUsed`, `requestedModel`, `executedModel`, and `fallbackReason` whenever failover occurred), or `event: error`.
- `PATCH /api/v1/chat/messages/:messageId` — Edit user message and optionally regenerate assistant reply.
- `POST /api/v1/chat/conversations/:id/regenerate` — Regenerate last assistant turn.
- `POST /api/v1/chat/tools/execute` — Specialized modes: `CODING`, `DOCUMENT`, `TRANSLATION` (Sinhala/English/Tamil), `STUDY`, `PRODUCTIVITY`, `VOICE`.

---

## 5. Async Image & Video Generation (`/api/v1/media`)

- `GET /api/v1/media/capabilities` — Dynamically reports connected image/video providers and models so unavailable features are never faked.
- `POST /api/v1/media/images` — Reserves credits and enqueues `TEXT_TO_IMAGE`, `IMAGE_VARIATION`, or `IMAGE_EDIT` background worker job.
- `POST /api/v1/media/videos` — Reserves credits and enqueues `TEXT_TO_VIDEO` or `IMAGE_TO_VIDEO` background worker job.
- `GET /api/v1/media/jobs` & `GET /api/v1/media/jobs/:id` — Poll job progress (`0–100%`), output URLs, and settled/refunded credit totals.

---

## 6. S3-Compatible File Storage (`/api/v1/files`)

- `POST /api/v1/files/upload` — Validates MIME whitelist & 15 MB size limit, computes SHA-256 digest, stores object in S3/R2/local store, and extracts document text for AI Q&A.
- `GET /api/v1/files` & `DELETE /api/v1/files/:id` — Per-user isolated file listing and deletion.

---

## 7. Payments, Subscriptions & Verified Webhooks (`/api/v1/payments`)

- `GET /api/v1/payments/catalog` — Lists `credit_packages` (`Starter`, `Basic`, `Standard`, `Premium`, `Ultimate`) and `subscription_plans` (`Free`, `Monthly Premium`, `Annual Premium`, `Business`, `Enterprise`) in `LKR` and `USD`.
- `POST /api/v1/payments/checkout` — Creates `PENDING` order for `PAYHERE` (`LKR`) or `STRIPE` (`USD`/`EUR`/`GBP`).
- `POST /api/v1/payments/:id/client-return` — Read-only verification check (**never** issues credits).
- `POST /api/v1/payments/webhooks/payhere` — Verifies authentic PayHere `md5sig` (`MD5(merchant_id + order_id + amount + currency + status_code + UPPER(MD5(merchant_secret)))`), enforces idempotency on `(provider, external_event_id)`, allocates credits + deferred liability (`unearned_revenue_usd`), and generates tax invoice.
- `POST /api/v1/payments/webhooks/stripe` — Verifies `Stripe-Signature` HMAC-SHA256 against `req.rawBody` with replay-window enforcement, allocates credits/subscriptions atomically, and issues invoice.
- `GET /api/v1/payments/subscription` & `POST /api/v1/payments/subscription/:id/cancel` — Active subscription inspection & period-end cancellation.
- `GET /api/v1/payments/history` — Orders & issued invoices.

---

## 8. Referrals, Promo Codes, Notifications & Business API (`/api/v1/platform`)

- `GET /api/v1/platform/referrals` — Personal referral code & earned bonus credit ledger.
- `POST /api/v1/platform/promos/redeem` — Atomic promo code redemption with per-user & global cap enforcement.
- `GET /api/v1/platform/notifications` & `PATCH /api/v1/platform/notifications/:id/read` — Alerts & bilingual announcements.
- `GET / POST / DELETE /api/v1/platform/api-keys` — Business/Enterprise programmatic API keys.

---

## 9. RBAC Owner / Admin / Support Governance (`/api/v1/admin`)

| Endpoint | Minimum Role | Step-Up (`X-Confirm-Password`) |
|---|---|---|
| `GET /api/v1/admin/analytics` | `ADMIN`, `OWNER` | No |
| `GET /api/v1/admin/providers` | `ADMIN`, `OWNER` | No (keys masked) |
| `PATCH /api/v1/admin/providers/:id/credentials` | `OWNER` | **Yes** |
| `PATCH /api/v1/admin/providers/:id/budget` | `OWNER` | **Yes** |
| `POST /api/v1/admin/providers/:id/reconcile` | `OWNER` | No |
| `POST /api/v1/admin/roles/assign` | `OWNER` | **Yes** |
| `PATCH /api/v1/admin/system/settings/:key` | `OWNER` | **Yes** |
| `PATCH /api/v1/admin/models/:id` | `ADMIN`, `OWNER` | No |
| `PATCH /api/v1/admin/packages/:id` & `/plans/:id` | `ADMIN`, `OWNER` | No |
| `PATCH /api/v1/admin/daily-credits/:planCode` | `ADMIN`, `OWNER` | No |
| `GET /api/v1/admin/users` & `/request-logs` | `SUPPORT`, `ADMIN`, `OWNER` | No |
| `PATCH /api/v1/admin/users/:id/status` | `ADMIN`, `OWNER` | No |
| `POST /api/v1/admin/users/:id/grant-credits` | `ADMIN`, `OWNER` | No |
| `POST /api/v1/admin/payments/:id/refund` | `ADMIN`, `OWNER` | No |
| `POST /api/v1/admin/announcements` & `/promos` | `ADMIN`, `OWNER` | No |
| `GET /api/v1/admin/audit-logs` | `ADMIN`, `OWNER` | No |
