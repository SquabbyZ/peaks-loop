// tests/unit/runtime/no-runtime-input-guard-rule-d-controls.test.ts
//
// Rule D's negative controls, pinned limits and re-measured censuses — moved
// VERBATIM out of `no-runtime-input-guard.test.ts` for the C wave 7 file-size
// split (rid 2026-10-01-c-wave7-excess-w7-5). Companion to
// `no-runtime-input-guard-rule-d.test.ts`: same describe title, same cases,
// split at the file-size cap, not at a behavioural seam. The RULE D banner is
// in `no-runtime-input-guard-scan.ts`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOT_SCANNED_LITERAL_FIRST,
  PROJECT_ROOT,
  SRC_SCAN,
  parseSourceFile,
  relativeToRoot
} from './no-runtime-input-guard-scan.js';
import {
  findLiteralFirstIdJoins,
  findUnguardedRuntimeIdJoins
} from './no-runtime-input-guard-detect-ruled.js';

/**
 * A literal-first row as this file names it: the pinned slot, then the ids joined after
 * it. Deliberately no line number — rid `2026-10-05-line-pinned-guards`. Both censuses
 * below used to key on the line, so deleting a comment ABOVE one of these joins reddened
 * the suite while changing nothing about the join. The line is still printed in the
 * failure message for navigation; a row that appears, disappears or changes its slots
 * still fails, and a second row matching the same pair in the same file fails as NEW.
 */
function rowText(h: { pinned: string; later: readonly string[] }): string {
  return `pinned=${h.pinned} later=[${h.later.join(',')}]`;
}

