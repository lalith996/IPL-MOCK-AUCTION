# ── Stage 1: Build venv ─────────────────────────────────────────────────────
FROM python:3.11-slim AS builder
WORKDIR /app

RUN pip install --no-cache-dir uv==0.5.0

COPY pyproject.toml ./
# Copy only the service and its deps so layer cache is efficient
COPY services/agent-orchestrator services/agent-orchestrator/
COPY packages packages/

RUN uv sync --frozen --no-dev --package agent-orchestrator

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.11-slim AS runner
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

# Non-root user
RUN useradd -r -u 1001 -g root app

COPY --from=builder --chown=app:root /app/.venv  ./.venv
COPY --chown=app:root services/agent-orchestrator services/agent-orchestrator/
COPY --chown=app:root packages packages/

USER app
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/healthz')" || exit 1

CMD ["uvicorn", "services.agent_orchestrator.src.main:app", \
     "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
