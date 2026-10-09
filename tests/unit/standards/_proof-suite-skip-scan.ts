// tests/unit/standards/_proof-suite-skip-scan.ts
//
// The scan behind `no-proof-suite-skip.test.ts`. Split into a bare `.ts` sibling for
// the reason `_no-mcp-source-import-scan.ts` and `_gratuitous-async-scan.ts` were: the
// guard file is a capped file under `tests/`, and the injection control wants the
// walker without the guard's own arms.
//
// THE SHAPE THIS EXISTS TO CATCH (measured 2026-10-09, rid-035 slice ①). The three-layer
// read-only proof sat under `describe.skipIf(!existsSync(dist/cli/index.js))`. With the
// artifact absent, nine arms SKIPPED and the suite exited 0 — a proof that vanished
// reported success exactly as loudly as a proof that ran. The vanish has been repaired;
// nothing stopped it coming back, because "a suite-level gate on a proof carrier" is a
// legal thing to write and vitest reports it as neither a pass nor a failure.
//
// WHY A NAMED FILE SET AND NOT A REPO-WIDE HEURISTIC. "Any suite gated by a `skipIf`
// must be refused" is false in this repository — `readonly-proof.test.ts` itself gates
// its CI-only sandbox layer that way, deliberately and correctly, and the integration
// suite gates arms on platform. A repo-wide rule would be a false-red machine. So the
// rule is stated over the carriers of a PROOF only: a file whose whole job is to be red
// when something is missing. Every gate in one of those files is reported unless the
// guard declares it, with the reason it is allowed to be conditional.
//
// WHY THE AST, NOT A TEXT SCAN. `readonly-proof.test.ts`'s own comments discuss
// `skipIf` in prose ("This arm is deliberately NOT wrapped in `skipIf`"), so a regex
// over the text would report the explanation as the defect. `typescript` is already a
// devDependency and `_no-mcp-source-import-scan.ts` parses the same way.
//
// WHAT AN AST CANNOT SEE, RECORDED RATHER THAN CLAIMED. Indirect registration —
// `const gated = describe.skipIf(cond); gated('title', fn)` — needs dataflow, so this
// scan does not decide it. The direct spellings it does decide are: `describe.skip`,
// `describe.todo`, `it.skip`, `it.todo`, and `describe.skipIf(<cond>)(<title>, <body>)`
// with `it.skipIf` likewise. A title this scan cannot read as a string literal is
// reported as unreadable rather than passed over: a gate whose name cannot be checked
// is not a gate that was checked.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

import { normalizePath } from '../../../src/shared/path-utils.js';

/**
 * The directory whose `.test.ts` files carry the read-only proof. Stated as a DIRECTORY,
 * not as a file list: a proof carrier added beside this one joins the guard by existing,
 * which is the same posture `.husky/lint-scope.mjs` takes for the enforced scope.
 */
export const PROOF_CARRIER_DIR_REL = 'tests/integration/readonly-surface';

/** The three call spellings that switch a suite or an arm off. */
const SUITE_SKIP_MODIFIERS: readonly string[] = ['skipIf', 'skip', 'todo'];

export interface SuiteSkipGate {
  /** Repo-relative, POSIX separators — the form an operator can paste. */
  readonly file: string;
  /** Which registration was gated. */
  readonly kind: 'describe' | 'it';
  /** `skipIf` | `skip` | `todo`. */
  readonly modifier: string;
  /** The gated title, or `null` when it is not a string literal and cannot be read. */
  readonly title: string | null;
  /** The `skipIf` condition's source text; `null` for `skip` / `todo`. */
  readonly predicate: string | null;
  /** 1-based line of the registration call. */
  readonly line: number;
}

export type ProofSkipRule = 'undeclared-skip-gate' | 'required-suite-is-gated';

export interface ProofSkipFinding {
  readonly file: string;
  /** 1-based line, or `null` when the finding is about the suite set as a whole. */
  readonly line: number | null;
  readonly rule: ProofSkipRule;
  readonly message: string;
}

/**
 * Every `.test.ts` carrier under the proof directory, repo-relative and POSIX, sorted.
 * An absent directory yields an empty list rather than throwing — and an empty list is
 * INDISTINGUISHABLE from a clean tree, which is why the guard asserts the set is
 * non-empty instead of trusting this walk to say so.
 *
 * The path is a COMPARISON KEY — it is matched against the declared-gate map — so the
 * separators come from `normalizePath`, the one spelling this repository allows
 * (`.peaks/standards/common/coding-style.md`), not from a local `\\` -> `/`.
 */
export function proofCarrierFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.test.ts')) continue;
      found.push(normalizePath(relative(root, child)));
    }
  };
  walk(resolve(root, PROOF_CARRIER_DIR_REL));
  return found.sort();
}

