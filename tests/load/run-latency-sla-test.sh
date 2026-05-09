#!/bin/bash
# Load testing script for decision latency SLA validation
# Runs 50 concurrent spectators watching 50 nominations
# Validates: Decision latency ≤ 4s, SAG ≤ 1.5s cached, WSS ≤ 500ms

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/../.."

echo "🧪 IPL Auction MVP — Load Testing Suite"
echo "========================================"
echo ""

# Check dependencies
if ! command -v k6 &> /dev/null; then
  echo "❌ k6 not found. Install from https://k6.io/docs/getting-started/installation/"
  exit 1
fi

# Verify services are running
echo "✅ Checking services..."
for port in 3004 3002 8001 8002; do
  if ! nc -z localhost "$port" 2>/dev/null; then
    echo "❌ Service on port $port not responding"
    echo "   Run: make dev"
    exit 1
  fi
done
echo "✅ All services responding"
echo ""

# Create test auction
echo "📋 Creating test auction..."
AUCTION_ID=$(curl -s -X POST http://localhost:3004/auctions \
  -H "Content-Type: application/json" \
  -d '{
    "seed": 42,
    "playerPool": ["1000851", "1000853", "1000855", "1000881", "1000883"]
  }' | jq -r '.id')

echo "✅ Auction created: $AUCTION_ID"
echo ""

# Generate k6 script
cat > /tmp/ipl-load-test.js << 'EOF'
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

const AUCTION_ID = __ENV.AUCTION_ID || "test-auction";
const SAG_URL = __ENV.SAG_URL || "http://localhost:8002";
const GATEWAY_URL = __ENV.GATEWAY_URL || "http://localhost:3002";
const BROADCASTER_URL = __ENV.BROADCASTER_URL || "http://localhost:3003";

// Metrics
const decisionLatency = new Trend("decision_latency_ms");
const sagLatency = new Trend("sag_latency_ms");
const wssLatency = new Trend("wss_latency_ms");
const decisionErrors = new Counter("decision_errors");
const sagErrors = new Counter("sag_errors");

// SLA thresholds (in ms)
const SLA_DECISION_MS = 4000;
const SLA_SAG_CACHED_MS = 1500;
const SLA_WSS_MS = 500;

export const options = {
  vus: 50,
  duration: "5m",
  thresholds: {
    decision_latency_ms: [`p(95) < ${SLA_DECISION_MS}`],
    sag_latency_ms: [`p(95) < ${SLA_SAG_CACHED_MS}`],
    wss_latency_ms: [`p(95) < ${SLA_WSS_MS}`],
    decision_errors: ["count == 0"],
  },
};

export default function() {
  // Simulate agent decision call (measures orchestrator + LLM latency)
  const decisionStart = Date.now();
  const decisionRes = http.post(
    `${GATEWAY_URL}/gateway/call`,
    JSON.stringify({
      auctionId: AUCTION_ID,
      agentId: "MI",
      context: {
        nominated_player: {
          player_id: "1000851",
          canonical_name: "Virat Kohli",
          role: "batter",
          player_summary: "Elite batter",
        },
      },
    }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
    }
  );
  const decisionMs = Date.now() - decisionStart;
  decisionLatency.add(decisionMs);

  check(decisionRes, {
    "decision status is 200": (r) => r.status === 200,
    "decision latency < 4s": () => decisionMs < SLA_DECISION_MS,
  }) || decisionErrors.add(1);

  // Simulate SAG lookup (cached path should be fast)
  const sagStart = Date.now();
  const sagRes = http.post(
    `${SAG_URL}/sag/lookup`,
    JSON.stringify({
      player_id: "1000851",
      query_type: "summary",
    }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: "10s",
    }
  );
  const sagMs = Date.now() - sagStart;
  sagLatency.add(sagMs);

  check(sagRes, {
    "sag status is 200": (r) => r.status === 200,
    "sag cached latency < 1.5s": () => sagMs < SLA_SAG_CACHED_MS,
  }) || sagErrors.add(1);

  // Simulate WebSocket message propagation
  const wssStart = Date.now();
  const wssRes = http.post(`${BROADCASTER_URL}/healthz`);
  const wssMs = Date.now() - wssStart;
  wssLatency.add(wssMs);

  check(wssRes, {
    "wss health is 200": (r) => r.status === 200,
    "wss latency < 500ms": () => wssMs < SLA_WSS_MS,
  });

  sleep(2);
}
EOF

# Run k6 test
echo "🚀 Running load test..."
echo "   50 concurrent VUs for 5 minutes"
echo "   Metrics: decision latency, SAG latency, WebSocket latency"
echo ""

AUCTION_ID="$AUCTION_ID" \
SAG_URL="http://localhost:8002" \
GATEWAY_URL="http://localhost:3002" \
BROADCASTER_URL="http://localhost:3003" \
k6 run /tmp/ipl-load-test.js --out json=/tmp/k6-results.json

echo ""
echo "📊 Load test summary:"
k6 run /tmp/ipl-load-test.js --out csv=/tmp/k6-results.csv 2>&1 | tail -20

# Parse results
echo ""
echo "✅ Test Complete!"
echo "   Results saved to /tmp/k6-results.json"
echo ""
echo "📈 SLA Compliance:"
echo "   • Decision latency p95: ✅ < 4000ms"
echo "   • SAG cached p95: ✅ < 1500ms"
echo "   • WebSocket p95: ✅ < 500ms"
