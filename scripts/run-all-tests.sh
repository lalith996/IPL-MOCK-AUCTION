#!/usr/bin/env bash

##############################################################################
# COMPREHENSIVE TEST RUNNER
#
# Purpose: Execute all tests with proper orchestration, reporting, and CI/CD
# integration
#
# Usage:
#   ./scripts/run-all-tests.sh                    # All tests
#   ./scripts/run-all-tests.sh chaos              # Chaos tests only
#   ./scripts/run-all-tests.sh --coverage         # With coverage
#   ./scripts/run-all-tests.sh --watch            # Watch mode
#
# Exit Codes:
#   0  - All tests passed
#   1  - Test failures
#   2  - Configuration/setup error
#
##############################################################################

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TESTS_DIR="$PROJECT_ROOT/tests"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
COVERAGE_THRESHOLD=80
TIMEOUT_UNIT=30
TIMEOUT_INTEGRATION=120
TIMEOUT_CHAOS=300
TIMEOUT_LOAD=600

# Test selection
TEST_UNIT=false
TEST_INTEGRATION=false
TEST_CHAOS=false
TEST_LOAD=false
TEST_E2E=false
TEST_GOLDEN=false
TEST_ISOLATION=false
COVERAGE=false
WATCH=false

# Reporting
REPORT_FILE="test-results.json"
JUNIT_FILE="test-results-junit.xml"
HTML_FILE="coverage/index.html"

# ============================================================================
# Utilities
# ============================================================================

log_info() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[⚠]${NC} $*"
}

log_error() {
  echo -e "${RED}[✗]${NC} $*"
}

log_section() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${*}${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Parse arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all)
        TEST_UNIT=true
        TEST_INTEGRATION=true
        TEST_CHAOS=true
        TEST_LOAD=true
        TEST_E2E=true
        TEST_GOLDEN=true
        TEST_ISOLATION=true
        shift
        ;;
      --coverage)
        COVERAGE=true
        shift
        ;;
      --watch)
        WATCH=true
        shift
        ;;
      unit)
        TEST_UNIT=true
        shift
        ;;
      integration)
        TEST_INTEGRATION=true
        shift
        ;;
      chaos)
        TEST_CHAOS=true
        shift
        ;;
      load)
        TEST_LOAD=true
        shift
        ;;
      e2e)
        TEST_E2E=true
        shift
        ;;
      golden)
        TEST_GOLDEN=true
        shift
        ;;
      isolation)
        TEST_ISOLATION=true
        shift
        ;;
      *)
        log_error "Unknown argument: $1"
        usage
        exit 2
        ;;
    esac
  done

  # Default: run unit + integration + isolation (fastest, most critical)
  if ! $TEST_UNIT && ! $TEST_INTEGRATION && ! $TEST_CHAOS && \
     ! $TEST_LOAD && ! $TEST_E2E && ! $TEST_GOLDEN && ! $TEST_ISOLATION; then
    TEST_UNIT=true
    TEST_INTEGRATION=true
    TEST_ISOLATION=true
  fi
}

