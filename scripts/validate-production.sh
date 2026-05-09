#!/bin/bash
# Production Deployment Validation Checklist
# Run before deploying to staging/production
# Exit 1 if any check fails

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CHECKS_PASSED=0
CHECKS_FAILED=0

function check_pass() {
  echo -e "${GREEN}✅${NC} $1"
  ((CHECKS_PASSED++))
}

function check_fail() {
  echo -e "${RED}❌${NC} $1"
  ((CHECKS_FAILED++))
}

function check_warn() {
  echo -e "${YELLOW}⚠️${NC} $1"
}

echo "🚀 IPL Auction MVP — Production Deployment Validation"
echo "====================================================="
echo ""

# 1. Code Quality
echo "📋 Code Quality Checks"
echo "----------------------"

if make typecheck &> /dev/null; then
  check_pass "TypeScript strict mode"
else
  check_fail "TypeScript compilation"
fi

if make lint &> /dev/null; then
  check_pass "ESLint and Ruff"
else
  check_fail "Linting"
fi

if make test-unit &> /dev/null; then
  check_pass "Unit tests"
else
  check_fail "Unit tests"
fi

# 2. Test Coverage
echo ""
echo "🧪 Test Coverage"
echo "-----------------"

if [ -f coverage/coverage-final.json ]; then
  COVERAGE=$(jq '.total.lines.pct' coverage/coverage-final.json)
  if (( $(echo "$COVERAGE > 80" | bc -l) )); then
    check_pass "Unit test coverage: ${COVERAGE}%"
  else
    check_warn "Unit test coverage: ${COVERAGE}% (target: >80%)"
  fi
fi

if make test-isolation &> /dev/null; then
  check_pass "Isolation adversarial suite"
else
  check_fail "Isolation tests"
fi

if make test-golden &> /dev/null; then
  check_pass "Golden auction regression"
else
  check_fail "Golden auction tests"
fi

# 3. Integration Tests
echo ""
echo "🔌 Integration Tests"
echo "--------------------"

if docker ps &> /dev/null; then
  check_pass "Docker available"
  
  # Start local dev stack
  if timeout 60 make dev &> /tmp/dev.log; then
    check_pass "Dev stack starts"
    
    # Run integration tests
    if make test-integration &> /dev/null; then
      check_pass "Integration tests pass"
    else
      check_fail "Integration tests"
    fi
  else
    check_fail "Dev stack failed to start"
  fi
else
  check_fail "Docker not available"
fi

# 4. Configuration
echo ""
echo "⚙️  Configuration"
echo "----------------"

