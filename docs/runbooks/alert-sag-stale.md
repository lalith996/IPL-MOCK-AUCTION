# Runbook: SAGSourceStaleness

**Severity:** WARNING  
**Alert:** `SAGSourceStaleness`  
**SLO:** SAG source staleness < TTL × 3; confidence degrades gracefully beyond that  
**Owner:** Data team

---

## What this alert means

A SAG external source (injury feed, social buzz) has not successfully returned
data for more than 3× its configured TTL. The SAG service is serving stale
cached responses with degraded confidence scores. The auction *continues* but
agent decisions will be less informed.

---

## Impact

- Agent confidence scores reduced proportionally to staleness.
- Cold-start players may have even lower confidence than normal.
- The `Rationale Panel` in the frontend will show `stale` provenance badges.

No hard failure — the auction proceeds in degraded mode.

---

## Investigation

1. **Identify the stale source** from the alert label `source`:
   ```logql
   {job="sag"} |= "stale" | json | source=~"<source>"
   ```

2. **Test the source adapter directly**:
   ```bash
   curl http://sag:3005/internal/adapters/<source>/healthz
   ```

3. **Check the adapter logs** for rate-limit, auth, or connectivity errors:
   ```bash
   kubectl logs -l app=sag --since=30m | grep "ERROR\|adapter"
   ```

---

## Resolution

| Root cause | Fix |
|---|---|
| External API rate-limited | Increase TTL, reduce poll frequency |
| Auth token expired | Rotate API credentials in Vault |
| Network partition | Check pod egress rules / DNS |
| API down (provider issue) | Wait; cache will serve until threshold |

After fixing:
```bash
# Force an immediate poll refresh
curl -X POST http://sag:3005/internal/adapters/<source>/refresh
```

---

## Resolution criteria

Alert clears when `time() - ipl_sag_source_last_success_timestamp < TTL × 3`.