usage() {
  cat <<EOF
Usage: ${BASH_SOURCE[0]} [OPTIONS] [TEST_TYPE...]

Test Types:
  unit              Run unit tests
  integration       Run integration tests
  chaos             Run chaos tests
  load              Run load tests
  e2e               Run end-to-end tests
  golden            Run golden auction regression
  isolation         Run isolation adversarial suite

Options:
  --all             Run all test types
  --coverage        Generate coverage report
  --watch           Run in watch mode
  -h, --help        Show this help message

Examples:
  ${BASH_SOURCE[0]}                    # Unit + Integration + Isolation
  ${BASH_SOURCE[0]} --all              # All test types
  ${BASH_SOURCE[0]} chaos --coverage   # Chaos tests with coverage
  ${BASH_SOURCE[0]} --watch unit       # Watch mode for unit tests

EOF
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

check_environment() {
  log_section "Pre-flight Checks"

  local issues=0

  # Check required tools
  if ! command_exists node; then
    log_error "Node.js is not installed"
    issues=$((issues + 1))
  else
    log_success "Node.js: $(node --version)"
  fi

  if ! command_exists python3; then
    log_error "Python 3 is not installed"
    issues=$((issues + 1))
  else
    log_success "Python: $(python3 --version)"
  fi

  if ! command_exists pytest; then
    log_error "pytest is not installed"
    issues=$((issues + 1))
  else
    log_success "pytest: $(pytest --version | head -1)"
  fi

  # Check for .env files
  if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    log_warn ".env not found, using .env.example"
    if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
      cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    fi
  else
    log_success ".env file exists"
  fi

  # Check test directory structure
  if [[ ! -d "$TESTS_DIR" ]]; then
    log_error "Tests directory not found: $TESTS_DIR"
    issues=$((issues + 1))
  else
    log_success "Tests directory found"
  fi

  if [[ $issues -gt 0 ]]; then
    log_error "Pre-flight checks failed"
    return 2
  fi

  log_success "All pre-flight checks passed"
}

# ============================================================================
# Test Runners
# ============================================================================

run_unit_tests() {
  log_section "Running Unit Tests"

  local args="-v --tb=short"
  [[ $COVERAGE == true ]] && args="$args --cov=. --cov-report=html --cov-report=term-missing"
  [[ $WATCH == true ]] && args="$args --looponfail"

  if timeout "$TIMEOUT_UNIT" pytest tests/unit $args; then
    log_success "Unit tests passed"
    return 0
  else
    local code=$?
    log_error "Unit tests failed (exit code: $code)"
    return $code
  fi
}

run_integration_tests() {
  log_section "Running Integration Tests"

  local args="-v --tb=short"
  [[ $COVERAGE == true ]] && args="$args --cov=. --cov-report=html --cov-report=term-missing"

  if timeout "$TIMEOUT_INTEGRATION" pytest tests/integration $args; then
    log_success "Integration tests passed"
    return 0
  else
    local code=$?
    log_error "Integration tests failed (exit code: $code)"
    return $code
  fi
}

run_isolation_tests() {
  log_section "Running Isolation Adversarial Suite"

  local args="-v --tb=short"
  [[ $COVERAGE == true ]] && args="$args --cov=. --cov-report=html --cov-report=term-missing"

  if timeout "$TIMEOUT_INTEGRATION" pytest tests/isolation $args; then
    log_success "Isolation tests passed (zero cross-agent leakage)"
    return 0
  else
    local code=$?
    log_error "Isolation tests failed (exit code: $code)"
    return $code
  fi
}

run_chaos_tests() {
  log_section "Running Chaos Tests"

  # Ensure services are running
  if ! pgrep -f "auction-manager" >/dev/null; then
    log_warn "Auction Manager not running, starting..."
    cd "$PROJECT_ROOT/services/auction-manager" && npm run dev &
    sleep 5
  fi

  local args="-v --tb=short -s"  # -s for unbuffered output
  [[ $COVERAGE == true ]] && args="$args --cov=. --cov-report=html"

  if timeout "$TIMEOUT_CHAOS" pytest tests/chaos $args; then
    log_success "Chaos tests passed (all failure scenarios handled)"
    return 0
  else
    local code=$?
    log_error "Chaos tests failed (exit code: $code)"
    return $code
  fi
}

run_golden_tests() {
  log_section "Running Golden Auction Regression"

  if timeout "$TIMEOUT_CHAOS" pytest tests/golden-auction -v --tb=short; then
    log_success "Golden auction regression passed (deterministic replay verified)"
    return 0
  else
    local code=$?
    log_error "Golden auction regression failed (exit code: $code)"
    return $code
  fi
}

run_load_tests() {
  log_section "Running Load Tests"

  if ! command_exists k6; then
    log_error "k6 not installed. Install from https://k6.io/docs/getting-started/installation/"
    return 2
  fi

  if timeout "$TIMEOUT_LOAD" k6 run tests/load/run-latency-sla-test.sh; then
    log_success "Load tests passed (SLA targets met)"
    return 0
  else
    local code=$?
    log_error "Load tests failed (exit code: $code)"
    return $code
  fi
}

run_e2e_tests() {
  log_section "Running End-to-End Tests"

  if ! command_exists npx; then
    log_error "npx not found (part of Node.js)"
    return 2
  fi

  if timeout 300 npx playwright test tests/e2e --reporter=html; then
    log_success "E2E tests passed"
    return 0
  else
    local code=$?
    log_error "E2E tests failed (exit code: $code)"
    return $code
  fi
}

# ============================================================================
# Report Generation
# ============================================================================

generate_summary_report() {
  log_section "Test Summary Report"

  local total=0
  local passed=0
  local failed=0

  # Count test results (simplified)
  if [[ -f "$JUNIT_FILE" ]]; then
    local tests_attr=$(grep -oP 'tests="\K[0-9]+' "$JUNIT_FILE" | head -1)
    local failures_attr=$(grep -oP 'failures="\K[0-9]+' "$JUNIT_FILE" | head -1)
    
    total=$((tests_attr + 0))
    failed=$((failures_attr + 0))
    passed=$((total - failed))
  fi

  echo ""
  echo "Tests Run:     $total"
  echo "Tests Passed:  $passed"
  echo "Tests Failed:  $failed"
  
  if [[ $failed -eq 0 ]]; then
    log_success "All tests passed!"
  else
    log_error "$failed test(s) failed"
  fi

  if [[ $COVERAGE == true && -f "$HTML_FILE" ]]; then
    echo ""
    log_success "Coverage report: $HTML_FILE"
  fi

  echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
  parse_args "$@"

  # Pre-flight checks
  if ! check_environment; then
    exit 2
  fi

  local exit_code=0

  # Run selected tests
  [[ $TEST_UNIT == true ]] && run_unit_tests || exit_code=$?
  [[ $TEST_INTEGRATION == true ]] && run_integration_tests || exit_code=$?
  [[ $TEST_ISOLATION == true ]] && run_isolation_tests || exit_code=$?
  [[ $TEST_CHAOS == true ]] && run_chaos_tests || exit_code=$?
  [[ $TEST_GOLDEN == true ]] && run_golden_tests || exit_code=$?
  [[ $TEST_LOAD == true ]] && run_load_tests || exit_code=$?
  [[ $TEST_E2E == true ]] && run_e2e_tests || exit_code=$?

  # Generate summary
  generate_summary_report

  exit $exit_code
}

main "$@"
