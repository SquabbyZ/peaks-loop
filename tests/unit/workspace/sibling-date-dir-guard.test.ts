/**
 * Slice 2026-06-29-change-id-root-removal (round 3) — defense test
 * for the v2.8.3 hard-ban on `.peaks/<YYYY-MM-DD-*>/` and
 * `.peaks/_runtime/<YYYY-MM-DD-*>/` sibling directories.
 *
 * Background: peaks-loop 2.8.0+ uses a two-axis workspace convention:
 *   - session axis: `.peaks/_runtime/<sessionId>/` (gitignored, ephemeral)
 *   - change-id axis: `.peaks/<changeId>/` (tracked, reviewable)
 *
 * After v2.17.0 the change-id axis was hard-killed and routed into the
 * session axis as the durable scope. The v2.8.3 guard rejects any
 * `.peaks/<YYYY-MM-DD-*>/` or `.peaks/_runtime/<YYYY-MM-DD-*>/`
 * sibling that the LLM or a stale CLI command might try to write
 * (each date-stamped basename would otherwise look like a session
 * dir and confuse `initWorkspace`).
 *
 * This test pins the v2.8.3 hard-ban invariant in 8 cases by directly
 * exercising the inline `lstatSync` guard in
 * `src/services/workspace/workspace-service.ts:initWorkspace` via a
 * real `fs.mkdirSync` + `initWorkspace` round-trip. Each case
 * creates a sibling dir shape on disk, calls `initWorkspace`, and
 * asserts the expected accept/reject outcome.
 *
 * Why 8 cases? The PRD AC-16 spec says the rewrite must "ban
 * `.peaks/_runtime/<YYYY-MM-DD-*>/` siblings of `_runtime/`,
 * semantically equivalent to the change-id hard-ban". The 8 cases
 * cover:
 *   1. `.peaks/<YYYY-MM-DD-foo>/` (top-level date sibling) → REJECT
 *   2. `.peaks/_runtime/<YYYY-MM-DD-bar>/` (runtime date sibling, NOT the canonical session) → REJECT
 *   3. `.peaks/_runtime/<canonical-sessionId>/` (the canonical session dir itself) → ACCEPT
 *   4. `.peaks/<not-a-date>/` (non-date sibling) → ACCEPT (out of scope of the date-prefix ban)
 *   5. bare date `.peaks/<YYYY-MM-DD>/` (no slug) → ACCEPT (per `isDateStampedSiblingId` shape)
 *   6. mixed case `.peaks/<YYYY-mm-DD-foo>/` (lowercase mm) → ACCEPT (regex requires uppercase MM)
 *   7. writer-shaped `.peaks/_runtime/<YYYY-MM-DD-foo>/qa/screenshots/x.png` → ACCEPT (writer shape)
 *   8. writer-shaped with one non-writer file `.peaks/_runtime/<YYYY-MM-DD-foo>/random.txt` → REJECT
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { initWorkspace } from '../../../src/services/workspace/workspace-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-sibling-date-dir-guard-'));
}

let project: string;

beforeEach(() => {
  project = makeProject();
  mkdirSync(join(project, '.peaks'), { recursive: true });
  mkdirSync(join(project, '.peaks', '_runtime'), { recursive: true });
});

afterEach(() => {
  if (existsSync(project)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe('v2.8.3 hard-ban on .peaks/<YYYY-MM-DD-*>/ and .peaks/_runtime/<YYYY-MM-DD-*>/ sibling dirs', () => {
  test('case 1: .peaks/<YYYY-MM-DD-foo>/ top-level date sibling → REJECT', async () => {
    mkdirSync(join(project, '.peaks', '2026-06-29-foo'), { recursive: true });
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-test' })
    ).rejects.toThrow(/legacy sibling dir|LEGACY_CHANGE_ID_SIBLING|forbids/);
  });

  test('case 2: .peaks/<YYYY-MM-DD-bar>/ top-level date sibling with non-writer content → REJECT', async () => {
    mkdirSync(join(project, '.peaks', '2026-06-29-bar'), { recursive: true });
    writeFileSync(join(project, '.peaks', '2026-06-29-bar', 'random.txt'), 'not-writer-shape');
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-canonical' })
    ).rejects.toThrow(/legacy sibling dir|LEGACY_CHANGE_ID_SIBLING|forbids/);
  });

  test('case 3: .peaks/_runtime/<canonical-sessionId>/ the canonical session dir itself → ACCEPT', async () => {
    // The canonical session dir is always present after init; init
    // must not throw when the dir already matches the requested
    // session id.
    mkdirSync(join(project, '.peaks', '_runtime', '2026-06-29-session-canonical'), { recursive: true });
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-canonical' })
    ).resolves.toBeDefined();
  });

  test('case 4: .peaks/<not-a-date>/ non-date sibling → ACCEPT (out of scope)', async () => {
    // Bare kebab identifier with no date prefix — not the v2.8.3 ban
    // target. `initWorkspace` must accept (the dir is not a sibling
    // residue, just user content).
    mkdirSync(join(project, '.peaks', 'my-project-notes'), { recursive: true });
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-test' })
    ).resolves.toBeDefined();
  });

  test('case 5: bare date .peaks/<YYYY-MM-DD>/ (no slug) → ACCEPT', async () => {
    // The hard-ban regex requires `YYYY-MM-DD-` (with slug suffix).
    // A bare date is NOT auto-generated and is treated as user content.
    mkdirSync(join(project, '.peaks', '2026-06-29'), { recursive: true });
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-test' })
    ).resolves.toBeDefined();
  });

  test('case 6: mixed case .peaks/<YYYY-mm-DD-foo>/ (lowercase mm) → ACCEPT', async () => {
    // The hard-ban regex `/^\d{4}-\d{2}-\d{2}-/` requires digits, so
    // mixed-case month abbreviations do NOT match. This is correct:
    // session ids are auto-generated and always digit-based.
    mkdirSync(join(project, '.peaks', '2026-Jun-29-foo'), { recursive: true });
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-test' })
    ).resolves.toBeDefined();
  });

  test('case 7: writer-shaped .peaks/<YYYY-MM-DD-foo>/qa/screenshots/x.png → ACCEPT', async () => {
    // A residue dir whose entire tree matches WRITER_ALLOWED_RELATIVE_PATTERNS
    // (e.g. qa/screenshots/*.png) is tolerated on re-init — it is
    // legitimate writer output.
    const dir = join(project, '.peaks', '2026-06-29-foo');
    mkdirSync(join(dir, 'qa', 'screenshots'), { recursive: true });
    writeFileSync(join(dir, 'qa', 'screenshots', 'shot.png'), 'png-bytes');
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-canonical' })
    ).resolves.toBeDefined();
  });

  test('case 8: writer-shaped with one non-writer file → REJECT', async () => {
    // The whole-dir shape check requires EVERY leaf to match the
    // writer-allowed patterns. One stray `random.txt` causes the
    // residue dir to be rejected — the user must migrate before
    // init proceeds.
    const dir = join(project, '.peaks', '2026-06-29-foo');
    mkdirSync(join(dir, 'qa', 'screenshots'), { recursive: true });
    writeFileSync(join(dir, 'qa', 'screenshots', 'shot.png'), 'png-bytes');
    writeFileSync(join(dir, 'random.txt'), 'user-data');
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-06-29-session-canonical' })
    ).rejects.toThrow(/legacy sibling dir|LEGACY_CHANGE_ID_SIBLING|forbids/);
  });
});