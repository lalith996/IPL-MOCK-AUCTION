## 2024-05-09 - [Preventing Unnecessary Global Re-renders]
**Learning:** In `AuctionRoomPage`, subscribing to frequently updating state like `currentBidLakhs` at the top level caused the entire page (including all 10 `RationalePanel`s and `RosterPanel`s) to re-render synchronously on every bid, blocking the main thread.
**Action:** Extract specific reactive UI elements (like `ScreenReaderAnnouncer` and `PlayerArea`) into their own components that subscribe directly to the store, and wrap heavy components with `React.memo()`. Always colocate state subscriptions as close to the UI as possible.

## 2024-05-10 - [O(1) Set Size Management in High-Frequency Event Handlers]
**Learning:** In `auctionStore.ts`, keeping the deduplication set (`seenEventIds`) under its limit was done by converting the Set to an Array, shifting the first item, clearing the Set, and adding all items back. This causes an O(N) penalty (memory and time) per new event after reaching the limit. Since JavaScript Sets maintain insertion order, we can retrieve and delete the oldest element in O(1) time using `set.keys().next().value`.
**Action:** When capping a Set's size in a hot path (like WebSocket event reducers), never convert to an array to remove the oldest element. Use `set.delete(set.keys().next().value)` for O(1) removals.
