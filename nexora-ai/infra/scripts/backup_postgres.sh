#!/usr/bin/env bash
# ==============================================================================
# NEXORA AI — Automated Encrypted PostgreSQL Backup & Retention Script
# Schedule via cron: 0 */6 * * * /opt/nexora-ai/infra/scripts/backup_postgres.sh
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nexora-ai}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(TZ=Asia/Colombo date +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/nexora_pg_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL must be set" >&2
  exit 1
fi

echo "[INFO] Starting atomic PostgreSQL dump (${TIMESTAMP} Asia/Colombo)..."
pg_dump --no-owner --no-privileges --format=plain "${DATABASE_URL}" | gzip -9 > "${DUMP_FILE}"

# Optional AES-256 encryption if BACKUP_ENCRYPTION_PASSPHRASE is provided
if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -salt -pbkdf2 \
    -in "${DUMP_FILE}" \
    -out "${DUMP_FILE}.enc" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE
  rm -f "${DUMP_FILE}"
  DUMP_FILE="${DUMP_FILE}.enc"
fi

# Optional off-site upload to S3 / Cloudflare R2
if command -v aws >/dev/null 2>&1 && [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "${DUMP_FILE}" "${BACKUP_S3_URI}/$(basename "${DUMP_FILE}")"
fi

# Prune local backups older than RETENTION_DAYS
find "${BACKUP_DIR}" -type f -name "nexora_pg_*" -mtime +"${RETENTION_DAYS}" -delete

echo "[OK] Backup completed: ${DUMP_FILE}"
