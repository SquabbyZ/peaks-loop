// tests/unit/_setup/clock.ts
//
// Fake-timer helper. The legacy suite used real `setTimeout`/`setInterval`
// in many tests and a real 7-day retention sweep in `bootstrapLogger`, which
// contributed to the 3h wall clock. The rebuild rule: unit tests that touch
// time MUST use vi.useFakeTimers() and advance manually. This helper wraps
// the boilerplate so test files only need to opt in once.

import { afterEach, beforeEach, vi } from 'vitest';

export interface FrozenClock {
  /** Anchor time used by `useFakeTimers`. */
  readonly now: Date;
}

/**
 * Start fake timers at `now` (default: 2026-07-30T00:00:00Z, the day the
 * epic started). Restores real timers on `afterEach` so the next test file
 * starts from a clean clock.
 */
export function freezeTimeAt(now: Date = new Date('2026-07-30T00:00:00Z')): FrozenClock {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  return { now };
}

/** Advance fake timers by `ms` milliseconds. */
export function advanceTime(ms: number): void {
  vi.advanceTimersByTime(ms);
}
