## 2025-02-18 - [CRITICAL] Remove Hardcoded Fallback Secrets for Auth and JWT
**Vulnerability:** Hardcoded fallback values (`dev-password`, `CHANGE_ME_IN_PRODUCTION_32_CHARS`) were used for `OPERATOR_PASSWORD` and `JWT_SECRET` in the `admin` app.
**Learning:** Hardcoding default credentials poses a critical risk if environment variables fail to load or are forgotten during production deployments. It allows an attacker to gain unauthorized access using widely-known default values.
**Prevention:** Avoid fallback secrets. The system must fail securely at startup or runtime when critical security configuration is missing by throwing an error or returning a `500 Internal Server Error`, rather than silently succeeding with weak credentials.
