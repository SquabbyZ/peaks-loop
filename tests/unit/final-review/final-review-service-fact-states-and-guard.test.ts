// tests/unit/final-review/final-review-service-fact-states-and-guard.test.ts
//
// F4 missing/empty/unreadable fact states and the guard-C delivery-predicate
// sweep, split verbatim out of `final-review-service.test.ts` (C wave 7
// file-size work).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareFinalReview } from '~/src/services/final-review/final-review-service';
import {
  DELIVERY_PREDICATE,
  PROXIES,
  RENDER_ONLY,
  definitionCount,
  deliveryProxyOffenders,
  illegalOffenders,
  legacyTopLevelFunctions,
  modulesDefining,
  namedFunctionBodies,
  scanModuleSet
} from './final-review-guard-c-scan.js';
import {
  RID,
  SESSION_ID,
  allVerdicts,
  captureRunner,
  makeGitProject,
  reviewJson,
  writeAuditGoal,
  writeRealSizedEvidence
} from './final-review-service-helpers.js';
import {
  HEAVY_SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_TEST_TIMEOUT_MS
} from '../_setup/subprocess-timeouts.js';

describe('prepareFinalReview — missing, empty and unreadable are three facts (F4)', () => {
  it(
    'tells the reviewer a contract exists but could not be read, and fires the gate',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // EACCES / EBUSY / EISDIR used to collapse into the same `raw === null` as
      // ENOENT, so a contract that is ON DISK and unreadable was reported — and
      // gated — as "this run had no PRD phase". A directory at the contract's
      // path is the portable way to make the read fail with something other than
      // ENOENT.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);
      // The capsule `writeRealSizedEvidence` laid down is the slice's OWN, so
      // the perturbation has to land there — the bare name is the legacy tier
      // and an older copy is never consulted while a newer one resolves.
      const contractPath = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', `handoff-${RID}.md`);
      rmSync(contractPath);
      mkdirSync(contractPath, { recursive: true });

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const prompt = calls[0]?.userPrompt ?? '';
      expect(prompt).toContain('STATUS: UNREADABLE');
      expect(prompt).not.toContain(`STATUS: MISSING (unreadable)`);
      expect(prompt).toContain(contractPath.split('\\').join('/').split('/').slice(-4).join('/'));

      const dimension = out.dimensions.find((d) => d.dimension === 'functional-completeness');
      expect(dimension?.verdict).toBe('inconclusive');
      expect(dimension?.summary).toContain('scope-contract-gate');
      expect(dimension?.summary).toContain('unreadable');
    }
  );

  it(
    'distinguishes a contract that is absent from one that is empty',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // ZERO bytes — QA's literal repro. The file EXISTS for this run, so the
      // `totalBytes === 0` early return was wrong (it stopped the gate on a fact
      // that is true of an absent file AND of an empty one) and the gate must
      // fire. The whitespace-only case is the same status and is covered by the
      // read phase's `blank` rule.
      const emptyRoot = makeGitProject();
      writeAuditGoal(emptyRoot, ['AC1']);
      writeRealSizedEvidence(emptyRoot);
      writeFileSync(
        join(emptyRoot, '.peaks', '_runtime', SESSION_ID, 'prd', `handoff-${RID}.md`),
        '',
        'utf8'
      );

      const empty = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const emptyOut = await prepareFinalReview(RID, {
        projectRoot: emptyRoot,
        sessionId: SESSION_ID,
        llmRunner: empty.runner
      });
      expect(empty.calls[0]?.userPrompt ?? '').toContain('STATUS: MISSING (empty)');
      expect(
        emptyOut.dimensions.find((d) => d.dimension === 'functional-completeness')?.summary
      ).toContain('scope-contract-gate');

      // ...while an absent contract stays a non-event: no PRD phase, no gate.
      const absentRoot = makeGitProject();
      writeAuditGoal(absentRoot, ['AC1']);
      writeRealSizedEvidence(absentRoot);
      rmSync(join(absentRoot, '.peaks', '_runtime', SESSION_ID, 'prd', `handoff-${RID}.md`));

      const absent = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const absentOut = await prepareFinalReview(RID, {
        projectRoot: absentRoot,
        sessionId: SESSION_ID,
        llmRunner: absent.runner
      });
      expect(absent.calls[0]?.userPrompt ?? '').toContain('STATUS: MISSING (missing)');
      expect(
        absentOut.dimensions.find((d) => d.dimension === 'functional-completeness')?.summary
      ).not.toContain('scope-contract-gate');
    }
  );
});

