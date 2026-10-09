// tests/unit/runtime/no-runtime-input-guard-detect-ruled.ts
//
// Rule D of `no-runtime-input-guard.test.ts` — the id-join detectors — moved
// VERBATIM into this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-5). THE RULE'S FULL DESIGN RATIONALE, reach and
// repair history (R1/R5/R7) is the `RULE D` banner comment in
// `no-runtime-input-guard-scan.ts`, next to the scanned-file lists it describes;
// it is not restated here so the two copies cannot drift.

import * as ts from 'typescript';

import { collapse, lineOf } from './no-runtime-input-guard-detect-bc.js';

const isPinnedName = (node: ts.Node, constants: ReadonlySet<string>): boolean =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  (ts.isIdentifier(node) && constants.has(node.text));

/** A module-level `const X = 'literal'` — a pinned name, not an id. */
export function moduleStringConstants(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
        names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

/**
 * The recognised controls, split by the SHAPE of what they guarantee — because
 * the shape decides what counts as guarded, and getting that wrong is the
 * defect this predicate was rewritten for on 2026-09-14 (repair R1).
 *
 *   ID_GUARD_NAMES      take the id itself and refuse it (`isUnsafePathInput`
 *                       returns a predicate; `assertSafePathSegment` throws).
 *                       Their ARGUMENT is the guarded thing, and nothing else.
 *   ID_VALIDATOR_NAMES  return a RECORD carrying the normalised id
 *                       (`const v = validateSessionId(x)`), so `v.field` is
 *                       guarded. Their argument is guarded too — the throwing
 *                       peer in `workspace-service.ts` shares the name.
 *   ID_PATTERN_NAMES    pinned-format controls spelled `X.test(value)`.
 *
 * WHAT CHANGED AND WHY. `guardedNames` collected every IDENTIFIER inside a
 * guard's arguments. So `REQUEST_ID_PATTERN.test(options.requestId)` marked the
 * name `options` guarded, and every later `options.<anything>` in the file —
 * including `join(…'_runtime', options.sessionId, …)` in
 * `request-artifact-service.ts` — read as covered. Measured with this file's own
 * functions before the rewrite: that join was NOT reported while the repo-wide
 * assertion below stayed green. A guard whose coverage claim is broader than its
 * predicate is the whole defect class; the predicate was its last instance.
 *
 * The set is still FILE-scoped, deliberately: `verdict-aggregate-command.ts`
 * guards `rid` once at the action entry and three helpers 100 lines below reuse
 * the name. Tightening to a function scope would score those three as
 * offenders and the remedy for that false positive is an allowlist — which is
 * how this kind of guard dies. What is asserted is the EXPRESSION, not the
 * identifier that happens to appear inside it.
 */
const ID_GUARD_NAMES: readonly string[] = ['isUnsafePathInput', 'assertSafePathSegment'];
const ID_VALIDATOR_NAMES: readonly string[] = ['validateSessionId'];
const ID_PATTERN_NAMES: readonly string[] = ['REQUEST_ID_PATTERN', 'SLICE_ID_PATTERN'];

interface GuardSets {
  /** Exact collapsed texts of expressions a recognised control was applied to. */
  readonly expressions: ReadonlySet<string>;
  /** Identifiers bound to a validator's RESULT — `<root>.<field>` is guarded. */
  readonly validatedRoots: ReadonlySet<string>;
}

function collectGuards(sourceFile: ts.SourceFile): GuardSets {
  const expressions = new Set<string>();
  const validatedRoots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = collapse(node.expression.getText(sourceFile));
      const named = (guard: string): boolean => callee === guard || callee.endsWith(`.${guard}`);
      const isGuard =
        ID_GUARD_NAMES.some(named) ||
        ID_VALIDATOR_NAMES.some(named) ||
        ID_PATTERN_NAMES.some((pattern) => named(`${pattern}.test`));
      if (isGuard) {
        for (const argument of node.arguments) {
          expressions.add(collapse(argument.getText(sourceFile)));
        }
        if (ID_VALIDATOR_NAMES.some(named)) {
          let parent: ts.Node | undefined = node.parent;
          while (parent !== undefined && ts.isParenthesizedExpression(parent))
            parent = parent.parent;
          if (
            parent !== undefined &&
            ts.isVariableDeclaration(parent) &&
            ts.isIdentifier(parent.name)
          ) {
            validatedRoots.add(parent.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { expressions, validatedRoots };
}

export const isJoinCall = (callee: string): boolean => /(^|\.)(join|resolve)$/.test(callee);

/**
 * Is this expression guarded? Expression-shaped, never name-shaped: a guard on
 * `options.requestId` does not clear `options.sessionId`.
 *
 * `pinned` is the file's module-level string constants — a name the product
 * wrote, not a call. A binary or conditional is guarded only when EVERY branch
 * is, so `request-commands.ts`'s `resolvedSessionId ?? 'default'` still clears:
 * the id half is guarded at its own function's entry and the fallback is a
 * pinned literal. The AND is what makes `'run-' + sid` report.
 */
function isGuardedSlot(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  guards: GuardSets,
  constants: ReadonlySet<string>
): boolean {
  if (isPinnedName(node, constants)) return true;
  if (ts.isParenthesizedExpression(node))
    return isGuardedSlot(node.expression, sourceFile, guards, constants);
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) =>
      isGuardedSlot(span.expression, sourceFile, guards, constants)
    );
  }
  // EVERY branch of a binary or conditional carries the id, so EVERY branch
  // must be guarded. Reading this as an OR over the branches is repair R7's
  // first measured defect: one pinned literal on either side made the whole
  // expression "guarded", so `'run-' + sid`, `ok ? sid : 'adhoc'` and a builder
  // call's `rid + '.json'` all cleared while carrying an unchecked id.
  if (ts.isBinaryExpression(node)) {
    return (
      isGuardedSlot(node.left, sourceFile, guards, constants) &&
      isGuardedSlot(node.right, sourceFile, guards, constants)
    );
  }
  if (ts.isConditionalExpression(node)) {
    return (
      isGuardedSlot(node.whenTrue, sourceFile, guards, constants) &&
      isGuardedSlot(node.whenFalse, sourceFile, guards, constants)
    );
  }
  if (ts.isCallExpression(node)) {
    // A call's ID-BEARING parts are its arguments; the receiver is the string
    // being operated on (`rel.replace('<rid>', rid)` — `rel` is a path fragment
    // from a closed list, `rid` is the caller's id).
    //
    // ZERO arguments is NOT "all arguments are guarded": `every()` on an empty
    // list is vacuously true, so `currentSid()` and `sid.trim()` both read as
    // guarded while carrying an unchecked id — repair R7's second measured
    // defect. A call with no arguments is not a guard.
    return (
      node.arguments.length > 0 &&
      node.arguments.every((argument) => isGuardedSlot(argument, sourceFile, guards, constants))
    );
  }
  if (guards.expressions.has(collapse(node.getText(sourceFile)))) return true;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return guards.validatedRoots.has(node.expression.text);
  }
  return false;
}

export interface UnguardedIdJoin {
  readonly file: string;
  readonly line: number;
  readonly segment: string;
}

/**
 * Every id-shaped segment at or after the `'_runtime'` literal, plus the
 * segments of a `join`/`resolve` whose root is built by a same-file runtime
 * constructor one function earlier.
 *
 * LIMIT (m), stated because it is the shape the previous version's limit (l)
 * hid: a join whose ROOT is a local `const` (`const dir = resolve(… '_runtime'
 * …); join(dir, \`${sliceId}.json\`)`) is invisible — the root is an identifier,
 * not a call. Measured 2026-09-14: one live instance, read-only
 * (`slice-integrate-commands.ts:30`), fixed by hand and NAMED here rather than
 * silently covered. Following a `const` one hop is a dataflow step, and the
 * version of it that also follows array elements
 * (`verdict-aggregate-command.ts`'s `candidates` → `join(dir, name)`) would
 * flag a chain whose ids ARE guarded at the source. Recorded, not crossed.
 */
export function findUnguardedRuntimeIdJoins(sourceFile: ts.SourceFile): UnguardedIdJoin[] {
  const constants = moduleStringConstants(sourceFile);
  const guards = collectGuards(sourceFile);
  const builders = runtimeBuilderNames(sourceFile);
  const found: UnguardedIdJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
      const slots = runtimeJoinSlots(node, sourceFile, constants, builders);
      for (const slot of slots) {
        if (!isGuardedSlot(slot, sourceFile, guards, constants)) {
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            segment: collapse(slot.getText(sourceFile))
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The functions in this file that BUILD a runtime path — a returned `join` /
 * `resolve` mentioning `'_runtime'`. `getQaReviewDir` and `getReviewDir` are the
 * measured pair: each guards its sid and hands the root to a caller one function
 * later, where the second id is joined.
 */
export function runtimeBuilderNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      if (containsRuntimeJoin(node.body, sourceFile)) names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      containsRuntimeJoin(node.initializer, sourceFile)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

function containsRuntimeJoin(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const visit = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && isJoinCall(collapse(n.expression.getText(sourceFile)))) {
      if (n.arguments.some((a) => ts.isStringLiteral(a) && a.text === '_runtime')) return true;
    }
    return ts.forEachChild(n, visit) ?? false;
  };
  return visit(node);
}

/**
 * The slots a runtime join must have guarded. Two routes in:
 *
 *   (a) the join carries the `'_runtime'` literal — the slots are the arguments
 *       AFTER it, pinned literals excluded. This is the widening: the old rule
 *       asserted only the ONE slot immediately after `'_runtime'`, so
 *       `join(root, '.peaks', '_runtime', sid, 'loop', rid, 'cycles')` had its
 *       sid asserted and its rid — the CLI positional — not asserted at all.
 *   (b) the join has no `'_runtime'` literal but its root is a same-file
 *       runtime constructor — the slots are the arguments OTHER than that
 *       constructor, which IS the root.
 */
/** Exported for the AC4 enumeration probe: the repo-wide census must use the
 *  same slot definition the assertion uses, or the two disagree. */
export function runtimeJoinSlots(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  constants: ReadonlySet<string>,
  builders: ReadonlySet<string>
): ts.Node[] {
  const args = call.arguments;
  const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
  const assertable = (node: ts.Node | undefined): node is ts.Node =>
    node !== undefined && !isPinnedName(node, constants);

  if (runtimeAt >= 0) return args.slice(runtimeAt + 1).filter(assertable);

  const builderArg = args.find(
    (a) =>
      ts.isCallExpression(a) && ts.isIdentifier(a.expression) && builders.has(a.expression.text)
  );
  if (builderArg !== undefined) return args.filter((a) => a !== builderArg && assertable(a));

  return [];
}

/**
 * The census of joins whose id slot is a PINNED literal while a LATER argument
 * carries something that is not.
 *
 * This WAS limit (l) — the shape rule D returned nothing for, numerator and
 * denominator alike, so the rule read as having looked and found nothing. On
 * 2026-09-14 a LIVE ESCAPE sat behind exactly this shape
 * (`playwright-commands.ts`: the `'_runtime'` literal is inside
 * `playwrightSessionsDir()`, whose slot is the pinned `PLAYWRIGHT_SESSIONS_DIR`;
 * the caller-supplied terminal id is joined in a SECOND call,
 * `sessionFilePath()`, which contains no `_runtime` literal at all).
 *
 * Repair R1 closed the limit: the slot after a pinned slot IS asserted now, so
 * `playwright-commands.ts:282`'s `terminalId` is IN the numerator. What R1 did
 * not check is whether the assertion MEANS anything there, and repair R7
 * measured that it does not:
 *
 *   Delete the `isUnsafePathInput(terminalId)` block from `sessionFilePath`
 *   (source text, in memory; the file on disk verified unchanged) and the rule
 *   reports `:279 joins terminalId` — the same slot, three lines up — plus
 *   `:71`. Clean tree: 0 findings. The ONLY thing keeping `:282` green is a
 *   guard 210 lines away in a DIFFERENT function, on a different binding that
 *   happens to share the name. So the sentence R1 wrote here — that `:282`'s
 *   `terminalId` "is required to be guarded" — was false when it was written:
 *   the rule passes it silently. It is safe IN FACT (`deriveTerminalId`
 *   sanitises, and `opts.terminal` is guarded upstream), so this is a latent
 *   false negative, not a live escape. Repair R7 did NOT close it; see the
 *   limit note below for why, and for the measurement that makes it a
 *   decision rather than a bug.
 *
 * Measured 2026-09-15 (R7, re-run rather than restated): 1 such join in rule
 * D's reach (`playwright-session-store.ts` `join(…, 'playwright-userdata',
 * terminalId)`) and 7 in the whole of `src/`. The 6 outside this reach are NOT
 * scanned and are NAMED in the reach note above; a repo-wide census is
 * `probe-src-joins.mjs`'s job, not this file's.
 */
export interface LiteralFirstIdJoin {
  readonly file: string;
  readonly line: number;
  /** The pinned literal / module constant written in the slot after `'_runtime'`. */
  readonly pinned: string;
  /** Identifier names appearing in the segments AFTER that slot. */
  readonly later: readonly string[];
}

export function findLiteralFirstIdJoins(sourceFile: ts.SourceFile): LiteralFirstIdJoin[] {
  const constants = moduleStringConstants(sourceFile);
  const found: LiteralFirstIdJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJoinCall(collapse(node.expression.getText(sourceFile)))) {
      const args = node.arguments;
      const runtimeAt = args.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
      const segment = runtimeAt >= 0 ? args[runtimeAt + 1] : undefined;
      if (segment !== undefined && isPinnedName(segment, constants)) {
        const later = args.slice(runtimeAt + 2).filter((a) => !isPinnedName(a, constants));
        if (later.length > 0) {
          const names = new Set<string>();
          for (const argument of later) {
            const collect = (n: ts.Node): void => {
              if (ts.isIdentifier(n)) names.add(n.text);
              ts.forEachChild(n, collect);
            };
            collect(argument);
          }
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            pinned: collapse(segment.getText(sourceFile)),
            later: [...names]
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}
