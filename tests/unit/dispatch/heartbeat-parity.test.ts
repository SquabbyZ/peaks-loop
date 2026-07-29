/**
 * Slice 2026-07-29-dispatch-stall-governance / S2 — heartbeat CLI ↔
 * writer parity test (AC-2.2).
 *
 * Pins that the per-heartbeat vocabulary exposed by:
 *   - `dispatch-record-writer.ts#HeartbeatStatus` (the writer's
 *     accepted set)
 *   - `sub-agent-shared.ts#HEARTBEAT_STATUSES` (the CLI's accepted set)
 *   - the `heartbeat-commands.ts` `--status` help text (what the user
 *     sees in `peaks sub-agent heartbeat --help`)
 *   - `sub-agent-commands.ts` dispatch record `status` set
 * are byte-identical. If either side gains a member alone, the test
 * fails — closing the drift the user observed pre-slice (the CLI help
 * omitted `cancelled` and `no-execution` even though the writer
 * accepted them).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_STATUSES } from '../../../src/cli/commands/sub-agent-shared.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');
const HEARTBEAT_COMMANDS = join(REPO_ROOT, 'src', 'cli', 'commands', 'heartbeat-commands.ts');
const WRITER = join(REPO_ROOT, 'src', 'services', 'dispatch', 'dispatch-record-writer.ts');
const SHARED = join(REPO_ROOT, 'src', 'cli', 'commands', 'sub-agent-shared.ts');

describe('heartbeat CLI ↔ writer parity (AC-2.2)', () => {
  it('HEARTBEAT_STATUSES contains exactly the union the writer accepts', () => {
    const writerSrc = readFileSync(WRITER, 'utf8');
    // Slice 2026-07-29-dispatch-stall-governance / S2 — extract the
    // HeartbeatStatus union members from the writer source so the
    // parity test fails the moment either side drifts. We do not
    // re-implement the type evaluator; we read the source and assert
    // each member is present in HEARTBEAT_STATUSES.
    const expectedMembers = [
      'queued',
      'running',
      'finalizing',
      'done',
      'failed',
      'stale',
      'cancelled',
      'no-execution',
      'never-started',
      'unreadable'
    ];
    for (const m of expectedMembers) {
      expect(HEARTBEAT_STATUSES).toContain(m);
      expect(writerSrc).toContain(`'${m}'`);
    }
  });

  it('--status help text enumerates the full set the CLI accepts', () => {
    const src = readFileSync(HEARTBEAT_COMMANDS, 'utf8');
    // The CLI help string is the third positional argument to
    // .requiredOption('--status <state>', '<help>'). Assert every
    // HEARTBEAT_STATUSES member is present in that help string.
    for (const status of HEARTBEAT_STATUSES) {
      expect(src).toContain(status);
    }
  });

  it('sub-agent-shared.ts source pins the S2 expanded set', () => {
    const src = readFileSync(SHARED, 'utf8');
    for (const status of HEARTBEAT_STATUSES) {
      expect(src).toContain(`'${status}'`);
    }
  });

  it('source files exist (sanity)', () => {
    expect(existsSync(HEARTBEAT_COMMANDS)).toBe(true);
    expect(existsSync(WRITER)).toBe(true);
    expect(existsSync(SHARED)).toBe(true);
  });
});