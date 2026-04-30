FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/shared/package.json  packages/shared/
COPY apps/admin/package.json       apps/admin/

RUN pnpm install --frozen-lockfile --filter @ipl/admin...

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules            ./node_modules
COPY --from=deps /app/packages/schemas/node_modules packages/schemas/node_modules/
COPY --from=deps /app/packages/shared/node_modules  packages/shared/node_modules/
COPY --from=deps /app/apps/admin/node_modules  apps/admin/node_modules/

COPY tsconfig.base.json ./
COPY packages/schemas   packages/schemas/
COPY packages/shared    packages/shared/
COPY apps/admin         apps/admin/

RUN pnpm --filter @ipl/admin build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/admin/.next/static     apps/admin/.next/static/
COPY --from=builder --chown=app:app /app/apps/admin/public           apps/admin/public/ 2>/dev/null || true

USER app
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/auth/operator || exit 1

CMD ["node", "apps/admin/server.js"]
