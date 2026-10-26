# Deployment guide

## 1. Requirements

| Component | Minimum |
|---|---|
| Host | 1 vCPU / 2 GB RAM (backend + Postgres + Redis) |
| OS | Any Linux with Docker Engine 24+ and Compose v2 |
| Python (bare metal) | 3.11 |
| PostgreSQL | 16 |
| Redis | 7 (optional with a single worker, required for multi-worker rate limits/caches) |
| TLS | Reverse proxy (Caddy/nginx/Traefik) — **mandatory** outside localhost |

## 2. Environment

Copy `.env.example` to `.env` and set at minimum:

```bash
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=$(python -c 'import secrets;print(secrets.token_urlsafe(48))')
APP_ENCRYPTION_KEY=$(python -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')
POSTGRES_PASSWORD=<strong-random>
DATABASE_URL=postgresql+psycopg://rsai:<strong-random>@localhost:5432/rsai
REDIS_URL=redis://localhost:6379/0
ALLOWED_ORIGINS=https://your-frontend.example
BINANCE_ENV=testnet                 # keep testnet until the safety checklist passes
LIVE_TRADING_ENABLED=false
AUTOMATION_ENABLED=false
REQUIRE_MANUAL_APPROVAL=true
MARKET_DATA_MODE=binance
ALLOW_SYNTHETIC_FALLBACK=false
```

Full variable list with explanations: `.env.example`.

Startup behaviour worth knowing:

* `APP_ENCRYPTION_KEY` is required in production — the service refuses to start without it.
* `UVICORN_WORKERS > 1` requires Redis so rate limits and caches are shared.
* `ALLOW_SYNTHETIC_FALLBACK=true` keeps the UI alive when Binance is unreachable, but the provider is
  flagged `synthetic` and the risk engine blocks live orders. Never enable it in production.

## 3. Docker Compose (recommended)

```bash
cp .env.example .env         # edit as above
docker compose up --build -d
docker compose ps
docker compose exec backend python -m app.cli create-admin --email you@example.com
docker compose exec backend python -m app.cli check-health
curl -fsS http://localhost:8000/api/v1/health
```

The backend container runs `alembic upgrade head` before starting uvicorn, so schema migrations are
applied on deploy. `database/schema.sql` is also mounted as a Postgres init script for fresh volumes.

Services: `db` (Postgres 16, bound to `127.0.0.1:5432`), `redis` (7, `127.0.0.1:6379`), `backend`
(`0.0.0.0:8000`, non-root uid 10001, healthcheck on `/api/v1/health`).

## 4. Bare metal

```bash
python -m venv /opt/rsai/venv && /opt/rsai/venv/bin/pip install -r backend/requirements.txt
set -a; . /opt/rsai/.env; set +a

cd backend
alembic -c alembic.ini upgrade head
python -m app.cli create-admin --email ops@example.com

# systemd unit (sketch)
ExecStart=/opt/rsai/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
WorkingDirectory=/opt/rsai/backend
Restart=always
```

## 5. Reverse proxy (HTTPS)

nginx sketch:

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;
  ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }

  location /api/v1/stream/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

If you terminate TLS at the proxy, set `TRUST_PROXY_HEADERS=true` so client IPs are logged correctly
(rate limiting uses them).

Then build the APK against the HTTPS URL:

```bash
cd android-app && ./gradlew :app:assembleRelease -PrsaiBaseUrl=https://api.example.com/
```

## 6. Database

* Migrations: `alembic -c backend/alembic.ini upgrade head` (also run automatically in the container).
* Current head: `0001_initial` (19 tables). Regenerate the readable DDL with
  `python scripts/generate_schema.py`.
* Backups: `pg_dump -Fc rsai > rsai-$(date +%F).dump` nightly, stored off-host and encrypted.
  Test restores quarterly — a backup you have not restored is not a backup.
* Redis is a cache/limiter, not a source of truth; it can be flushed safely.

## 7. Monitoring

| Signal | Where |
|---|---|
| Liveness / readiness | `GET /health`, `GET /ready`, `GET /api/v1/health` |
| Market provider health | `GET /api/v1/config` → `market_data`, `/admin/health` → `market` |
| Trading controls | `/admin/health` → `trading_control`, `/risk/status` |
| Order failures | notifications + audit log (`/admin/audit`), `upstream_error` in logs |
| Rate limiting | 429 counts per route in logs |
| Data staleness | `/market/overview` → `freshness.any_stale` |

Recommended alerts: backend down > 2 min, `market.degraded` true > 5 min, any `kill_switch` engage,
spike in `risk_rejected`, DB connection errors.

## 8. Upgrades

1. Back up the database.
2. `git pull` (or deploy the new image).
3. `alembic upgrade head`.
4. Restart the backend; watch `/ready` and `/admin/health`.
5. Raise `min_app_version` in runtime settings if the API changed incompatibly (the app surfaces it
   on the dashboard).

## 9. What was and was not verified

Verified while the project was built:

* `alembic -c alembic.ini upgrade head` against a real **PostgreSQL 16.2** server — 19 tables,
  15 foreign keys, 58 indexes, `alembic_version = 0001_initial`.
* `database/schema.sql` applied to a fresh database (19 tables, 57 indexes, 15 FKs).
* A full API flow on that database (`backend/tests/test_postgres_integration.py`).

**Not** verified: `docker compose up` (no Docker in the build environment), TLS termination,
network access from the host to `api.binance.com`, and the Android build. Run the commands above and
confirm the results on your own infrastructure before relying on them.
