## 2024-05-09 - [Preventing Unnecessary Global Re-renders]
**Learning:** In `AuctionRoomPage`, subscribing to frequently updating state like `currentBidLakhs` at the top level caused the entire page (including all 10 `RationalePanel`s and `RosterPanel`s) to re-render synchronously on every bid, blocking the main thread.
**Action:** Extract specific reactive UI elements (like `ScreenReaderAnnouncer` and `PlayerArea`) into their own components that subscribe directly to the store, and wrap heavy components with `React.memo()`. Always colocate state subscriptions as close to the UI as possible.
