## 2024-05-09 - Hardcoded Default Secrets in Production

**Vulnerability:** Found `JWT_SECRET` and `OPERATOR_PASSWORD` environment variables falling back to hardcoded strings (e.g., "dev-password", "CHANGE_ME_IN_PRODUCTION_32_CHARS") without enforcing their presence in production mode.
**Learning:** Silently falling back to static strings for security keys allows an attacker to predict secrets, sign/forge valid JWTs, or authenticate successfully, if the server is ever misconfigured or deployed without the correct environment variables.
**Prevention:** In production environments (`NODE_ENV === 'production'`), validate that all critical environment variables containing secrets are explicitly defined and non-empty. If they are missing, throw a fatal error immediately during startup rather than using a hardcoded fallback.
