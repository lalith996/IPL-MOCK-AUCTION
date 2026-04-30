FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schemas/package.json  packages/schemas/
COPY packages/shared/package.json   packages/shared/
COPY services/broadcaster/package.json services/broadcaster/

RUN pnpm install --frozen-lockfile --filter @ipl/broadcaster...

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules        ./node_modules
COPY --from=deps /app/packages/schemas/node_modules packages/schemas/node_modules/
COPY --from=deps /app/packages/shared/node_modules  packages/shared/node_modules/
COPY --from=deps /app/services/broadcaster/node_modules services/broadcaster/node_modules/

COPY tsconfig.base.json   ./
COPY packages/schemas     packages/schemas/
COPY packages/shared      packages/shared/
COPY services/broadcaster services/broadcaster/

RUN pnpm --filter @ipl/broadcaster build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/services/broadcaster/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules              ./node_modules

USER app
EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/healthz || exit 1

CMD ["node", "dist/main.js"]