describe('rule D — an id joined into the runtime tree carries a guard (slice 2026-09-14)', () => {
  it('negative control — the five escapes of repair R1 are all detected', () => {
    // Each fixture is the PRE-FIX source shape of a site the security audit of
    // `2026-09-14-cli-id-escape-instrumentation` measured with a live CLI write
    // outside the project root under `ok: true`. Pinning them here is the
    // difference between an instrument and a description: if a future edit
    // softens the predicate or the slot rule, these fail.
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      // The predicate fix, in one fixture — and the sharpest form of the AC3
      // sensitivity control. `REQUEST_ID_PATTERN.test(options.requestId)` is a
      // guard on the EXPRESSION `options.requestId`. Under the old name-based
      // predicate it marked the NAME `options` guarded and thereby cleared the
      // whole join below: measured on `request-artifact-service.ts:431`, which
      // this rule reported as NOTHING while the repo-wide assertion stayed
      // green. Under the expression predicate the same join reports BOTH of its
      // unguarded id slots, which is the true answer.
      //
      // `options.role` is included deliberately: in the live file that segment
      // is a role name, and no guard covered it either. Repair R5 did NOT widen
      // the predicate to recognise `VALID_ROLES.has(...)` — a file-scoped
      // guard-set change would alter every scanned file to silence one slot.
      // The role is guarded at the join instead. The fixture is unchanged, so a
      // future softening of the expression predicate still fails here.
      [
        'guard on `options.requestId` must not clear `options.sessionId`',
        [
          `function find(options: any) {`,
          `  if (!REQUEST_ID_PATTERN.test(options.requestId)) throw new Error('bad rid');`,
          `  const dir = join(options.projectRoot, '.peaks', '_runtime', options.sessionId, options.role, 'requests');`,
          `  return dir;`,
          `}`
        ].join('\n'),
        ['options.sessionId', 'options.role']
      ],
      // qa-business-review-state.ts:74-76. The sid is guarded one function
      // earlier, which is why the sid-only reader called this file covered.
      [
        '`getQaReviewPath` joins a second id one function after the guarded dir',
        [
          `function getQaReviewDir(projectRoot: string, sessionId: string): string {`,
          `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
          `  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'qa-business-reviews');`,
          `}`,
          `function getQaReviewPath(projectRoot: string, sessionId: string, requestId: string): string {`,
          `  return join(getQaReviewDir(projectRoot, sessionId), \`\${requestId}.json\`);`,
          `}`
        ].join('\n'),
        ['`${requestId}.json`']
      ],
      // slice-review-state.ts:80 — the identical shape on the slice-id axis.
      [
        '`getReviewPath` joins a second id one function after the guarded dir',
        [
          `function getReviewDir(projectRoot: string, sessionId: string): string {`,
          `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
          `  return resolve(projectRoot, '.peaks', '_runtime', sessionId, 'slice-reviews');`,
          `}`,
          `function getReviewPath(projectRoot: string, sessionId: string, sliceId: string): string {`,
          `  return join(getReviewDir(projectRoot, sessionId), \`\${sliceId}.json\`);`,
          `}`
        ].join('\n'),
        ['`${sliceId}.json`']
      ],
      // loop-eval-commands.ts:229 — TWO ids in one join, the first guarded.
      [
        'a guarded first id does not clear a later id in the same join',
        [
          `function write(projectRoot: string, options: any, rid: string) {`,
          `  if (isUnsafePathInput(options.session)) throw new Error('bad sid');`,
          `  const dir = join(projectRoot, '.peaks', '_runtime', options.session, 'loop', rid, 'cycles');`,
          `  mkdirSync(dir, { recursive: true });`,
          `}`
        ].join('\n'),
        ['rid']
      ],
      // handoff-service.ts:63-65, added by the commit that instrumented this
      // class. BOTH ids are caller-supplied, so both are asserted.
      [
        'an unguarded two-id join reports BOTH ids, not the first',
        [
          `export function handoffRelativePath(sessionId: string, requestId: string): string {`,
          `  return join('.peaks', '_runtime', sessionId, 'prd', \`handoff-\${requestId}.md\`);`,
          `}`
        ].join('\n'),
        ['sessionId', '`handoff-${requestId}.md`']
      ]
    ];

    for (const [name, source, expected] of cases) {
      expect(
        findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)).map((h) => h.segment),
        name
      ).toEqual(expected);
    }
  });

  it('negative control — a guard at the CALLER does not reach the builder (repair R5)', () => {
    // AC4's ruling, pinned. The measured defect was not "one unguarded
    // function": `createRequestArtifact` guarded its session id and its sibling
    // `transitionRequestArtifact` did not — and the sibling performs NO join of
    // its own (it delegates the path to `showRequestArtifact`), so a rule that
    // asserted entry points would have had nothing to assert on. What both end
    // at is one join, and that is where the guard belongs.
    //
    // The fixture makes the consequence visible: a guard written on the caller's
    // expression (`options.sessionId`) does not clear the builder's PARAMETER
    // (`sessionId`), because the predicate is expression-shaped. A guard at the
    // caller therefore cannot make the shared builder safe — only a guard inside
    // it can, which is what `requestArtifactRequestsDir` now carries.
    const callerOnlyGuard = [
      `function createRequestArtifact(options: any, sessionId: string, role: string) {`,
      `  if (isUnsafePathInput(options.sessionId)) throw new Error('bad sid');`,
      `  return requestArtifactRequestsDir(options.projectRoot, sessionId, role);`,
      `}`,
      `function requestArtifactRequestsDir(projectRoot: string, sessionId: string, role: string) {`,
      `  return join(projectRoot, '.peaks', '_runtime', sessionId, role, 'requests');`,
      `}`
    ].join('\n');
    expect(
      findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', callerOnlyGuard)).map(
        (h) => h.segment
      )
    ).toEqual(['sessionId', 'role']);

    const guardInBuilder = [
      `function createRequestArtifact(options: any, sessionId: string, role: string) {`,
      `  return requestArtifactRequestsDir(options.projectRoot, sessionId, role);`,
      `}`,
      `function requestArtifactRequestsDir(projectRoot: string, sessionId: string, role: string) {`,
      `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
      `  if (isUnsafePathInput(role)) throw new Error('bad role');`,
      `  return join(projectRoot, '.peaks', '_runtime', sessionId, role, 'requests');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', guardInBuilder))).toEqual([]);
  });

  it("negative control — QA's shape attack: the 10 catchable shapes are caught (repair R7)", () => {
    // Repair R7's AC1/AC3. Every fixture below is a PRE-FIX source shape that
    // the shipped predicate CLEARED while carrying an unchecked id. They are
    // here, and not merely in a session-scoped probe, because R1's sensitivity
    // control passed on the sites it already knew about and that is exactly why
    // this regression shipped.
    //
    // The pre-R1 name-based predicate reported 8 of QA's 12; the R1 predicate
    // reported 4. Six of the eight misses were the two defects fixed here:
    //   * `BinaryExpression` / `ConditionalExpression` read as an OR over the
    //     branches, so ONE pinned literal on either side cleared the slot.
    //   * `CallExpression` read as `arguments.every(...)`, vacuously TRUE for
    //     zero arguments.
    // Measured: 4/12 caught before, 10/12 after, repo-wide assertion still 0.
    const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      [
        'literal-prefixed concatenation clears an id',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', 'run-' + sid, 'x');`,
          `}`
        ].join('\n'),
        [`'run-'+sid`]
      ],
      [
        'nullish-coalesce with a pinned fallback does not clear the id half',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid ?? 'default', 'x');`,
          `}`
        ].join('\n'),
        [`sid??'default'`]
      ],
      [
        'conditional with a literal branch clears an id',
        [
          `function f(root: string, sid: string, ok: boolean) {`,
          `  return join(root, '.peaks', '_runtime', ok ? sid : 'adhoc', 'x');`,
          `}`
        ].join('\n'),
        [`ok?sid:'adhoc'`]
      ],
      [
        'a zero-argument call in the id slot is not a guard (vacuous `every`)',
        [
          `function f(root: string) {`,
          `  return join(root, '.peaks', '_runtime', currentSid(), 'x');`,
          `}`
        ].join('\n'),
        ['currentSid()']
      ],
      [
        'a zero-argument METHOD call in the id slot is not a guard',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid.trim(), 'x');`,
          `}`
        ].join('\n'),
        ['sid.trim()']
      ],
      [
        'a second id joined to a builder one function later is reported',
        [
          `function runtimeDir(root: string, sid: string) {`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return resolve(root, '.peaks', '_runtime', sid, 'reviews');`,
          `}`,
          `function reviewPath(root: string, sid: string, rid: string) {`,
          `  return join(runtimeDir(root, sid), rid + '.json');`,
          `}`
        ].join('\n'),
        [`rid+'.json'`]
      ]
    ];
    for (const [name, source, expected] of cases) {
      expect(
        findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)).map((h) => h.segment),
        name
      ).toEqual(expected);
    }

    // The other four fixtures of the 12 — E1 baseline, E9, E10, E11 — were
    // ALREADY caught and are pinned by the tests above (the two-slot case, the
    // template literal, and the spread), so they are not restated here.
    //
    // AND the counterweight, without which the two fixes above are a rule that
    // reports everything: a live site whose `??` fallback is a pinned literal
    // and whose id half IS guarded at its own function's entry must stay GREEN.
    // `request-commands.ts:372` is that site; this is its shape.
    const liveShaped = [
      `function action(root: string, sid: string | undefined) {`,
      `  let resolvedSessionId = sid;`,
      `  if (resolvedSessionId !== undefined && isUnsafePathInput(resolvedSessionId)) {`,
      `    throw new Error('bad sid');`,
      `  }`,
      `  return join(root, '.peaks', '_runtime', resolvedSessionId ?? 'default');`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', liveShaped))).toEqual([]);
  });

  it('limit (n): a guard clears a slot by FILE-scoped expression text, not by scope or domination', () => {
    // REPAIR R7 DID NOT CLOSE THIS, and this test is the statement of that —
    // a passing test, not a disclaimer, so the residue cannot be mistaken for
    // coverage. Four shapes are missed; the first two are QA's E7/E8, the rest
    // are R7's AC4 extension. Each was attacked against the shipped rule and
    // each clears.
    //
    // (1) A guard in a DIFFERENT FUNCTION with a same-named binding. The shape
    //     was live in `playwright-session-store.ts` until repair 014, which put
    //     the join and its guard back in one function (`defaultUserDataDir`):
    //     before that, deleting the guard from
    //     `sessionFilePath` (a different function) made the rule report that
    //     join, which is how we know the guard, not the rule, was clearing it.
    //     This is also the fixture QA wrote as E7.
    //
    // (2) A guard AFTER the join, (3) a value REASSIGNED between the guard and
    //     the join, and (4) an id on the RECEIVER of a method call — which
    //     `isGuardedSlot` never walks, since it asks about a call's ARGUMENTS
    //     only. R7's AC4 extension found these; (2) and (3) are DOMINATION
    //     failures, so no scoping rule reaches them either: the guard is in the
    //     join's own function and still does not govern it.
    const missed: ReadonlyArray<readonly [string, string]> = [
      [
        'guard in a sibling function with a same-named binding',
        [
          `function a(sid: string) {`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return sid;`,
          `}`,
          `function b(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', sid, 'x');`,
          `}`
        ].join('\n')
      ],
      [
        'guard written AFTER the join (does not dominate it)',
        [
          `function f(root: string, sid: string) {`,
          `  const p = join(root, '.peaks', '_runtime', sid, 'x');`,
          `  if (isUnsafePathInput(sid)) throw new Error('bad');`,
          `  return p;`,
          `}`
        ].join('\n')
      ],
      [
        'value reassigned between the guard and the join',
        [
          `function f(root: string, sid: string, other: string) {`,
          `  let id = sid;`,
          `  if (isUnsafePathInput(id)) throw new Error('bad');`,
          `  id = other;`,
          `  return join(root, '.peaks', '_runtime', id, 'x');`,
          `}`
        ].join('\n')
      ],
      [
        'id carried on the RECEIVER of a method call',
        [
          `function f(root: string, sid: string) {`,
          `  return join(root, '.peaks', '_runtime', [sid].join(''), 'x');`,
          `}`
        ].join('\n')
      ]
    ];
    for (const [name, source] of missed) {
      expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', source)), name).toEqual([]);
    }

    // (1) and (2) are the reason a FUNCTION-SCOPED guard set was measured and
    // rejected, not merely unconsidered: scoping closes (1) and takes the
    // 12-fixture attack to 12/12, but it reports 7 findings across 3 live
    // scanned files, because a guard HELPER (`assertSafeHandoffIds`) puts the
    // guard's text in a different function from every call site by
    // construction, and `verdict-aggregate-command.ts`'s readers take the
    // guarded value as a parameter — syntactically identical to fixture (1).
    // See the reach note for the full measurement. (2) and (3) remain after
    // any scoping rule, because scope is not domination.
  });

  it('limit (m): a join whose ROOT is a local const is still invisible', () => {
    // Stated as a passing test because it is the shape limit (l) used to hide,
    // one level down. `slice-integrate-commands.ts:30` is the live instance
    // (`const dir = resolve(… '_runtime' …); join(dir, \`${sliceId}.json\`)`); it
    // is guarded by hand and named in AC4's residue rather than covered here.
    // Following the const is a dataflow step, and the version of it that also
    // follows ARRAY elements would flag `verdict-aggregate-command.ts`'s
    // `candidates` → `join(dir, name)`, whose ids ARE guarded at the source.
    const fixture = [
      `function load(projectRoot: string, sessionId: string, sliceId: string) {`,
      `  if (isUnsafePathInput(sessionId)) throw new Error('bad sid');`,
      `  const dir = resolve(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');`,
      `  return join(dir, \`\${sliceId}.json\`);`,
      `}`
    ].join('\n');
    expect(findUnguardedRuntimeIdJoins(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it("pins the literal-first census inside the rule's reach (measurement, not assurance)", () => {
    // Every join in the scanned layer that rule D cannot see. A NEW one fails
    // here — that is the point: the shape that hid a live escape must announce
    // itself, not wait to be noticed. Measured 2026-09-15: 7 in the whole of
    // `src/`, of which this is the only one in reach (the other 6 are named in
    // the reach note and are NOT scanned).
    //
    // Request 014 moved the join, and with it this row, out of
    // `playwright-commands.ts` into `playwright-session-store.ts` — the file the
    // guard that covers it lives in. The row is RE-POINTED rather than deleted:
    // the live census is what makes a new literal-first join announce itself,
    // and a future repair that replaced this expectation with `[]` would still
    // pass while the row it was meant to name had merely changed shape. The
    // synthetic plant below is the arm that keeps that from being silent.
    expect(
      SRC_SCAN.literalFirstJoins.map((h) => `${relativeToRoot(h.file)} ${rowText(h)}`),
      `measured rows, with lines for the note: ${JSON.stringify(
        SRC_SCAN.literalFirstJoins.map((h) => `${relativeToRoot(h.file)}:${h.line}`)
      )}`
    ).toEqual([
      "src/cli/commands/playwright-session-store.ts pinned='playwright-userdata' later=[terminalId]"
    ]);

    // The census DETECTOR, planted with the same shape off-tree: if the live row
    // above were ever the only thing keeping this test awake, an edit that
    // stopped `findLiteralFirstIdJoins` reporting the shape would leave the
    // assertion above unchanged and this one red.
    const planted = [
      `function f(root: string, sid: string) {`,
      `  return join(root, '.peaks', '_runtime', 'playwright-userdata', sid);`,
      `}`
    ].join('\n');
    expect(
      findLiteralFirstIdJoins(parseSourceFile('fixture.ts', planted)).map((h) => rowText(h))
    ).toEqual(["pinned='playwright-userdata' later=[sid]"]);
  });

  it('the 6 literal-first rows OUTSIDE the reach are named, and each named row is really there', () => {
    // Repair R7. The reach note used to ENUMERATE these rows; R5 replaced the
    // list with the words "unchanged" and this file went on asserting they were
    // named — a claim no artifact supported, which is the same defect class as
    // the rule passing a slot it never looked at. The names are back in the
    // reach note, and they are re-MEASURED here rather than trusted: read each
    // named file, and require the named slot and id to be what the note
    // says they are — exactly once. If the note drifts, this fails; if a row is
    // fixed and the note is not updated, this fails too; and a second row that
    // matches the same slot/id pair in the same file is a NEW row, so it fails
    // as well. The line is what a comment deletion moves, so it is reported and
    // not asserted.
    // Each named file is read, and the literal-first rows found in it are compared as a
    // MULTISET against the named list. That is strictly stronger than the old row-by-row
    // line lookup: a named row that is gone fails, a new row in a named file fails, and a
    // row that only MOVED does not — which is what a comment deletion above the join does.
    const expected = NOT_SCANNED_LITERAL_FIRST.map(
      (named) => `${named.file} pinned='${named.pinned}' later=[${named.later}]`
    ).sort();
    const found: string[] = [];
    const where = new Map<string, number[]>();
    for (const file of new Set(NOT_SCANNED_LITERAL_FIRST.map((named) => named.file))) {
      const parsed = parseSourceFile(file, readFileSync(join(PROJECT_ROOT, file), 'utf8'));
      for (const h of findLiteralFirstIdJoins(parsed)) {
        const key = `${file} ${rowText(h)}`;
        found.push(key);
        where.set(key, [...(where.get(key) ?? []), h.line]);
      }
    }
    expect(
      found.sort(),
      `rows and their measured lines: ${JSON.stringify([...where.entries()])}`
    ).toEqual(expected);
  });
});
