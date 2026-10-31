# ==============================================================================
# NEXORA AI — Production Multi-Stage Backend & Worker Dockerfile
# ==============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY database ./database
COPY backend ./backend
RUN cd backend && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app/backend
ENV NODE_ENV=production

# Non-root security user
RUN addgroup -S nexora && adduser -S nexora -G nexora

COPY --from=builder --chown=nexora:nexora /app/database /app/database
COPY --from=builder --chown=nexora:nexora /app/backend/package*.json ./
COPY --from=builder --chown=nexora:nexora /app/backend/node_modules ./node_modules
COPY --from=builder --chown=nexora:nexora /app/backend/dist ./dist

USER nexora
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
