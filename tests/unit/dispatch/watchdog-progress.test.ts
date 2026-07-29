/**
 * Slice 2026-07-29-dispatch-stall-governance / S4 — no-progress
 * watchdog (AC-3.4).
 *
 * The PRD requires a bounded no-progress watchdog: a batch making
 * no observable progress for a bounded window emits a watchdog
 * signal **before** the full deadline elapses.
 *
 * `awaitBatch` (S4 unified service) fires the watchdog when every
 * slot's last observed progress is older than `noProgressMs`. The
 * watchdog writes the result as `outcome: 'no-progress'`, distinct
 * from the post-deadline `timed-out` outcome.
 */
import { describe, expect, it } from 'vitest';
import { awaitBatch } from '../../../src/services/dispatch/await-batch.js';

describe('awaitBatch — no-progress watchdog (AC-3.4)', () => {
  it('fires no-progress when every slot has been stalled for the bounded window', async () => {
    let tick = 0;
    const r = await awaitBatch(
      2,
      ['/a', '/b'],
      5_000,
      {
        defaultTimeoutMs: 30_000,
        hardCapMs: 5_000,
        noProgressMs: 100,
        readOutcome: () => null,
        now: () => tick * 10,
        schedule: (cb) => {
          tick += 1;
          Promise.resolve().then(cb);
        }
      }
    );
    expect(r.outcome).toBe('no-progress');
  });

  it('does NOT fire no-progress when all slots complete before the budget', async () => {
    let tick = 0;
    let alternation = 0;
    const r = await awaitBatch(
      2,
      ['/a', '/b'],
      5_000,
      {
        defaultTimeoutMs: 30_000,
        hardCapMs: 5_000,
        noProgressMs: 100,
        readOutcome: (p) => {
          // Both '/a' and '/b' advance quickly: '/a' returns 'done'
          // on tick 3, '/b' returns 'done' on tick 5. After both
          // reach done, the loop exits with `outcome: 'completed'`
          // and the watchdog never has a chance to fire (every
          // slot is finished).
          alternation += 1;
          if ((p === '/a' && alternation >= 3) ||
              (p === '/b' && alternation >= 5)) {
            return 'done';
          }
          return null;
        },
        now: () => tick * 10,
        schedule: (cb) => {
          tick += 1;
          Promise.resolve().then(cb);
        }
      }
    );
    // Both slots completed — the batch outcome is `completed` and
    // the watchdog never fires.
    expect(r.outcome).toBe('completed');
    expect(r.outcome).not.toBe('no-progress');
  });
});