// ---------------------------------------------------------------------------
// C — the guard. The sixth instance of this shape was found in code the fifth
// fix did not touch, so the fix is not another instance: it is a check that the
// shape cannot be re-created. "Was it delivered?" must be asked in exactly one
// place, and a new local predicate — a status comparison, a byte comparison, an
// existence test — must fail this suite rather than pass review.
//
// H1 — the first version of this guard was itself the seventh instance of the
// shape it was written to catch: it validated a PROXY ("is this line shaped
// like a hand-written `function`?") instead of the PROPERTY ("is this a
// delivery judgement?"). It recognised `function` at column 0 only, so an
// arrow, a generator, a class method or a default export carrying the exact
// same proxy went through untouched, and a `}` at column 0 inside a template
// literal closed a block early so everything after it was skipped. Measured
// against the real guard: 8 equivalent rewrites ALL passed, and an arrow
// function at top level carrying two proxy literals scored 3 passed / exit 0
// where the same proxies inside `function` scored 1 failed / exit 1.
//
// The guard therefore no longer slices the file by a lexical shape. It parses
// it (the repo's own `typescript` devDependency — no new dependency, and the
// same tool `bdd-test-style-verifier.ts` uses) and asks the AST for every
// function-like definition by NAME. Arrow / generator / class method / default
// export / getter / object method all land in the same list, so the check is
// about the tokens in a body, not about the syntax that wraps them.
//
// H2 (§2.28) — the SHAPE was fixed and the SUBJECT was not. The guard read the
// source text of ONE file, `final-review-service.ts`, and C wave 7 (`78f764cb`)
// then moved ten regions out of that 1,858-line service into twelve siblings,
// leaving the parent at 273 raw lines. Measured on this checkout the guard
// reads 11,815 of the directory's 149,711 characters — 7.9 % — and stays green,
// because `isDelivered` itself stayed put. A guard whose subject is a path in a
// constant shrinks every time the code is organised, so the subject is now the
// DIRECTORY, enumerated at run time. The scanner lives in
// `final-review-guard-c-scan.ts` so the scope arms in
// `final-review-guard-scope.test.ts` exercise the same scanner this guard runs
// instead of a copy of it that could rot on its own.
// ---------------------------------------------------------------------------

/** The guarded directory. Its modules come from `scanModuleSet`, never a list. */
const SERVICE_DIR = resolve(__dirname, '..', '..', '..', 'src', 'services', 'final-review');

/**
 * The parent file, still read on its own by the two arms below that pin the
 * parent's OWN structure (the routing wrappers and the evidence-source table).
 * Both fail loudly if either region moves again, so they are a tripwire rather
 * than a blind spot. The delivery-proxy sweep is no longer one of them: its
 * subject is the whole directory, enumerated by `scanModuleSet`.
 */
const SERVICE_PATH = join(SERVICE_DIR, 'final-review-service.ts');

