
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isOpen, recordSuccess, recordFailure, resetAll } from "../circuit-breaker.js";

const MODEL = "test/model-a";

beforeEach(() => { resetAll(); });
afterEach(() => { vi.useRealTimers(); });

describe("circuit breaker", () => {
  it("starts CLOSED — isOpen returns false", () => {
    expect(isOpen(MODEL)).toBe(false);
  });

  it("opens after 3 consecutive failures", () => {
    recordFailure(MODEL);
    recordFailure(MODEL);
    expect(isOpen(MODEL)).toBe(false);
    recordFailure(MODEL);
    expect(isOpen(MODEL)).toBe(true);
  });

  it("resets failure count on success", () => {
    recordFailure(MODEL);
    recordFailure(MODEL);
    recordSuccess(MODEL);
    recordFailure(MODEL);
    recordFailure(MODEL);
    // Only 2 failures since last success — should still be CLOSED
    expect(isOpen(MODEL)).toBe(false);
  });

  it("transitions to HALF_OPEN after 30s and allows one probe", () => {
    vi.useFakeTimers();
    recordFailure(MODEL);
    recordFailure(MODEL);
    recordFailure(MODEL);
    expect(isOpen(MODEL)).toBe(true);

    // Advance 30 seconds
    vi.advanceTimersByTime(30_001);
    // HALF_OPEN — isOpen returns false to allow one probe
    expect(isOpen(MODEL)).toBe(false);
  });

  it("re-opens immediately on failure in HALF_OPEN state", () => {
    vi.useFakeTimers();
    recordFailure(MODEL);
    recordFailure(MODEL);
    recordFailure(MODEL);
    vi.advanceTimersByTime(30_001);
    isOpen(MODEL); // transition to HALF_OPEN
    recordFailure(MODEL); // probe fails
    expect(isOpen(MODEL)).toBe(true);
  });

  it("closes fully on success in HALF_OPEN state", () => {
    vi.useFakeTimers();
    recordFailure(MODEL);
    recordFailure(MODEL);
    recordFailure(MODEL);
    vi.advanceTimersByTime(30_001);
    isOpen(MODEL); // transition to HALF_OPEN
    recordSuccess(MODEL);
    expect(isOpen(MODEL)).toBe(false);
  });

  it("independent state per model", () => {
    const modelB = "test/model-b";
    recordFailure(MODEL);
    recordFailure(MODEL);
    recordFailure(MODEL);
    expect(isOpen(MODEL)).toBe(true);
    expect(isOpen(modelB)).toBe(false);
  });
});
