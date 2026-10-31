# NEXORA AI — Commercial Multi-Model AI SaaS Platform
> **Tagline:** *INTELLIGENCE WITHOUT LIMITS* (`සීමාවකින් තොර බුද්ධිය`)

`NEXORA AI` is a full-stack commercial AI SaaS ecosystem built for Sri Lanka (`LKR` + Sinhala `සිංහල` + `Asia/Colombo` daily free credit renewals) and the global market (`USD`/`EUR`/`GBP`, multi-provider AI routing, Business REST API, and GAAP deferred-liability analytics).

---

## Repository Architecture (`nexora-ai/`)

```text
nexora-ai/
├── database/
│   ├── migrations/                  # 001..006 transactional PostgreSQL 14–16+ migrations
│   └── schema.sql                   # Canonical 34-table schema, triggers & seed catalog
├── backend/                         # Modular NestJS 10 + TypeScript 5 API, SSE, WebSocket & Worker
│   ├── src/
│   │   ├── config/                  # AES-256-GCM encryption, SHA-256, Asia/Colombo time helpers
│   │   ├── database/                # PostgreSQL Pool + PGlite ACID driver, migrations & Owner bootstrap
│   │   ├── cache/                   # Redis + embedded rate-limiter & concurrency semaphores
│   │   ├── queue/                   # BullMQ + embedded async media worker pool
│   │   ├── common/                  # JWT / X-API-Key guard, RBAC RolesGuard & X-Confirm-Password step-up
│   │   └── modules/
│   │       ├── auth/                # Registration, referrals, brute-force lock, refresh-token rotation
│   │       ├── wallet/              # 3-bucket credits (Free/Purchased/Bonus), reserve->settle->release
│   │       ├── ai-providers/        # Real HTTP/SSE adapters: OpenAI, Gemini, Anthropic, OSS-Compatible
│   │       ├── ai-router/           # Health circuit breaker, explicit fallback notices, cost estimator
│   │       ├── cost-management/     # Daily/monthly USD caps, Owner alerts, auto-pause, reconciliation
│   │       ├── chat/                # Multi-chat CRUD, SSE streaming, Socket.IO /ws, Sinhala & AI tools
│   │       ├── media/               # Capability-aware async Image & Video generation workers
│   │       ├── storage/             # S3-compatible + local object storage, MIME/hash & doc extraction
│   │       ├── payments/            # PayHere LKR (MD5) & Stripe USD (HMAC-SHA256) verified webhooks
│   │       ├── analytics/           # Accrual GAAP analytics tracking unused credits as deferred liability
│   │       ├── growth/              # Referrals, promo codes, bilingual announcements, Business API keys
│   │       ├── admin/               # Owner/Admin/Support governance & immutable admin_audit_logs
│   │       └── health/              # Liveness/readiness (/api/v1/health) & Prometheus (/health/metrics)
│   └── test/                        # 8-suite E2E security/concurrency spec + 200-req load test runner
├── mobile/                          # React Native 0.76 + Expo SDK 52 + TypeScript Android & Web App
│   ├── assets/                      # Custom generated NEXORA AI icon, adaptive icon, splash & favicon
│   ├── src/screens/                 # All 24 production screens (01_SplashScreen .. 24_AdminOwnerDashboard)
│   ├── app.json & eas.json          # Android com.nexora.ai APK & Google Play AAB build profiles
│   └── web-bundle/                  # Exported production Web SPA served seamlessly by backend
├── infra/                           # Nginx load balancer, Prometheus config, PG backup & asset scripts
├── docs/                            # API Reference, Cloud Deployment/Scaling Guide & Android APK Guide
├── docker-compose.yml               # Production multi-container stack
├── docker-compose.scale.yml         # Horizontal multi-replica API + PgBouncer scaling override
├── .env.example                     # Documented environment variable template
└── PRODUCTION_LAUNCH_CHECKLIST.md   # Pre-launch security, financial & QA sign-off checklist
```

---

## Quick Verification Commands

```bash
# 1. Run full backend build + 8 E2E security, billing & concurrency test suites:
cd nexora-ai/backend && npm test

# 2. Run 200-request concurrent burst load test:
cd nexora-ai/backend && npm run test:load

# 3. Typecheck & export the 24-screen React Native + Expo mobile app:
cd nexora-ai/mobile && npm run typecheck && npm run export:web
```
