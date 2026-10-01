// tests/unit/final-review/final-review-service-fact-states-and-guard.test.ts
//
// F4 missing/empty/unreadable fact states and the guard-C delivery-predicate
// sweep, split verbatim out of `final-review-service.test.ts` (C wave 7
// file-size work).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { prepareFinalReview } from '~/src/services/final-review/final-review-service';
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
// ---------------------------------------------------------------------------

/** The one function allowed to decide delivery. */
const DELIVERY_PREDICATE = 'isDelivered';

interface ScannedFunction {
  readonly name: string;
  readonly body: string;
}

/**
 * Every function-like definition in `source`, by name, in EVERY syntax shape:
 * `function`, `async function`, `function*`, `export default function`, class
 * and object methods, getters/setters, and arrow / function expressions bound
 * to a `const`. An unnamed definition reports as `<anonymous>` — it is still a
 * body that must not decide delivery, so it is still scanned.
 */
function namedFunctionBodies(source: string): readonly ScannedFunction[] {
  const file = ts.createSourceFile(
    'guard-c-fixture.ts',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const scanned: ScannedFunction[] = [];
  const record = (node: ts.Node, name: string | undefined): void => {
    scanned.push({
      name: name ?? '<anonymous>',
      body: source.slice(node.getStart(file), node.getEnd())
    });
  };
  const identifierName = (node: ts.Node): string | undefined => {
    const named = (node as { readonly name?: ts.Node }).name;
    return named !== undefined && ts.isIdentifier(named) ? named.text : undefined;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      record(node, identifierName(node));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      record(node.initializer, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return scanned;
}

/**
 * Every way a delivery judgement has been faked in this module's history.
 * Each one is a PROXY that a source can satisfy without the reviewer having
 * received its conclusion.
 *
 * THIS LIST IS THE GUARD'S LIMIT, not its definition. It matches the TOKENS a
 * proxy comparison has been written with, so it now catches them in any syntax
 * shape — but a rewrite that never types those tokens is invisible to it. The
 * test below pins that residual blindness in both directions so nobody can
 * read this guard as "delivery has one home, guaranteed".
 */
const PROXIES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "status === 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: "status !== 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: 'includedBytes === totalBytes', re: /includedBytes\s*[!=]==\s*totalBytes/ },
  { name: 'totalBytes === 0', re: /totalBytes\s*[!=]==\s*0/ },
  { name: 'includedBytes > 0', re: /includedBytes\s*[<>]=?\s*0/ },
  { name: 'content.length > 0', re: /content\.length\s*[<>]=?\s*[0-9]/ }
];

/**
 * The one function allowed to branch on `status === 'found'` without deciding
 * delivery: it chooses which STATUS LINE to print, and its result is prompt
 * text, so it cannot gate a verdict. Pinned to exactly one entry on purpose —
 * widening this list is a decision someone has to make in the guard, in
 * daylight, rather than a judgement that appears in a helper nobody re-reads.
 */
const RENDER_ONLY = ['renderEvidenceSection'];

/** `"<owner> uses <proxy>"` for every proxy found in every function body. */
function deliveryProxyOffenders(source: string): readonly string[] {
  const offenders: string[] = [];
  for (const fn of namedFunctionBodies(source)) {
    for (const proxy of PROXIES) {
      if (proxy.re.test(fn.body)) offenders.push(`${fn.name} uses ${proxy.name}`);
    }
  }
  return offenders;
}

/**
 * The PRE-H1 scanner, kept verbatim in the test for one reason: the shape test
 * below asserts that it finds NOTHING in a source where the AST scanner finds
 * four proxies. That is the H1 defect reproduced as an assertion — it is what
 * makes "this test fails against the old guard" a fact rather than a claim.
 */
function legacyTopLevelFunctions(
  source: string
): readonly { readonly name: string; readonly body: string }[] {
  const start = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const lines = source.split('\n');
  const blocks: { name: string; body: string }[] = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = start.exec(line);
    if (match !== null) {
      if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
      current = { name: match[1] as string, body: [line] };
      continue;
    }
    if (current !== null) {
      current.body.push(line);
      if (line === '}') {
        blocks.push({ name: current.name, body: current.body.join('\n') });
        current = null;
      }
    }
  }
  if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
  return blocks;
}

describe('final-review — the delivery judgement has exactly one home (guard C)', () => {
  const SERVICE_PATH = resolve(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'services',
    'final-review',
    'final-review-service.ts'
  );
  const source = readFileSync(SERVICE_PATH, 'utf8');

  it('keeps every delivery proxy inside the single predicate', () => {
    const offenders = deliveryProxyOffenders(source);
    // Only `isDelivered` may decide delivery; every other function must ASK it.
    expect(
      offenders.filter(
        (entry) =>
          !entry.startsWith(`${DELIVERY_PREDICATE} `) &&
          !RENDER_ONLY.some((name) => entry.startsWith(`${name} `))
      )
    ).toEqual([]);
    // ...and the predicate itself must actually decide something, or this guard
    // is satisfied by deleting the judgement altogether.
    expect(offenders.some((entry) => entry.startsWith(`${DELIVERY_PREDICATE} `))).toBe(true);
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
