# IPL 2026 Auction MVP — Production Deployment Runbook

## Overview

This document covers deployment, scaling, monitoring, and incident response for the IPL 2026 Auction MVP in production.

---

## Deployment Architecture

```
                              ┌─────────────────┐
                              │  CloudFlare CDN │
                              │  (Assets, DDoS) │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Load Balancer  │
                              │  (SSL, routing) │
                              └────────┬────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
      ┌─────▼─────┐            ┌──────▼────────┐        ┌────────▼────┐
      │  Next.js  │            │   Fastify BFF │        │  Admin UI   │
      │ Spectator │            │   (3004)      │        │  (3005)     │
      │  (3000)   │            └──────┬────────┘        └─────────────┘
      └─────────────┘                 │
                                      │
                        ┌─────────────┼─────────────┐
                        │             │             │
                  ┌─────▼────┐  ┌──────▼──────┐  ┌──▼──────────┐
                  │ Auction  │  │ Agent      │  │  LLM        │
                  │ Manager  │  │ Orchestr.  │  │  Gateway    │
                  │ (3001)   │  │ (3002)     │  │  (3002)     │
                  └─────────────┴──────────────┴──────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐  ┌───────▼───────┐  ┌──▼───┐
   │ Postgres│  │ Redis Streams │  │ SAG  │
   │ (5432)  │  │ (6379)        │  │(8002)│
   └──────────┘  └───────────────┘  └──────┘
```

---

## Prerequisites

- Kubernetes 1.24+ with metrics-server
- Postgres 15+ with replication
- Redis 7+ with persistence
- OpenRouter API key (LLM provider)
- S3-compatible object storage (headshots)
- Domain with SSL certificate
- Monitoring stack (Prometheus + Grafana + Loki)

---

## Deployment Steps

### 1. Pre-deployment Checks

```bash
# Verify all environment variables
./scripts/validate-config.sh

# Run smoke tests
make test-unit
make test-isolation
make test-golden

# Build all Docker images
make build-docker
```

### 2. Database Migration

```bash
# Connect to production Postgres
psql $DATABASE_URL

-- Run migrations in order (001 → 004)
\i infra/docker/migrations/001_player_features.sql
\i infra/docker/migrations/002_auction_events.sql
\i infra/docker/migrations/003_processed_commands.sql
\i infra/docker/migrations/004_auction_approvals.sql

-- Verify tables created
\dt

-- Create indexes
\i infra/docker/indexes.sql

-- Seed initial data
\i infra/docker/seed.sql
```

### 3. Kubernetes Deployment

```bash
# Apply manifests in order (CRDs first, then services, then apps)
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/secrets.yaml
kubectl apply -f infra/k8s/configmaps.yaml
kubectl apply -f infra/k8s/services/
kubectl apply -f infra/k8s/deployments/

# Wait for all pods to be ready
kubectl wait --for=condition=ready pod -l app=auction -n ipl-auction --timeout=300s

# Verify services are running
kubectl get pods -n ipl-auction
kubectl get svc -n ipl-auction
```

### 4. Health Checks

```bash
# Verify all services are responsive
for service in auction-manager agent-orchestrator llm-gateway sag broadcaster; do
  kubectl port-forward svc/$service 9090 -n ipl-auction &
  curl http://localhost:9090/healthz || echo "FAILED: $service"
  kill %1
done

# Check database connectivity
kubectl run -it --rm psql --image=postgres:15 -n ipl-auction -- \
  psql -h postgres-primary $DATABASE_URL -c "SELECT 1"

# Check Redis connectivity
kubectl run -it --rm redis --image=redis:7 -n ipl-auction -- \
  redis-cli -h redis PING
```

---

## Monitoring Setup

### Health Checks

#### Liveness Probe (Pod Restart)
- Checks: Process alive, event loop responsive
- Runs every: 10 seconds
- Failure threshold: 3 consecutive failures
- Action: Kubelet restarts pod

#### Readiness Probe (Traffic Routing)
- Checks: DB connection, Redis connection, external services
- Runs every: 5 seconds
- Failure threshold: 1 consecutive failure
- Action: Remove pod from service load balancer

#### Startup Probe (Service Initialization)
- Checks: Port listening, config loaded, initial migrations
- Timeout: 60 seconds
- Failure threshold: 5 consecutive failures
- Action: Pod is considered failed

### Prometheus Metrics

```yaml
# scrape_configs
- job_name: 'auction-manager'
  static_configs:
    - targets: ['localhost:9090']
  metrics_path: '/metrics'
  scrape_interval: 15s

- job_name: 'llm-gateway'
  static_configs:
    - targets: ['localhost:9091']
  scrape_interval: 15s
```

### Grafana Dashboards

Five required dashboards (defined in `/infra/docker/grafana/dashboards/`):

