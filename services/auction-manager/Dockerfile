# ── Stage 1: Install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schemas/package.json       packages/schemas/
COPY packages/shared/package.json        packages/shared/
COPY services/auction-manager/package.json services/auction-manager/

RUN pnpm install --frozen-lockfile --filter @ipl/auction-manager...

# ── Stage 2: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules          ./node_modules
COPY --from=deps /app/packages/schemas/node_modules packages/schemas/node_modules/
COPY --from=deps /app/packages/shared/node_modules  packages/shared/node_modules/
COPY --from=deps /app/services/auction-manager/node_modules services/auction-manager/node_modules/

COPY tsconfig.base.json                    ./
COPY packages/schemas                      packages/schemas/
COPY packages/shared                       packages/shared/
COPY services/auction-manager              services/auction-manager/

RUN pnpm --filter @ipl/auction-manager build

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/services/auction-manager/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules                  ./node_modules

USER app
EXPOSE 3004

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3004/healthz || exit 1

CMD ["node", "dist/main.js"]