# Check required env vars
REQUIRED_VARS=(
  "DATABASE_URL"
  "REDIS_URL"
  "OPENROUTER_API_KEY"
  "OPENROUTER_BASE_URL"
  "JWT_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    check_fail "Missing environment variable: $var"
  else
    check_pass "Environment variable: $var"
  fi
done

# Validate URLs
if [[ "$DATABASE_URL" =~ ^postgres:// ]]; then
  check_pass "DATABASE_URL format valid"
else
  check_fail "DATABASE_URL format invalid"
fi

if [[ "$REDIS_URL" =~ ^redis:// ]]; then
  check_pass "REDIS_URL format valid"
else
  check_fail "REDIS_URL format invalid"
fi

if [[ "$OPENROUTER_API_KEY" =~ ^sk-or-v1- ]]; then
  check_pass "OpenRouter API key format valid"
else
  check_fail "OpenRouter API key format invalid"
fi

# 5. Database Schema
echo ""
echo "🗄️  Database Schema"
echo "-------------------"

if command -v psql &> /dev/null; then
  # Check migrations
  RESULT=$(psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM auction_sessions LIMIT 1;" 2>&1 || true)
  if [[ "$RESULT" =~ "count" ]]; then
    check_pass "Database migrations applied"
  else
    check_fail "Database migrations not applied"
  fi
fi

# 6. Security
echo ""
echo "🔐 Security"
echo "-----------"

if grep -r "TODO.*secret" . --include="*.ts" --include="*.py" 2>/dev/null | grep -v node_modules &> /dev/null; then
  check_warn "Found TODO comments about secrets"
fi

if grep -r "process.env" . --include="*.ts" --include="*.py" | grep -v "process.env\[" | wc -l | grep -q 0; then
  check_pass "Environment variables accessed safely"
fi

if git ls-files --others --ignored --exclude-standard | grep -qE '\.env|\.secrets|credentials'; then
  check_fail "Secrets or credentials in git"
else
  check_pass "No secrets in git"
fi

# Check .env.example exists
if [ -f .env.example ]; then
  check_pass ".env.example exists (guide for setup)"
else
  check_warn ".env.example not found"
fi

# 7. Performance
echo ""
echo "⚡ Performance"
echo "--------------"

if make test-golden &> /dev/null; then
  # Parse golden auction duration
  DURATION=$(grep -o "Duration: [0-9]*ms" /tmp/golden.log | head -1 | grep -o "[0-9]*")
  if [ -n "$DURATION" ] && (( DURATION < 60000 )); then
    check_pass "Golden auction completes in ${DURATION}ms (target: <60s)"
  else
    check_warn "Golden auction duration unknown or slow"
  fi
fi

# 8. Documentation
echo ""
echo "📚 Documentation"
echo "----------------"

REQUIRED_DOCS=(
  "docs/ipl_2026_auction_mvp_spec.md"
  "docs/ipl_2026_auction_hld.md"
  "docs/api.openapi.yaml"
  "docs/runbooks/PRODUCTION_DEPLOYMENT.md"
)

for doc in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$doc" ]; then
    check_pass "$doc exists"
  else
    check_fail "$doc missing"
  fi
done

# 9. API Documentation
echo ""
echo "📖 API Documentation"
echo "--------------------"

if command -v npx &> /dev/null; then
  if npx swagger-cli validate docs/api.openapi.yaml &> /dev/null; then
    check_pass "OpenAPI schema valid"
  else
    check_warn "OpenAPI schema validation failed"
  fi
fi

# 10. Observability
echo ""
echo "📊 Observability"
echo "---------------"

DASHBOARDS=(
  "infra/docker/grafana/dashboards/01-auction-health.json"
  "infra/docker/grafana/dashboards/02-llm-health.json"
  "infra/docker/grafana/dashboards/03-agent-fairness.json"
  "infra/docker/grafana/dashboards/04-data-freshness.json"
  "infra/docker/grafana/dashboards/05-spectator-experience.json"
)

for dashboard in "${DASHBOARDS[@]}"; do
  if [ -f "$dashboard" ]; then
    if jq empty "$dashboard" &> /dev/null; then
      check_pass "Grafana dashboard valid: $(basename $dashboard)"
    else
      check_fail "Grafana dashboard invalid JSON: $(basename $dashboard)"
    fi
  else
    check_fail "Grafana dashboard missing: $(basename $dashboard)"
  fi
done

# 11. Docker Images
echo ""
echo "🐳 Docker Images"
echo "----------------"

IMAGES=(
  "ipl-auction/web:latest"
  "ipl-auction/auction-manager:latest"
  "ipl-auction/agent-orchestrator:latest"
  "ipl-auction/llm-gateway:latest"
  "ipl-auction/sag:latest"
  "ipl-auction/broadcaster:latest"
  "ipl-auction/admin:latest"
)

for image in "${IMAGES[@]}"; do
  if docker image inspect "$image" &> /dev/null; then
    check_pass "Docker image exists: $image"
  else
    check_fail "Docker image missing: $image"
  fi
done

# 12. Kubernetes Manifests
echo ""
echo "☸️  Kubernetes"
echo "-------------"

if command -v kubectl &> /dev/null; then
  if kubectl apply -f infra/k8s --dry-run=client &> /dev/null; then
    check_pass "Kubernetes manifests valid"
  else
    check_fail "Kubernetes manifests invalid"
  fi
else
  check_warn "kubectl not found (optional for local validation)"
fi

# 13. Helm Charts (if using)
echo ""
echo "📦 Helm Charts"
echo "--------------"

if [ -d infra/helm ]; then
  if command -v helm &> /dev/null; then
    if helm lint infra/helm/ipl-auction &> /dev/null; then
      check_pass "Helm chart valid"
    else
      check_fail "Helm chart invalid"
    fi
  fi
fi

# 14. Dependency Audit
echo ""
echo "🔍 Dependency Audit"
echo "-------------------"

if npm audit --audit-level=moderate &> /dev/null 2>&1; then
  check_pass "npm dependencies pass audit"
else
  check_warn "npm audit found vulnerabilities (review before deploy)"
fi

if pip audit --desc &> /dev/null 2>&1; then
  check_pass "Python dependencies pass audit"
else
  check_warn "Python audit found vulnerabilities (review before deploy)"
fi

# 15. Final Summary
echo ""
echo "📊 Summary"
echo "=========="
echo -e "${GREEN}Passed:${NC} $CHECKS_PASSED"
echo -e "${RED}Failed:${NC} $CHECKS_FAILED"

if [ $CHECKS_FAILED -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ All critical checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Review warnings above"
  echo "  2. Run: make build-docker"
  echo "  3. Push images to registry"
  echo "  4. Deploy with: kubectl apply -f infra/k8s"
  echo ""
  exit 0
else
  echo ""
  echo -e "${RED}❌ Critical checks failed!${NC}"
  echo ""
  echo "Fix the issues above before deploying."
  exit 1
fi