/** The `describe` / `it` a modifier hangs off, when this expression is one. */
function gateCallee(
  expression: ts.Expression
): { kind: 'describe' | 'it'; modifier: string } | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const modifier = expression.name.text;
  if (!SUITE_SKIP_MODIFIERS.includes(modifier)) return undefined;
  const target = expression.expression;
  if (!ts.isIdentifier(target)) return undefined;
  if (target.text !== 'describe' && target.text !== 'it') return undefined;
  return { kind: target.text, modifier };
}

/** The title of a registration call, or `null` when it is not a string literal. */
function titleOf(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Every suite-level skip gate in one source text, in source order.
 *
 * A `skipIf` is a CONDITION call (`describe.skipIf(cond)`) whose REGISTRATION is the
 * call around it (`…(title, body)`), so that one is resolved through `outerOf`; `skip`
 * and `todo` are the registration itself. A condition call with no registration around
 * it is still reported, with an unreadable title, because it is a gate being built and
 * the guard would rather refuse than guess.
 */
export function suiteSkipGates(file: string, source: string): SuiteSkipGate[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const outerOf = new Map<ts.Node, ts.CallExpression>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
      if (ts.isCallExpression(node.expression)) outerOf.set(node.expression, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const lineOf = (node: ts.Node): number =>
    parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;

  const gates: SuiteSkipGate[] = [];
  for (const call of calls) {
    const callee = gateCallee(call.expression);
    if (callee === undefined) continue;
    if (callee.modifier === 'skipIf') {
      const registration = outerOf.get(call);
      gates.push({
        file,
        kind: callee.kind,
        modifier: callee.modifier,
        title: registration === undefined ? null : titleOf(registration.arguments[0]),
        predicate: call.arguments.map((argument) => argument.getText(parsed)).join(', ') || null,
        line: lineOf(registration ?? call)
      });
      continue;
    }
    gates.push({
      file,
      kind: callee.kind,
      modifier: callee.modifier,
      title: titleOf(call.arguments[0]),
      predicate: null,
      line: lineOf(call)
    });
  }
  return gates.sort((left, right) => left.line - right.line);
}

/**
 * The titles registered UNCONDITIONALLY at the top level of the file — `describe(<title>, …)`
 * written as a bare call. A gated suite is not a member: its callee is a property access
 * or another call, so it cannot be listed here. A suite nested inside another suite is not
 * a member either, because "top level" is what makes it run without asking anything.
 */
export function topLevelUnconditionalSuites(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const call = statement.expression;
    if (!ts.isCallExpression(call)) continue;
    const callee = call.expression;
    if (!ts.isIdentifier(callee)) continue;
    if (callee.text !== 'describe' && callee.text !== 'it') continue;
    titles.push(titleOf(call.arguments[0]) ?? '<title is not a string literal>');
  }
  return titles;
}

/**
 * The whole rule, over a repository root: a proof carrier may not carry a gate the guard
 * has not declared, and the suites named as its unconditional carriage must still be
 * registered unconditionally at the top level. Both halves are needed — the allow-list
 * alone could be edited to gate the carriage itself, and the carriage half alone would
 * miss a gate on a NESTED arm that removes the same evidence.
 */
export function checkProofCarriers(
  root: string,
  declared: Readonly<Record<string, readonly string[]>>,
  requiredUngated: Readonly<Record<string, readonly string[]>>
): ProofSkipFinding[] {
  const findings: ProofSkipFinding[] = [];
  for (const file of proofCarrierFiles(root)) {
    const source = readFileSync(join(root, file), 'utf8');
    const allowed = declared[file] ?? [];
    for (const gate of suiteSkipGates(file, source)) {
      if (gate.title !== null && allowed.includes(gate.title)) continue;
      const named =
        gate.title === null
          ? 'its title is not a string literal, so it cannot be read'
          : JSON.stringify(gate.title);
      findings.push({
        file,
        line: gate.line,
        rule: 'undeclared-skip-gate',
        message:
          `${file}:${gate.line} — the suite gated by ${gate.kind}.${gate.modifier} is ${named}, ` +
          'and this guard does not declare it. A proof carrier is a file whose whole job is to ' +
          'be RED when something it needs is missing; a suite-level skip turns that into a ' +
          'silent pass, because vitest reports a skipped arm as neither a pass nor a failure. ' +
          'If this gate is legitimate, declare it in DECLARED_GATES with the reason it may be ' +
          'conditional — the declaration is the deliberate act, not the gate.'
      });
    }
    const ungated = topLevelUnconditionalSuites(file, source);
    for (const title of requiredUngated[file] ?? []) {
      if (ungated.includes(title)) continue;
      findings.push({
        file,
        line: null,
        rule: 'required-suite-is-gated',
        message:
          `${file} — the suite ${JSON.stringify(title)} is not registered unconditionally at the ` +
          "top level any more. It is part of the proof's required carriage, so it must run " +
          'without a gate: a proof that can be switched off reports success exactly as loudly ' +
          'as a proof that ran.'
      });
    }
  }
  return findings;
}

/** One line per finding, for an assertion's message. */
export function describeProofFindings(findings: readonly ProofSkipFinding[]): string {
  return findings.map((finding) => finding.message).join('\n\n');
}
