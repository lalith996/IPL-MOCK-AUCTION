# WebSocket Protocol — IPL Auction Broadcaster

## Connection

```
ws://<host>:<port>/?auctionId=<id>&offset=<lastStreamId>
```

| Parameter  | Required | Description |
|------------|----------|-------------|
| `auctionId`| Yes      | The auction session ID |
| `offset`   | No       | Last Redis Stream ID the client received (default: `0-0` = all events) |

## Message Types (server → client)

### `snapshot`
Sent immediately on connect. Contains the latest auction state projection.
```json
{ "type": "snapshot", "auctionId": "...", "data": { ...AuctionState } }
```
`data` may be `null` if no snapshot exists yet.

### `event`
Live auction event. Clients must deduplicate by `data.event_id`.
```json
{
  "type": "event",
  "streamId": "1712345678901-0",
  "data": { ...AuctionEvent }
}
```

### `ping`
Heartbeat sent every 15s. Client must respond with `pong`.
```json
{ "type": "ping", "ts": 1712345678901 }
```

### `error`
Sent before forcible disconnection.
```json
{ "type": "error", "code": "slow_consumer", "message": "Queue full — disconnecting" }
```

## Message Types (client → server)

### `pong`
Response to a `ping` message. Resets the heartbeat miss counter.
```json
{ "type": "pong" }
```

## Reconnect Protocol

1. Client stores the `streamId` of the last received `event` message.
2. On reconnect, client sends this as the `offset` query parameter.
3. Server replays all events from `(offset, ...]` with no gaps, then resumes live streaming.
4. The `snapshot` is always re-sent on connect (even on reconnect) so client can re-sync state.
5. Client deduplicates events by `data.event_id` to handle any overlap.

## Heartbeat

- Server sends `ping` every 15s.
- Client must respond with `pong` within 15s.
- After 2 consecutive missed `pong`s the server closes the connection with code `1001`.
- Client should implement exponential backoff before reconnecting: 500ms, 1s, 2s, 4s, capped at 30s.

## Slow-Consumer Policy

- Per-client queue is bounded at 500 messages.
- If the queue fills, the server sends `{"type":"error","code":"slow_consumer"}` and closes with code `1008`.
- Client should reconnect with its last known `offset`.

## Event Deduplication

Every `AuctionEvent` has a unique `event_id` (UUID v4).
Clients must maintain a `Set<string>` of recently seen `event_id`s and discard duplicates.
The dedup window needs to cover at most the reconnect overlap (typically < 100 events).
