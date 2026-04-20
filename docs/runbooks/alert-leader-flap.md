# Runbook: AuctionManagerLeaderFlap

**Severity:** WARNING  
**Alert:** `AuctionManagerLeaderFlap`  
**SLO:** Leader stable for duration of auction session; re-election < 5s  
**Owner:** Platform team

---

## What this alert means

The Auction Manager Redis-based leader election has triggered more than 2
re-elections in the past 60 seconds. This indicates that the current leader
is crashing or losing its Redis heartbeat before another instance can take
over cleanly.

---

## Impact

- Brief pauses in bid processing during re-election (< 5s normally).
- If flapping is continuous, bid events may be delayed or duplicated.
- The FSM state is preserved in Postgres snapshots — no state is lost.

---

## Investigation

1. **Check Auction Manager pod health**:
   ```bash
   kubectl get pods -l app=auction-manager
   kubectl describe pod <crashing-pod>
   ```

2. **Look for OOM or crash loops**:
   ```bash
   kubectl logs <pod> --previous | tail -50
   ```

3. **Check Redis connectivity** from the Auction Manager pod:
   ```bash
   kubectl exec -it <pod> -- redis-cli -h redis ping
   ```

4. **Check Redis lock TTL** — if the heartbeat renewal interval is too close
   to the lock TTL, brief Redis latency can cause spurious expirations:
   ```bash
   redis-cli TTL "auction:<id>:leader"
   ```
   Expected: close to 15 (TTL_SECONDS). If < 5, the heartbeat is losing the race.

---

## Resolution

| Root cause | Fix |
|---|---|
| Pod OOMKilled | Increase memory limits in k8s manifest |
| Redis latency spike | Check Redis CPU/memory; scale if needed |
| Heartbeat interval too tight | Increase `LEASE_TTL_SECONDS` or reduce `HEARTBEAT_INTERVAL_MS` |
| Network partition to Redis | Check pod network policies |

After stabilising:
```bash
# Verify exactly one leader is active
redis-cli KEYS "auction:*:leader"
```

---

## Resolution criteria

Alert clears when `increase(ipl_auction_manager_leader_elections_total[60s]) <= 2`
for 2 consecutive evaluation periods.