describe('final-review — the delivery judgement has exactly one home (guard C)', () => {
  const source = readFileSync(SERVICE_PATH, 'utf8');

  // The guard's subject: every module in the directory, read at run time.
  // `scanModuleSet` enumerates with `readdirSync` and reports the paths it
  // actually opened, so `MODULES` is the audit trail, not an intention.
  const MODULES = scanModuleSet(SERVICE_DIR);
  const OFFENDERS = MODULES.flatMap((scanned) => scanned.offenders);

  it('keeps every delivery proxy inside the single predicate', () => {
    // Only `isDelivered` may decide delivery; every other function must ASK it
    // — now across all sixteen modules, pooled, rather than in the one file
    // that happened to be named in a constant when this guard was written.
    expect(illegalOffenders(OFFENDERS)).toEqual([]);
    // ...and the predicate itself must actually decide something, or this guard
    // is satisfied by deleting the judgement altogether.
    expect(OFFENDERS.some((entry) => entry.startsWith(`${DELIVERY_PREDICATE} `))).toBe(true);
  });

  /**
   * The set-wide form of "exactly one home", which the parent-only guard could
   * not state at all: nothing in the old guard stopped a split from leaving a
   * second `isDelivered` behind in a sibling, or from moving the predicate out
   * entirely and keeping a wrapper in the parent.
   */
  it('keeps the delivery predicate itself in exactly one module of the set', () => {
    expect(modulesDefining(MODULES, DELIVERY_PREDICATE)).toHaveLength(1);
    // The file name is pinned on purpose, in the same spirit as RENDER_ONLY: a
    // split that MOVES the predicate somewhere else is allowed to happen, but
    // it has to happen here, in daylight, rather than turning this arm green by
    // accident. Two copies, on the other hand, are the defect — and the count
    // assertion above catches them wherever they land.
    expect(modulesDefining(MODULES, DELIVERY_PREDICATE)).toEqual(['final-review-service.ts']);
    // The sanctioned render-only branch is a single named function too, so the
    // allow-list cannot absorb a second copy of anything.
    for (const name of RENDER_ONLY) {
      expect(definitionCount(MODULES, name)).toBe(1);
    }
  });

  /**
   * H1's regression guard — the most important test in this file. A proxy
   * literal inside an arrow, a class method, a generator and a default export
   * must all be reported, and the pre-H1 scanner must be shown to have missed
   * every one of them.
   */
  it('catches a delivery proxy in every syntax shape, not just `function` at column 0', () => {
    const fourShapes = [
      `const arrowProxy = (item) => item.status === 'found';`,
      `class Holder { methodProxy(item) { return item.includedBytes === totalBytes; } }`,
      `function* generatorProxy(item) { return item.totalBytes === 0; }`,
      `export default function (item) { return item.includedBytes > 0; }`
    ].join('\n\n');

    expect(deliveryProxyOffenders(fourShapes)).toEqual([
      `arrowProxy uses status === 'found'`,
      `arrowProxy uses status !== 'found'`,
      `methodProxy uses includedBytes === totalBytes`,
      `generatorProxy uses totalBytes === 0`,
      `<anonymous> uses includedBytes > 0`
    ]);
    // The H1 defect, as an assertion: the shape-based scanner saw none of them.
    // (Under the old guard these four functions would have shipped unscanned,
    // which is how the seventh instance of the shape got in.)
    expect(legacyTopLevelFunctions(fourShapes)).toEqual([]);
  });

  /**
   * The same defect from the other direction: a `}` at column 0 INSIDE a
   * template literal closed the old scanner's block early, so every line after
   * it — including the proxy — was never scanned. The AST scanner has no
   * concept of a "line that is exactly `}`", so the body is scanned whole.
   */
  it('does not lose the rest of a body to a brace that only looks like a closing brace', () => {
    const templateBrace = [
      'function withTemplate(item) {',
      '  const text = `line one',
      '}',
      'line two`;',
      "  return item.status === 'found';",
      '}'
    ].join('\n');

    expect(deliveryProxyOffenders(templateBrace)).toEqual([
      `withTemplate uses status === 'found'`,
      `withTemplate uses status !== 'found'`
    ]);
    expect(legacyTopLevelFunctions(templateBrace).map((fn) => fn.name)).toEqual(['withTemplate']);
    expect(
      legacyTopLevelFunctions(templateBrace).some((fn) =>
        PROXIES.some((proxy) => proxy.re.test(fn.body))
      )
    ).toBe(false);
  });

  /**
   * KNOWN GAP — NOT A GUARANTEE. Recorded as a passing assertion on purpose:
   * the four rewrites below are semantically identical to the proxies above and
   * this guard does NOT catch any of them, because none of them contains the
   * token sequence the patterns match.
   *
   *   extracted variable  `const FOUND = 'found'; item.status === FOUND`
   *   loose equality      `item.status == 'found'`
   *   bracket access      `item['status'] === 'found'`
   *   concatenation       `item.status === 'fo' + 'und'`
   *
   * The guard stops SHAPE dependence; it does not and cannot stop SEMANTIC
   * rewrites by pattern matching, and pretending otherwise is the exact failure
   * this guard was fixed for. These four belong to code review, and the modules
   * they belong to say so in the source comment that states the same limit.
   */
  it('records what the guard does NOT catch (semantic rewrites — code review owns these)', () => {
    const semanticallyIdentical = [
      `const FOUND = 'found';\nconst extractedVariable = (item) => item.status === FOUND;`,
      `const looseEquality = (item) => item.status == 'found';`,
      `const bracketAccess = (item) => item['status'] === 'found';`,
      `const concatenation = (item) => item.status === 'fo' + 'und';`
    ].join('\n\n');

    expect(deliveryProxyOffenders(semanticallyIdentical)).toEqual([]);
  });

  it('routes every dimension-level judgement through the single predicate', () => {
    const bodies = new Map(namedFunctionBodies(source).map((fn) => [fn.name, fn.body]));
    // The judgement points the round-6 dispatch names — plus
    // `enforcePrePostDiffAvailability`, which M3 found missing from this list
    // — by name, so a future refactor that drops one of them fails here rather
    // than silently re-introducing a local answer.
    expect(bodies.get('dimensionsWithEvidence') ?? '').toContain('isDelivered(');
    expect(bodies.get('prePostDiffDelivered') ?? '').toContain('isDelivered(');
    expect(bodies.get('enforceScopeContractDelivery') ?? '').toContain('isDelivered(');
    // Routed through the shared helper for the baseline, which is itself one
    // line on top of `isDelivered` — asserted by name because this judgement
    // point was missing from the list entirely (M3).
    expect(bodies.get('enforcePrePostDiffAvailability') ?? '').toContain('prePostDiffDelivered(');
    // The attachment path asks the same shared helper the gate does.
    expect(bodies.get('attachPrePostDiffEvidence') ?? '').toContain('prePostDiffDelivered(');
  });

  it('gives every evidence source a declared delivery rule', () => {
    // The type requires it, so a source without one is a compile error — this
    // is the second net: it catches a source added with `as EvidenceSource` or
    // through a widened type, where tsc would not.
    const table = /function evidenceSourcesFor[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    const keys = [...table.matchAll(/key:\s*(?:'([^']*)'|([A-Z_]+))/g)].map(
      (match) => match[1] ?? match[2]
    );
    const rules = table.match(/delivery:\s*\{/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(rules).toHaveLength(keys.length);
  });
});
