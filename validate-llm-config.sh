#!/bin/bash
# Validate LLM Gateway Configuration

set -e

echo "🔍 Validating LLM Gateway Setup..."
echo ""

# Check .env exists
if [ ! -f ".env" ]; then
  echo "❌ ERROR: .env file not found"
  echo "   Run: cp .env.example .env"
  exit 1
fi
echo "✅ .env file found"

# Check API key is set
if grep -q "OPENROUTER_API_KEY=sk-or-" .env; then
  API_KEY=$(grep "OPENROUTER_API_KEY=" .env | cut -d= -f2-)
  echo "✅ OPENROUTER_API_KEY is configured"
  echo "   Key starts with: ${API_KEY:0:20}..."
else
  echo "❌ ERROR: OPENROUTER_API_KEY not properly set in .env"
  exit 1
fi

# Check API key is not the placeholder
if grep -q "OPENROUTER_API_KEY=sk-or-CHANGE_ME" .env; then
  echo "⚠️  WARNING: API key is still the placeholder!"
  echo "   Update .env with your real OpenRouter API key"
  exit 1
fi

# Check gateway service files exist
if [ ! -f "services/llm-gateway/src/router.ts" ]; then
  echo "❌ ERROR: LLM Gateway router not found"
  exit 1
fi
echo "✅ LLM Gateway service files found"

# Check router.ts uses environment variable
if grep -q "process.env\[\"OPENROUTER_API_KEY\"\]" services/llm-gateway/src/router.ts; then
  echo "✅ router.ts correctly reads OPENROUTER_API_KEY from environment"
else
  echo "❌ ERROR: router.ts doesn't read OPENROUTER_API_KEY from environment"
  exit 1
fi

# Check Authorization header is set
if grep -q "Authorization: \`Bearer \${OPENROUTER_API_KEY}\`" services/llm-gateway/src/router.ts; then
  echo "✅ Authorization header is properly configured"
else
  echo "❌ ERROR: Authorization header not found in router.ts"
  exit 1
fi

# Check .gitignore includes .env
if grep -q "^\.env$" .gitignore; then
  echo "✅ .env is git-ignored (secrets protected)"
else
  echo "⚠️  WARNING: .env might not be git-ignored"
fi

echo ""
echo "🎉 All checks passed! LLM Gateway is ready to use."
echo ""
echo "Next steps:"
echo "  1. Start dev stack: make dev"
echo "  2. Verify gateway: curl http://localhost:3002/healthz"
echo "  3. Check logs: docker logs ipl-llm-gateway"
echo ""
echo "For full details, see LLM_INTEGRATION_GUIDE.md"
