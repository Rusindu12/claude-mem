# NEXORA AI — Cloud Deployment, Scaling & Disaster Recovery Guide

## 1. External Paid Accounts & Credentials Required for Live Commercial Launch

NEXORA AI contains **zero hardcoded fake AI responses** and **zero simulated client-side credit issuance**. To operate commercially with real upstream billing and payment settlement, provision the following external accounts and place their secrets strictly in backend `.env` (or enter AI keys via the Owner Governance Dashboard):

1. **AI Model Providers (At least 1 required; 2+ recommended for automatic failover):**
   - **OpenAI Platform** (`https://platform.openai.com`) — `OPENAI_API_KEY` (GPT-4o, GPT-4o Mini, o3-mini, gpt-image-1).
   - **Google AI Studio / Vertex AI** (`https://aistudio.google.com`) — `GEMINI_API_KEY` (Gemini 2.5 Pro, Gemini 2.5 Flash, Imagen 3, Veo 2).
   - **Anthropic Console** (`https://console.anthropic.com`) — `ANTHROPIC_API_KEY` (Claude Sonnet 4, Claude 3.5 Haiku).
   - **OpenAI-Compatible OSS Inference** (Groq / Together / DeepSeek / vLLM) — `OSS_COMPAT_API_KEY` & `OSS_COMPAT_BASE_URL`.
2. **Payment Gateways:**
   - **PayHere Sri Lanka** (`https://www.payhere.lk`) — `PAYHERE_MERCHANT_ID` and `PAYHERE_MERCHANT_SECRET`. Configure notify URL to `https://api.nexora.ai/api/v1/payments/webhooks/payhere`.
   - **Stripe International** (`https://dashboard.stripe.com`) — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Subscribe webhook `checkout.session.completed` to `https://api.nexora.ai/api/v1/payments/webhooks/stripe`.
3. **Managed Infrastructure (or Self-Hosted Docker Stack):**
   - PostgreSQL 16 (`AWS RDS`, `Supabase`, `Neon`, or Docker `postgres:16-alpine`).
   - Redis 7 (`Upstash`, `AWS ElastiCache`, or Docker `redis:7-alpine`).
   - S3-Compatible Object Storage (`Cloudflare R2`, `AWS S3`, or Docker `MinIO`).

---

## 2. Step-by-Step Production Deployment (Docker Compose)

```bash
cd nexora-ai
cp .env.example .env
# Populate JWT secrets, MASTER_ENCRYPTION_KEY (openssl rand -hex 32), DB passwords, and gateway keys
nano .env

# Launch full stack (PostgreSQL 16 + Redis 7 + MinIO + NestJS API + Nginx + Prometheus)
docker compose up -d --build

# Verify liveness, readiness, and migration status
curl -s http://127.0.0.1/api/v1/health | jq .
```

---

## 3. Scaling Strategy: 1,000 → 10,000 → 100,000+ Users

NEXORA AI is engineered with **stateless API nodes** so horizontal scaling requires zero code changes:

- **Stage 1 (1,000 – 10,000 MAU):**
  - Run `docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale api=4`.
  - `PgBouncer` pools up to `2,000` application connections into `50` PostgreSQL server connections, preventing connection exhaustion during burst traffic.
  - Redis coordinates distributed per-user rate limits, provider concurrency semaphores, and BullMQ background media queues.
- **Stage 2 (10,000 – 100,000+ MAU):**
  - Deploy stateless `backend/Dockerfile` containers onto **Kubernetes (EKS / GKE / DigitalOcean Kubernetes)** with Horizontal Pod Autoscaler (`HPA` targeting 65% CPU / event-loop utilization).
  - Configure `DATABASE_READ_REPLICA_URL` pointing analytics and reporting queries to a PostgreSQL read replica while keeping `wallets` `SELECT ... FOR UPDATE` reservations on the primary writer.
  - Separate BullMQ media workers (`media-generation` queue) onto dedicated worker pods so long-running image/video polling never competes with low-latency SSE chat streams.
  - Place **Cloudflare** in front of Nginx for global CDN caching of `web-bundle` static assets, DDoS protection, and TLS 1.3 edge termination.

---

## 4. Database Backups & Disaster Recovery

1. **Automated Backups:** Schedule `infra/scripts/backup_postgres.sh` via `cron` every 6 hours with `BACKUP_ENCRYPTION_PASSPHRASE` and `BACKUP_S3_URI` set, plus continuous WAL Point-in-Time Recovery (PITR) on managed PostgreSQL.
2. **Restore Drill Procedure:**
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 \
     -in nexora_pg_YYYYMMDD_HHMMSS.sql.gz.enc \
     -pass env:BACKUP_ENCRYPTION_PASSPHRASE | gunzip | psql "$RESTORE_DATABASE_URL"
   ```
3. **High-Availability Design:** No realistic cloud architecture claims 100% uptime; NEXORA AI achieves high availability via multi-replica stateless API containers, health-checked Nginx `least_conn` failover, multi-provider AI routing with automatic circuit breaking, and PostgreSQL transactional recovery.
