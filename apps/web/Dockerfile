# ── Stage 1: Install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/shared/package.json  packages/shared/
COPY apps/web/package.json         apps/web/

RUN pnpm install --frozen-lockfile --filter @ipl/web...

# ── Stage 2: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY --from=deps /app/node_modules            ./node_modules
COPY --from=deps /app/packages/schemas/node_modules packages/schemas/node_modules/
COPY --from=deps /app/packages/shared/node_modules  packages/shared/node_modules/
COPY --from=deps /app/apps/web/node_modules   apps/web/node_modules/

COPY tsconfig.base.json ./
COPY packages/schemas   packages/schemas/
COPY packages/shared    packages/shared/
COPY apps/web           apps/web/

# Build args for public env vars (injected at image build time)
ARG NEXT_PUBLIC_BROADCASTER_URL
ARG NEXT_PUBLIC_AUCTION_MANAGER_URL
ENV NEXT_PUBLIC_BROADCASTER_URL=${NEXT_PUBLIC_BROADCASTER_URL}
ENV NEXT_PUBLIC_AUCTION_MANAGER_URL=${NEXT_PUBLIC_AUCTION_MANAGER_URL}

RUN pnpm --filter @ipl/web build

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

# Next.js standalone output includes server + deps
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static     apps/web/.next/static/
COPY --from=builder --chown=app:app /app/apps/web/public            apps/web/public/

USER app
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auctions || exit 1

CMD ["node", "apps/web/server.js"]