1. **Auction Health** — Phases, nominations/min, rule rejections, leader flaps
2. **LLM Health** — Latency, error rate, retries, fallback activations, cost
3. **Agent Fairness** — Wins by team, spend by team, isolation probe results
4. **Data Freshness** — SAG cache TTL, ETL status, feed lag
5. **Spectator Experience** — WSS clients, LCP, image errors, reconnect rate

### Alerts (AlertManager)

```yaml
groups:
  - name: auction-alerts
    interval: 1m
    rules:
      - alert: IsolationLeakDetected
        expr: isolation_leak_detected == 1
        for: 0m
        annotations:
          severity: critical

      - alert: ModelDown
        expr: llm_model_down > 0
        for: 2m
        annotations:
          severity: critical

      - alert: SAGStaleness
        expr: sag_cache_age_seconds > 300
        for: 3m
        annotations:
          severity: warning

      - alert: AuctionManagerFlap
        expr: rate(leader_flaps[5m]) > 0.1
        for: 1m
        annotations:
          severity: critical

      - alert: CostBudgetExceeded
        expr: llm_cost_cents > llm_budget_cents * 0.95
        for: 0m
        annotations:
          severity: critical
```

---

## Incident Response

### Scenario 1: Primary LLM Model Down

**Indicator:** `llm_model_down == 1` for 2+ minutes

**Response:**
1. Check LLM Gateway logs: `kubectl logs -f deployment/llm-gateway`
2. Verify circuit breaker state: `curl http://llm-gateway:9091/metrics | grep circuit_breaker`
3. Check if fallback cascade is active: Look for `llm_fallback_cascade_total` increasing
4. If fallback not triggering, manually trigger: `curl -X POST http://llm-gateway:9090/admin/trigger-fallback`
5. Verify personality preservation: All agents should maintain their tier (AGGRESSIVE/BALANCED/CONSERVATIVE)
6. Monitor decision latency: Should remain ≤ 4s even with fallback

### Scenario 2: Database Connection Pool Exhausted

**Indicator:** `pg_connections_idle == 0` for 5+ minutes

**Response:**
1. Check pool stats: `SELECT * FROM pg_stat_activity;`
2. Identify long-running queries: Look for idle transactions > 5 min
3. Kill idle transactions: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE idle_in_transaction_session_timeout > 300000;`
4. Scale auction-manager replicas: `kubectl scale deployment auction-manager --replicas=3`
5. Monitor connection count recovery

### Scenario 3: Redis Cluster Failover

**Indicator:** `redis_connected == 0` or `redis_replication_lag_seconds` spiking

**Response:**
1. Check Redis cluster state: `redis-cli CLUSTER INFO`
2. Identify failed node: `redis-cli CLUSTER NODES | grep fail`
3. If node recovers, proceed. If not, remove from cluster:
   ```bash
   redis-cli CLUSTER FORGET <node-id>
   ```
4. Add replacement node:
   ```bash
   redis-cli CLUSTER ADDSLOTS <slot-range>
   ```
5. Monitor replication lag to return to normal

### Scenario 4: WebSocket Connection Exhaustion

**Indicator:** `ws_connections_total` > 1000 with > 100 slow

**Response:**
1. Check broadcaster logs: `kubectl logs -f deployment/broadcaster`
2. Identify slow clients: `curl http://broadcaster:9090/metrics | grep ws_client_latency`
3. Force disconnect slow clients (> 500ms):
   ```bash
   curl -X POST http://broadcaster:9090/admin/disconnect-slow?latency=500
   ```
4. Scale broadcaster replicas: `kubectl scale deployment broadcaster --replicas=5`
5. Monitor connection count and latency

### Scenario 5: Auction Manager Lost Leadership

**Indicator:** `leader_flaps > 1` or `leader_flap_recovery_time_seconds` spiking

**Response:**
1. Check current leader: `redis-cli GET auction:leader:<auction-id>`
2. Check Auction Manager pod logs:
   ```bash
   kubectl logs -f deployment/auction-manager --all-containers=true
   ```
3. If no leader elected, force re-election:
   ```bash
   kubectl delete pod -l app=auction-manager -n ipl-auction
   ```
4. New pods will compete for leadership
5. Verify new leader elected: `redis-cli GET auction:leader:<auction-id>`

---

## Scaling Guide

### Horizontal Scaling

```bash
# Scale specific components
kubectl scale deployment llm-gateway --replicas=3
kubectl scale deployment agent-orchestrator --replicas=3
kubectl scale deployment broadcaster --replicas=5
kubectl scale deployment sag --replicas=2

# Scale stateless services together
kubectl patch deployment auction-manager -p \
  '{"spec":{"replicas":3}}'
```

### Vertical Scaling

