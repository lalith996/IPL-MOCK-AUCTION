FROM python:3.11-slim AS builder
WORKDIR /app

RUN pip install --no-cache-dir uv==0.5.0

COPY pyproject.toml ./
COPY services/sag    services/sag/
COPY packages        packages/

RUN uv sync --frozen --no-dev --package sag

FROM python:3.11-slim AS runner
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

RUN useradd -r -u 1001 -g root app

COPY --from=builder --chown=app:root /app/.venv ./.venv
COPY --chown=app:root services/sag services/sag/
COPY --chown=app:root packages     packages/

USER app
EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/healthz')" || exit 1

CMD ["uvicorn", "services.sag.src.main:app", \
     "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]
