# Runbook: LLMCostBudgetNearExhausted

**Severity:** CRITICAL  
**Alert:** `LLMCostBudgetNearExhausted`  
**SLO:** Per-auction LLM cost must not exceed the configured hard-cap  
**Owner:** Platform team

---

## What this alert means

The cumulative LLM cost for an active auction has reached 95% of its configured
per-auction budget. The LLM Gateway will hard-stop all future LLM calls for this
auction when the budget is fully exhausted (100%).

At 95% the auction can still continue for a few more nominations, but operator
intervention is required immediately.

---

## Impact

- Auction continues but time-to-hard-stop is < 5% of budget.
- Once hard-stopped, agents produce `agent.timeout` events instead of bids
  (the auction rules engine handles this gracefully — the player goes unsold).

---

## Immediate actions

1. **Check the current spend** breakdown:
   ```bash
   curl http://llm-gateway:3002/gateway/usage | jq '.auctions["<id>"]'
   ```

2. **Pause the auction** to prevent the hard stop mid-nomination:
   ```bash
   curl -X POST http://<auction-manager>:3004/auctions/<id>?action=pause \
     -H "Authorization: Bearer $OPERATOR_TOKEN"
   ```

3. **Identify the highest-cost agents/models**:
   ```promql
   topk(3, ipl_llm_cost_used_cents by (model))
   ```

---

## Options

| Option | Trade-off |
|---|---|
| Increase budget cap for this auction | Risk: actual overspend |
| Reduce max token limits per call | Risk: shorter reasoning_summary |
| Skip SAG lookups for remaining nominations | Risk: lower decision quality |
| Accept remaining nominations as `agent.timeout` | Least risk; players go unsold |

To increase budget for an active auction:
```bash
curl -X POST http://llm-gateway:3002/gateway/budget \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -d '{"auctionId": "<id>", "limitCents": <new_limit>}'
```

---

## Post-incident

- Review the model token usage — if a specific model is consistently expensive,
  consider adjusting `MAX_TOKENS` in the prompt builder.
- Adjust the default `DEFAULT_BUDGET_CENTS` in `cost-tracker.ts` if the current
  default is too low for a standard 50-nomination session.
- Update the golden auction fixture if prompt length changes.

---

## Resolution criteria

Alert clears when the auction ends (`auction.ended` event) or when the budget
is increased and `ipl_llm_cost_used_cents / ipl_llm_cost_budget_cents < 0.95`.
