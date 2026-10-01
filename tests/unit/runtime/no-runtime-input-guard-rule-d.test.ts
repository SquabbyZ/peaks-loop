// tests/unit/runtime/no-runtime-input-guard-rule-d.test.ts
//
// Rule D's repo-wide assertions — moved VERBATIM out of
// `no-runtime-input-guard.test.ts` for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-5). Same suite, same case count repo-wide; the
// split is between files, not between behaviours. The RULE D banner (reach,
// repair R1/R5/R7 history) sits in `no-runtime-input-guard-scan.ts`, beside the
// scanned-file lists it describes. The negative-control fixture batteries are in
// `no-runtime-input-guard-rule-d-controls.test.ts` under the same describe.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  MEASURED_ESCAPE_MODULES,
  PROJECT_ROOT,
  SRC_SCAN,
  parseSourceFile,
  relativeToRoot
} from './no-runtime-input-guard-scan.js';
import {
  findLiteralFirstIdJoins,
  findUnguardedRuntimeIdJoins
} from './no-runtime-input-guard-detect-ruled.js';

describe('rule D — an id joined into the runtime tree carries a guard (slice 2026-09-14)', () => {
  it('parses a real part of the command layer (anti-silence)', () => {
    // Rule D's off-switch is silence: if the walk stops finding files, or the
    // join recogniser stops recognising joins, every assertion below is
    // vacuously green. Pin both against the live tree and against a fixture
    // that MUST be counted.
    expect(SRC_SCAN.scannedFiles.length).toBeGreaterThan(50);
    expect(SRC_SCAN.idJoinSites).toBeGreaterThan(0);
    expect(MEASURED_ESCAPE_MODULES.length).toBeGreaterThan(0);
    for (const rel of MEASURED_ESCAPE_MODULES) {
      expect(existsSync(join(PROJECT_ROOT, rel))).toBe(true);
    }
  });

  it('no unguarded id is joined into the runtime tree', () => {
    const offenders = SRC_SCAN.unguardedIdJoins.map(
      (hit) =>
        `${relativeToRoot(hit.file)}:${hit.line} joins ${hit.segment} after '_runtime' with no guard in the file`
    );
    expect(offenders).toEqual([]);
  });

  it('catches the measured escapes this rule was written for, and spares the guarded forms', () => {
    const BAD = [
      `const sid = opts.sessionId ?? 'ad-hoc';`,
      `const dir = join(projectRoot, '.peaks', '_runtime', sid, 'slice-reviews');`,
      `mkdirSync(dir, { recursive: true });`
    ].join('\n');
    expect(
      findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', BAD)).map((h) => h.line)
    ).toEqual([2]);

    // A guard anywhere in the file is enough — `verdict-aggregate-command.ts`
    // guards `sid` once at the action entry and three helpers 100 lines below
    // reuse it. A function-scoped rule would score those three as offenders.
    const GUARDED = [
      `function read(projectRoot: string, sid: string) {`,
      `  return join(projectRoot, '.peaks', '_runtime', sid, 'audit');`,
      `}`,
      `function action(opts: any) {`,
      `  const sid = opts.sid ?? 'default';`,
      `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
      `  return read(opts.project, sid);`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', GUARDED))).toEqual([]);

    // A PINNED NAME is not an id: `join(root, '.peaks', '_runtime', 'playwright-sessions')`
    // is a fixed directory, and flagging it would force a guard whose only
    // effect is to reject a literal the product wrote itself.
    const PINNED = [
      `const SESSIONS_DIR = 'playwright-sessions';`,
      `export const sessionsDir = (root: string) => join(root, '.peaks', '_runtime', SESSIONS_DIR);`,
      `export const fixed = (root: string) => join(root, '.peaks', '_runtime', 'fixtures');`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', PINNED))).toEqual([]);

    // `validateSessionId` throws and is a peer of `isUnsafePathInput`; a rule
    // that did not recognise it would flag a file that IS guarded, and the
    // remedy for a false positive is an allowlist — which is how this kind of
    // guard dies.
    const VALIDATED = [
      `function run(opts: any) {`,
      `  const v = validateSessionId(opts.sessionId);`,
      `  return join(opts.project, '.peaks', '_runtime', v.sessionId, 'audit-goal');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', VALIDATED))).toEqual([]);
  });

  it("pins rule D's reach, so it is not read as covering the service layer", () => {
    // The ~75 service-layer joins whose id comes from the canonical binding are
    // the job's §4.2 — a different trust class, deferred not cleared. They are
    // NOT scanned, and this test is the statement of that bound rather than a
    // comment someone can miss.
    expect(
      SRC_SCAN.scannedFiles.some((f) => relativeToRoot(f) === 'src/services/loop/loop-store.ts')
    ).toBe(false);
    // …and the surface repair R5 added is scanned rather than merely listed, so
    // a future edit that drops it from `MEASURED_ESCAPE_MODULES` fails here
    // instead of quietly restoring the file-outside-the-reach defect.
    expect(
      SRC_SCAN.scannedFiles.some(
        (f) => relativeToRoot(f) === 'src/services/artifacts/request-artifact-service.ts'
      )
    ).toBe(true);
    // …while the modules rule D DOES cover are the command layer plus the
    // measured-escape set, and nothing else.
    expect(
      SRC_SCAN.scannedFiles.every((f) => {
        const rel = relativeToRoot(f);
        return rel.startsWith('src/cli/commands/') || MEASURED_ESCAPE_MODULES.includes(rel);
      })
    ).toBe(true);
  });

  it('segments AFTER the id slot ARE asserted (was limit (k), closed 2026-09-14)', () => {
    // `join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, F)` has two
    // caller-supplied segments. The rule used to assert only the first — the one
    // immediately after `'_runtime'` — and this test PINNED that as a limit.
    // Repair R1 measured the cost of the limit: `loop-eval-commands.ts`'s
    // `join(… sid, 'loop', rid, 'cycles')` guarded `sid` and left `rid`, the CLI
    // positional, open; `peaks loop eval '../../../../…/EVILCYC' --capture-score`
    // created a directory outside the project root under `ok: true`.
    //
    // Both segments are asserted now. `sub-agent-shutdown-commands.ts` guards
    // both (`:49`/`:52`) and is the shape the fix copies.
    const fixture = `const p = join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, 'x.json');`;
    expect(
      findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', fixture)).map((h) => h.segment)
    ).toEqual(['sid', 'dispatchId']);
    const guarded = [
      `function f(root: string, sid: string, dispatchId: string) {`,
      `  if (isUnsafePathInput(sid)) throw new Error('bad sid');`,
      `  if (isUnsafePathInput(dispatchId)) throw new Error('bad dispatch');`,
      `  return join(root, '.peaks', '_runtime', sid, 'dispatch', dispatchId, 'x.json');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', guarded))).toEqual([]);
  });

  it('a pinned literal in the FIRST id slot no longer hides a later id (was limit (l))', () => {
    // The rule used to return nothing for the whole join when the slot after
    // `'_runtime'` was a pinned literal: not "guarded" and not "unguarded" —
    // INVISIBLE, numerator and denominator alike. On 2026-09-14 a live escape sat
    // one call away from exactly this shape. Two things changed in repair R1:
    // the later id is asserted, and the census below still names the shape.
    const fixture = [
      `const SESSIONS_DIR = 'playwright-sessions';`,
      `export const dir = (root: string, sid: string) =>`,
      `  join(root, '.peaks', '_runtime', SESSIONS_DIR, sid, 'x.json');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findUnguardedRuntimeIdJoins(parsed).map((h) => h.segment)).toEqual(['sid']);
    expect(
      findLiteralFirstIdJoins(parsed).map((h) => `${h.line}:${h.pinned}:[${h.later.join(',')}]`)
    ).toEqual(['3:SESSIONS_DIR:[sid]']);
  });
});