```yaml
# Increase resources in deployment
spec:
  containers:
  - name: auction-manager
    resources:
      requests:
        memory: "512Mi"
        cpu: "500m"
      limits:
        memory: "1Gi"
        cpu: "1000m"
```

### Database Scaling

- **Read replicas:** Add read replicas for analytics queries
- **Connection pooling:** Use PgBouncer to limit connections
- **Archival:** Move old auction events (>30 days) to cold storage

### Cache Scaling

- **Redis cluster:** Expand shard count if `keyspace_hits` dropping
- **TTL tuning:** Reduce TTL if memory usage > 80%
- **Eviction policy:** Use `allkeys-lru` for automatic cache expiration

---

## Backup and Disaster Recovery

### Database Backups

```bash
# Daily backup to S3
pg_dump $DATABASE_URL | gzip > backup-$(date +%Y%m%d).sql.gz
aws s3 cp backup-*.sql.gz s3://auction-backups/

# Point-in-time recovery
pg_restore --data-only -d auction backup-20260503.sql.gz
```

### Event Log Recovery

```bash
# Replay auction from event log
curl -X POST http://auction-manager:3001/admin/replay \
  -H "Content-Type: application/json" \
  -d '{"auctionId": "uuid", "fromEvent": 0}'
```

### RTO/RPO Targets

- **RTO (Recovery Time Objective):** 5 minutes
- **RPO (Recovery Point Objective):** 1 minute
- **Backup retention:** 30 days

---

## Performance Tuning

### Decision Latency (Target: ≤ 4s p95)

```yaml
# Increase LLM model replicas
replicas: 5

# Reduce network latency via Pod Affinity
affinity:
  podAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
            - key: app
              operator: In
              values: [auction-manager]
        topologyKey: kubernetes.io/hostname
```

### SAG Cache Hit Rate (Target: > 90%)

```bash
# Increase cache TTL for player features
FEATURE_CACHE_TTL_SECONDS=600

# Pre-warm cache on startup
curl -X POST http://sag:8002/admin/warm-cache
```

### WebSocket Latency (Target: < 500ms p95)

```yaml
# Broadcast concurrency
BROADCASTER_CONCURRENCY: 100
BROADCASTER_BATCH_SIZE: 50
BROADCASTER_FLUSH_INTERVAL_MS: 10
```

---

## Maintenance Windows

Schedule maintenance during off-peak hours (IST 2 AM - 6 AM):

```bash
# Maintenance mode: accept reads only
kubectl patch deployment -n ipl-auction --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/metadata/annotations/maintenance", "value": "true"}]'

# Drain node for updates
kubectl drain node-1 --ignore-daemonsets

# Apply updates
kubectl apply -f ...

# Uncordon node
kubectl uncordon node-1
```

---

## Security Checklist

- [ ] All secrets in Vault with rotation enabled
- [ ] mTLS enabled between services
- [ ] Network policies restrict traffic to needed paths
- [ ] API rate limiting active (5 req/sec per IP)
- [ ] WAF rules applied at edge
- [ ] Log encryption at rest
- [ ] Audit logs append-only
- [ ] Operator JWT tokens expire in 1 hour
- [ ] Database credentials rotated monthly

---

## Rollback Procedure

```bash
# If deployment fails, rollback immediately
kubectl rollout undo deployment/auction-manager -n ipl-auction

# Verify previous version
kubectl rollout history deployment/auction-manager -n ipl-auction

# If data corruption detected, restore from backup
pg_restore --data-only -d auction backup-$(date -d yesterday +%Y%m%d).sql.gz
```

---

## On-Call Runbook

### First Response (0-5 min)

1. Check dashboard: [Grafana URL]
2. Identify alert type from AlertManager
3. Check service logs: `kubectl logs -f <pod>`
4. If critical, page on-call architect

### Assessment (5-15 min)

1. Determine if customer-impacting
2. If yes, send status update to stakeholders
3. Gather logs and metrics
4. Follow incident response scenario above

### Resolution (15-60 min)

1. Implement fix (restart pod, scale, etc.)
2. Monitor metrics return to normal
3. Wait 5 min for stability
4. Document incident
5. Schedule postmortem within 48 hours

---

## Useful Commands

```bash
# View real-time logs
kubectl logs -f deployment/auction-manager --all-containers=true

# Check resource usage
kubectl top nodes
kubectl top pods -n ipl-auction

# Debug pod networking
kubectl exec -it <pod> -- /bin/bash
# Inside pod:
curl -v http://auction-manager:3001/healthz
netstat -tlnp

# Check Postgres
psql -U postgres -h postgres-primary -c "SELECT * FROM auction_sessions;"

# Check Redis
redis-cli KEYS "*"
redis-cli GET auction:snapshot:*
```
