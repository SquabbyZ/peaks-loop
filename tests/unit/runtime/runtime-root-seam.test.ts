/**
 * AC2 — the sensitivity control for the runtime-path seam.
 *
 * This is the control every text rule this session produced failed. The claim
 * under test is NOT "a removed guard is noticed" (that is detection, and
 * detection is what failed three times). The claim is: **a newly written
 * unguarded join into the runtime root does not compile.**
 *
 * The type legs below are checked by `tsc -p tsconfig.json` — the whole
 * `tests/` tree is in the include list — so they are enforced on every
 * typecheck, not only when this suite runs. `@ts-expect-error` is
 * load-bearing in BOTH directions:
 *
 *   - if the join it annotates ever compiles, tsc reports TS2578
 *     ("Unused '@ts-expect-error' directive") and the typecheck fails;
 *   - if the seam ever stopped rejecting a raw string, that is the same event.
 *
 * The runtime legs check the other half: the guard still refuses what it
 * refused before, and the guarded path is still byte-identical to the path the
 * legacy spelling produced.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { guardRuntimeSegment, runtimeRoot } from '../../../src/shared/runtime-root.js';

const PROJECT_ROOT = join('C:', 'tmp', 'project');

describe('runtime-path seam — a new unguarded join is an authoring-time error', () => {
  it('a NEW join carrying an unguarded string fails to compile', () => {
    const sessionId: string = '2026-09-15-session-abcd12';
    const root = runtimeRoot(PROJECT_ROOT);

    // The legacy spelling, written as new code. `join` requires a
    // GuardedSegment and `sessionId` is a plain string, so this does not
    // compile. During the 108-slot migration this is the exact line a
    // developer would write next.
    // @ts-expect-error — a raw string is not a GuardedSegment; guard it first
    const leaked = root.join(sessionId);

    expect(typeof leaked).toBe('string');
  });

  it('a new join whose segments were guarded IS accepted (the other direction)', () => {
    const sessionId: string = '2026-09-15-session-abcd12';
    const root = runtimeRoot(PROJECT_ROOT);

    // Same join, same caller-supplied id, one guard applied. Green.
    const resolved = root.join(
      guardRuntimeSegment(sessionId, 'session id'),
      guardRuntimeSegment('rd', 'role')
    );

    expect(resolved).toBe(
      join(PROJECT_ROOT, '.peaks', '_runtime', '2026-09-15-session-abcd12', 'rd')
    );
  });

  it("the guard's RESULT carries the brand (a guard one function away still types)", () => {
    const guarded = guardRuntimeSegment('rd', 'role');
    // No `@ts-expect-error` here on purpose: this line must compile, which is
    // what lets `requestArtifactRequestsDir` and `assertSafeHandoffIds` hand a
    // guarded value to a caller instead of re-deriving it.
    const resolved = runtimeRoot(PROJECT_ROOT).join(guarded);
    expect(resolved).toBe(join(PROJECT_ROOT, '.peaks', '_runtime', 'rd'));
  });
});

describe('runtime-path seam — behaviour is unchanged', () => {
  it('a legal id resolves to the byte-identical directory the legacy join produced', () => {
    const sessionId = '2026-09-13-session-21878f';
    const legacy = join(PROJECT_ROOT, '.peaks', '_runtime', sessionId, 'qa', 'requests');
    const viaSeam = runtimeRoot(PROJECT_ROOT).join(
      guardRuntimeSegment(sessionId, 'session id'),
      guardRuntimeSegment('qa', 'role'),
      guardRuntimeSegment('requests', 'leaf')
    );
    expect(viaSeam).toBe(legacy);
  });

  it('the escapes this line exists for are still refused', () => {
    // The three measured carriers: `--session-id ../../../PWNED-R34`
    // (request-artifact-service R5), `--sid ../../../../SIDOUT` and
    // `--rid ../../../../../../README` (handoff-service).
    for (const unsafe of [
      '../../../PWNED-R34',
      '../../../../SIDOUT',
      '../../../../../../README',
      '..',
      '',
      'C:\\abs',
      '/abs',
      'a\\b'
    ]) {
      expect(() => guardRuntimeSegment(unsafe, 'session id')).toThrow(
        /must be a single path segment/
      );
    }
  });

  it('LIMIT, named: the segment guard ADMITS a multi-segment string like `a/b`', () => {
    // Measured, not assumed — this assertion failed the first time this control
    // was run, when `a/b` was listed with the refusals above. `isUnsafePathInput`
    // rejects separators as the TRAVERSAL carrier (`..`), not as nested
    // structure, so `a/b` has no `..`, no leading slash and no empty segment and
    // passes. It cannot escape the runtime root — it nests inside it.
    //
    // This is the same gap `handoff-service.ts` documents when it says
    // `isUnsafePathInput` "alone is NOT enough for the rid — it admits `a/b`,
    // which `request-artifact-service.ts` would reject" — the rid axis needs
    // `REQUEST_ID_PATTERN` as well, and callers on that axis apply it before
    // calling this. The seam brands a *segment*, so it is exact for the escape
    // class and permissive about nesting. Stated here rather than left implicit.
    expect(guardRuntimeSegment('a/b', 'session id')).toBe('a/b');
  });

  it('the bare root is still reachable for reads, and does not require a segment', () => {
    expect(runtimeRoot(PROJECT_ROOT).dir()).toBe(join(PROJECT_ROOT, '.peaks', '_runtime'));
  });
});
