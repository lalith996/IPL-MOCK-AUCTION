# Runbook: IsolationLeakDetected

**Severity:** CRITICAL  
**Alert:** `IsolationLeakDetected`  
**SLO:** 0 leaks in production at all times (non-negotiable invariant)  
**Owner:** Platform team

---

## What this alert means

The `ipl_isolation_leak_total` counter has incremented, indicating that one or
more agent observations were contaminated with another agent's private data
(squad members, budget, plan state). This violates the zero-cross-agent-leakage
invariant defined in `CLAUDE.md`.

---

## Immediate actions (< 2 minutes)

1. **Halt the active auction session immediately.**  
   ```bash
   curl -X POST http://<auction-manager>:3004/auctions/<id>?action=pause \
     -H "Authorization: Bearer $OPERATOR_TOKEN"
   ```

2. **Identify the offending span** using the trace_id in the alert annotation:
   ```logql
   {job="agent-orchestrator"} |= "ISOLATION_LEAK"
   ```

3. **Page the on-call engineer** if not already done — this is a SEV-1 incident.

---

## Investigation

1. Pull the audit log for the nominated player at the time of the leak:
   ```sql
   SELECT * FROM auction_events
   WHERE auction_id = '<id>'
     AND type = 'player.nominated'
     AND seq <= <leak_seq>
   ORDER BY seq DESC LIMIT 5;
   ```

2. Check if the `ObservationBuilder` runtime guard fired (`IsolationLeakError`)
   or if the leak was silent (harder to detect):
   ```bash
   grep -i "isolation" /var/log/agent-orchestrator.log | tail -50
   ```

3. Run the isolation adversarial suite against the deployed version:
   ```bash
   make test-isolation
   ```

---

## Resolution

- If the test suite passes: a transient concurrency issue may have caused a
  shared reference. Review any recent changes to `graph.py` or `observation_builder.py`.
- If the test suite fails: a code change introduced a leak. Roll back to the
  previous release.

---

## Post-incident

- Write an incident report documenting the leaked fields and root cause.
- Add a targeted adversarial probe to `tests/isolation/` covering the leak vector.
- Re-record the golden fixture if the fix changes event-log structure.
