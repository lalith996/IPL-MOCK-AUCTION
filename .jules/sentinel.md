## 2024-05-11 - Hardcoded JWT Secrets

**Vulnerability:** Hardcoded JWT secrets used as fallbacks in multiple files (`apps/admin/src/api/auctions/[id]/route.ts`, `apps/admin/src/api/auth/operator/route.ts`, `apps/admin/src/lib/auth.ts`).
**Learning:** These fallbacks are unsafe in production. If the environment variable `JWT_SECRET` is missing, the application silently falls back to predictable strings like 'dev-secret' or 'dev-secret-key'.
**Prevention:** Remove fallback values. Instead, check if `process.env.JWT_SECRET` is set, and throw a fatal error if it's missing to fail securely, especially in a production environment (`process.env.NODE_ENV === 'production'`).
