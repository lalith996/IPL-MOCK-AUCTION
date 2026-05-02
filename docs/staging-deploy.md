# Staging Deploy — Step-by-Step

## Prerequisites

| Tool | Version |
|---|---|
| Terraform | ≥ 1.9 |
| kubectl | ≥ 1.30 |
| AWS CLI | ≥ 2.17 |
| ArgoCD CLI | ≥ 2.12 |
| kustomize | ≥ 5.4 |
| pnpm | ≥ 10 |
| uv | ≥ 0.5 |

## Phase 1 — Provision Cloud Infrastructure

```bash
# 1. Configure AWS credentials
aws configure

# 2. Bootstrap Terraform state backend (once)
aws s3 mb s3://ipl-auction-tfstate --region ap-south-1
aws dynamodb create-table \
  --table-name ipl-auction-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1

# 3. Provision staging infrastructure
cd infra/terraform
terraform init
terraform plan -var-file=staging.tfvars -out=staging.plan
terraform apply staging.plan

# 4. Configure kubectl
$(terraform output -raw kubeconfig_command)
kubectl get nodes   # verify cluster is healthy
```

## Phase 2 — Install Cluster Components

```bash
# Nginx Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.0/deploy/static/provider/aws/deploy.yaml

# Cert-Manager (TLS)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.0/cert-manager.yaml

# ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.12.0/manifests/install.yaml
kubectl apply -f infra/argocd/project.yaml

# Get initial ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

# Expose ArgoCD UI temporarily (or use port-forward)
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

## Phase 3 — Create Secrets

```bash
# Create K8s secrets (fill in real values)
kubectl create secret generic ipl-auction-secrets \
  --from-literal=DATABASE_PASSWORD="$(terraform output -raw db_password)" \
  --from-literal=REDIS_AUTH_TOKEN="$(terraform output -raw redis_auth_token)" \
  --from-literal=OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=OPERATOR_PASSWORD="${OPERATOR_PASSWORD}" \
  -n ipl-auction

# Add GHCR pull secret for private images
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username="${GITHUB_ACTOR}" \
  --docker-password="${GITHUB_TOKEN}" \
  -n ipl-auction
```

## Phase 4 — Run Migrations

```bash
# Apply DB migrations via a one-off job
kubectl run migrations \
  --image=ghcr.io/lalith996/ipl-auction/auction-manager:staging \
  --restart=Never \
  -n ipl-auction \
  --env="DATABASE_URL=postgres://..." \
  -- node dist/migrate.js
kubectl wait --for=condition=complete job/migrations -n ipl-auction --timeout=120s
```

## Phase 5 — Deploy via ArgoCD

```bash
# Register staging application
kubectl apply -f infra/argocd/app-staging.yaml

# Trigger first sync
argocd app sync ipl-auction-staging

# Watch rollout
argocd app wait ipl-auction-staging --health --timeout 300
kubectl get pods -n ipl-auction -w
```

## Phase 6 — Seed Player Data

```bash
# Download Cricsheet data (or copy from local all_json/)
# Then run ingestion job:
kubectl run seed \
  --image=ghcr.io/lalith996/ipl-auction/sag:staging \
  --restart=Never \
  -n ipl-auction \
  --env="DATABASE_URL=postgres://..." \
  -- python -m services.ingestion.src.cricsheet.pipeline
```

## Phase 7 — Smoke Test

```bash
BASE="https://staging.ipl-auction.example.com"
ADMIN="https://admin.staging.ipl-auction.example.com"

curl -sf "${BASE}/api/auctions"               && echo "✓ web"
curl -sf "${ADMIN}/api/auth/operator"         && echo "✓ admin (unauthenticated 405)"
curl -sf "https://am.staging.../healthz"      && echo "✓ auction-manager"
# Create a test session via admin UI at ${ADMIN}
# Watch live at ${BASE}/auction/{id}
```

## 7-Day SLO Monitoring

Run the auction 7 consecutive days with these SLOs green:

| SLO | Target |
|---|---|
| Auction Manager availability | ≥ 99.5% |
| Decision latency p95 | ≤ 4 s |
| SAG retrieval p95 | ≤ 5 s uncached |
| Broadcaster WSS p95 latency | ≤ 500 ms |
| Zero isolation leaks | 0 |
| LCP p95 on spectator UI | ≤ 1 s |

Monitor via Grafana at port-forward `kubectl port-forward svc/grafana -n monitoring 3100:3000`.

## Sign-Off Checklist

Run `make test-all` and verify all pass, then check every item:

- [ ] All 10 agents live on exact model from TeamModel table
- [ ] Every agent output validates against `agent_output.schema.json`
- [ ] Every SAG output carries full provenance
- [ ] Auction Manager enforces all 6 rules per spec §7
- [ ] Two-bidder protocol operating with correct timeouts
- [ ] Isolation adversarial suite 1000+ probes: 0 leaks
- [ ] LangGraph dispatches each agent to correct model
- [ ] Cricsheet features available at auction start (version tag `feature_v1`)
- [ ] Real-time UI updates < 1 s client latency
- [ ] 50-nomination mock auction completes with valid rosters + complete audit log
- [ ] Decision latency p95 ≤ 4 s
- [ ] SAG retrieval p95 ≤ 1.5 s cached, ≤ 5 s uncached
- [ ] Zero cross-agent prompt or state leakage
- [ ] External API calls cached and rate-limited
- [ ] Replay reproduces past auction deterministically
- [ ] Cold-start players show `is_cold_start` flag + uncertainty penalty applied
- [ ] `missing_players_report.json` operator-approved
- [ ] `headshot_ingestion_report.json` operator-approved
- [ ] Headshot LCP p95 ≤ 1 s on 4G
- [ ] CDN failure simulation: fallback to avatar within 1 retry
- [ ] Chaos test: primary model killed → fallback triggers within SLA
- [ ] 7 consecutive days green SLOs
- [ ] All 5 Grafana dashboards loaded with live data
- [ ] All 5 alerts manually triggered and acknowledged
