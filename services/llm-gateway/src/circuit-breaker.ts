/**
 * Per-model circuit breaker.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (probe) → CLOSED
 *
 * Thresholds:
 *   - 3 consecutive failures → OPEN
 *   - 30s cooldown → HALF_OPEN (one probe allowed)
 *   - Probe success → CLOSED; probe failure → back to OPEN
 */

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_THRESHOLD = 3;
const RESET_MS = 30_000;

interface BreakerState {
  state: State;
  failures: number;
  openedAt: number | null;
}

const _breakers = new Map<string, BreakerState>();

function _get(model: string): BreakerState {
  let s = _breakers.get(model);
  if (!s) {
    s = { state: "CLOSED", failures: 0, openedAt: null };
    _breakers.set(model, s);
  }
  return s;
}

export function isOpen(model: string): boolean {
  const s = _get(model);
  if (s.state === "OPEN") {
    const elapsed = Date.now() - (s.openedAt ?? 0);
    if (elapsed >= RESET_MS) {
      s.state = "HALF_OPEN";
      return false; // allow one probe
    }
    return true;
  }
  return false;
}

export function recordSuccess(model: string): void {
  const s = _get(model);
  s.state = "CLOSED";
  s.failures = 0;
  s.openedAt = null;
}

export function recordFailure(model: string): void {
  const s = _get(model);
  s.failures += 1;
  if (s.state === "HALF_OPEN" || s.failures >= FAILURE_THRESHOLD) {
    s.state = "OPEN";
    s.openedAt = Date.now();
    s.failures = 0;
  }
}

/** For testing — reset all breakers. */
export function resetAll(): void {
  _breakers.clear();
}
