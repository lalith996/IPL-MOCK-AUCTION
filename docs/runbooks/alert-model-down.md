# Runbook: LLMModelDownTwoMinutes

**Severity:** WARNING  
**Alert:** `LLMModelDownTwoMinutes`  
**SLO:** Fallback cascade activates within 10s; auction continues uninterrupted  
**Owner:** Platform team

---

## What this alert means

A model's circuit breaker has been in the OPEN state for more than 2 minutes,
meaning the primary LLM for one or more agents is unavailable. The fallback
cascade *should* already be routing calls to another model in the same
personality tier (AGGRESSIVE / BALANCED / CONSERVATIVE).

---

## Check: Is the fallback active?

```promql
ipl_llm_fallback_total{model=~"<affected-model>"}
```

If the counter is increasing, the fallback is working — the alert is informational.

```grafana
Dashboard: LLM Health → "Fallback Activations (1h)"
```

---

## Immediate actions

1. **Confirm fallback is routing correctly** (personality tier preserved):
   ```bash
   curl http://llm-gateway:3002/gateway/usage | jq '.recentCalls | .[] | select(.status == "fallback")'
   ```

2. **Check OpenRouter status** for the affected model endpoint:
   ```bash
   curl https://openrouter.ai/api/v1/models | jq '.[] | select(.id == "<model>")'
   ```

3. **If fallback is NOT active**, manually reset the circuit breaker:
   ```bash
   curl -X POST http://llm-gateway:3002/gateway/reset-circuit \
     -H "Content-Type: application/json" \
     -d '{"model": "<model>"}'
   ```

---

## Escalation

If the model has been down for > 15 minutes and the provider shows no ETA:
1. Temporarily reassign the affected agent to any available model in the same
   personality tier by updating `TEAM_MODEL` in `router.ts`.
2. Deploy the config change with a fast-track review.
3. File a support ticket with OpenRouter.

---

## Resolution criteria

Alert clears when `ipl_llm_circuit_state{model="<model>"} < 2` for 1 minute.
