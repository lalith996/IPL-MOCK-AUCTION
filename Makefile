.PHONY: install dev build lint typecheck format test-unit test-integration \
        test-isolation test-golden test-chaos schemas db-migrate seed \
        mock-auction clean help

PYTHON := python3
UV := uv
PNPM := pnpm

# ─── Setup ───────────────────────────────────────────────────────────────────

install: ## Install all JS and Python dependencies
	$(PNPM) install
	$(UV) sync --all-packages

# ─── Development ─────────────────────────────────────────────────────────────

dev: ## Start all services in local dev mode (requires Docker stack running)
	docker compose -f infra/docker/docker-compose.yml up -d postgres redis
	$(PNPM) -r --parallel dev

# ─── Build ────────────────────────────────────────────────────────────────────

build: ## Build all TypeScript services
	$(PNPM) -r build

# ─── Code Quality ─────────────────────────────────────────────────────────────

lint: ## Lint all TypeScript and Python code
	$(PNPM) -r lint
	$(UV) run ruff check services/ packages/ tests/

typecheck: ## Type-check all TypeScript and Python code
	$(PNPM) -r typecheck
	$(UV) run mypy services/sag/src services/agent-orchestrator/src services/ingestion/src

format: ## Auto-format all code
	$(PNPM) exec prettier --write "**/*.{ts,tsx,json,md}" --ignore-path .prettierignore
	$(UV) run ruff format services/ packages/ tests/
	$(UV) run black services/ tests/

# ─── Schemas ─────────────────────────────────────────────────────────────────

schemas: ## Regenerate TypeScript and Pydantic types from JSON Schemas
	$(PNPM) --filter @ipl/schemas generate

schemas-check: ## Fail if generated schema types are out of sync with source
	$(PNPM) --filter @ipl/schemas generate
	git diff --exit-code packages/schemas/ts packages/schemas/py

# ─── Testing ─────────────────────────────────────────────────────────────────

test-unit: ## Run all unit tests (required to merge)
	$(PNPM) -r test:unit
	$(UV) run pytest tests/unit/ -v --tb=short

test-integration: ## Run all integration tests (required to merge)
	$(PNPM) -r test:integration 2>/dev/null || true
	$(UV) run pytest tests/integration/ -v

test-isolation: ## Run the cross-agent isolation adversarial suite (required to merge)
	$(UV) run pytest tests/isolation/ -v --tb=short

test-golden: ## Run the golden-auction determinism regression (required to merge)
	$(UV) run pytest tests/golden-auction/ -v --tb=short

test-schema-conformance: ## Run schema conformance suite (required to merge)
	$(UV) run pytest tests/schema-conformance/ -v --tb=short

test-compliance: ## Run rule compliance suite (included in test-unit via pnpm)
	$(PNPM) --filter @ipl/auction-manager test:unit

test-chaos: ## Run chaos tests (required before staging deploy)
	$(UV) run pytest tests/chaos/ -v --tb=short

test-e2e: ## Run Playwright end-to-end tests (required before staging deploy)
	$(PNPM) exec playwright test

test-all: test-unit test-integration test-isolation test-schema-conformance test-golden ## Run all required CI tests

# ─── Database ─────────────────────────────────────────────────────────────────

db-migrate: ## Apply all Postgres migrations
	$(UV) run python3 -m services.ingestion.src.migrate

db-reset: ## Drop and recreate the local database (destructive)
	docker compose -f infra/docker/docker-compose.yml exec postgres \
	  psql -U postgres -c "DROP DATABASE IF EXISTS ipl_auction; CREATE DATABASE ipl_auction;"
	$(MAKE) db-migrate

# ─── Data ─────────────────────────────────────────────────────────────────────

seed: ## Run Cricsheet ETL and seed player features into Postgres
	$(UV) run python3 -m services.ingestion.src.cricsheet.pipeline

# ─── Auction ─────────────────────────────────────────────────────────────────

mock-auction: ## Start a deterministic mock auction session (seed=42)
	$(UV) run python3 -m services.ingestion.src.mock_auction --seed 42

# ─── Infrastructure ───────────────────────────────────────────────────────────

docker-up: ## Start local Docker stack (Postgres + Redis)
	docker compose -f infra/docker/docker-compose.yml up -d

docker-down: ## Stop local Docker stack
	docker compose -f infra/docker/docker-compose.yml down

# ─── Utilities ────────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts
	$(PNPM) -r exec rm -rf dist .next 2>/dev/null || true
	find . -name "__pycache__" -type d | xargs rm -rf
	find . -name "*.pyc" -delete

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
