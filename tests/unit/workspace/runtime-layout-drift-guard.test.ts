// tests/unit/workspace/runtime-layout-drift-guard.test.ts
//
// The `.peaks/_runtime/` top-level registry cannot drift silently.
//
// WHAT WENT WRONG, AND WHY PROSE DID NOT STOP IT
//
// `L3:l3-orphan-sessions` flags every DIRECTORY under `.peaks/_runtime/`
// that is not a session id, minus a list of system entries. That list was a
// local literal — `new Set(['change'])` — and `callers/` is a designed
// location (`.peaks/_runtime/callers/<callerId>.json`, written by
// `session/caller-binding-service.ts`) that was never added to it. Result:
// `peaks doctor` reported `4 orphan session(s) under .peaks/_runtime/ fail
// isValidSessionId: callers, cli, unknown-sid, x` and exited 1 on a clean
// workspace, permanently. The check's doc comment asked future maintainers
// to hand-sync a second prose list; prose cannot enforce itself.
//
// The list now lives in `src/services/workspace/runtime-layout.ts` and the
// check imports it. This file is what replaces the prose.
//
// WHY IT PARSES INSTEAD OF GREPPING
//
// A text scan cannot tell a path in CODE from the same path in a COMMENT or
// from two adjacent array entries that merely LOOK like a path. This
// repository contains both, and each would be a false positive:
//
//   - `workspace/migrate-1-4-1-service.ts` has a SKIP array whose adjacent
//     elements are the literals `'_runtime', '_sub_agents'`. They are two
//     SEPARATE skip entries for children of `.peaks/`; a text scan reads them
//     as the path `.peaks/_runtime/_sub_agents/`, which nothing writes.
//   - `services/evidence/evidence-generator.ts` describes a closed escape as
//     `.peaks/_runtime/pwned.md` inside a comment. A text scan would demand a
//     registry entry for `pwned.md`, an attack string.
//
// An AST walk is immune to both by construction, which is the same reason —
// and the same choice — as `tests/unit/runtime/no-runtime-input-guard.test.ts`.
//
// WHAT IT ASSERTS
//
//   forward  (load-bearing): every literal written as a `.peaks/_runtime/`
//            child in `src/**` is registered, or is session-id shaped.
//   reverse  (weak): every registered name still appears in `src/**` as a
//            `_runtime` child literal or as the value of a module-level
//            string constant, so an entry whose writer was deleted goes red
//            instead of rotting in the registry.
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of
// its own — it produces no stdout, no exit code and no user-facing message.
// The vitest assertion text it fails with is covered by `render`.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { RUNTIME_SYSTEM_ENTRIES } from '~/src/services/workspace/runtime-layout';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/workspace/runtime-layout-drift-guard.test.ts', [
  'render',
  'behavior',
  'integration',
], [{ dim: 'a11y', reason: 'no user-facing surface: emits no stdout, exit code or message of its own' }]);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/** Session ids: `<YYYY-MM-DD>-session-<hex>`. */
const SESSION_ID_SHAPE = /^\d{4}-\d{2}-\d{2}-session-/;

const REGISTERED: ReadonlySet<string> = new Set(RUNTIME_SYSTEM_ENTRIES.map((entry) => entry.name));

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function calledName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

/** Module-level `const NAME = '<literal>'` declarations, name -> value. */
function moduleStringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (ts.isStringLiteral(declaration.initializer)) constants.set(declaration.name.text, declaration.initializer.text);
    }
  }
  return constants;
}

interface RuntimeChildLiteral {
  readonly file: string;
  readonly name: string;
}

/**
 * Every name written into a `.peaks/_runtime/` child slot in one source file.
 *
 * Two shapes reach the same slot:
 *   1. a join/resolve chain — `join(root, '.peaks', '_runtime', '<name>', …)`
 *   2. a single literal        — `'.peaks/_runtime/<name>'`
 *
 * Only LITERALS (and module constants consumed as a child) are collected. A
 * non-literal child (`sid`, `options.sessionId`) is a session id at runtime
 * and needs no registry entry.
 */
function findRuntimeChildren(sourceFile: ts.SourceFile, file: string): RuntimeChildLiteral[] {
  const constants = moduleStringConstants(sourceFile);
  const found: RuntimeChildLiteral[] = [];

  const record = (node: ts.Expression): void => {
    if (ts.isStringLiteral(node)) {
      if (node.text.length > 0) found.push({ file, name: node.text });
      return;
    }
    if (ts.isIdentifier(node)) {
      const value = constants.get(node.text);
      if (value !== undefined && value.length > 0) found.push({ file, name: value });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && /(^|\.)(join|resolve)$/.test(calledName(node.expression))) {
      const at = node.arguments.findIndex((a) => ts.isStringLiteral(a) && a.text === '_runtime');
      if (at >= 0 && at + 1 < node.arguments.length) record(node.arguments[at + 1]!);
    }
    // Shape 2 — a literal that already embeds the segment.
    //
    // The name must be a path SEGMENT: `[A-Za-z0-9._-]+` followed by `/` or
    // end-of-string. A looser pattern (`[^/]+$`) reads the tail of any prose
    // sentence that happens to name the path — measured on this tree it
    // produced `' directory; nothing to check.'` from a doctor message and
    // `'session.json to the canonical session '` from a CLI description.
    if (ts.isStringLiteral(node)) {
      const match = /(?:^|\/)_runtime\/([A-Za-z0-9._-]+)(?:\/|$)/.exec(node.text);
      if (match !== null) found.push({ file, name: match[1]! });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return found;
}

/** Names that are legitimate and must not be demanded of the registry. */
function isExcused(name: string): boolean {
  if (SESSION_ID_SHAPE.test(name)) return true;
  return (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name === '...' ||
    name.includes('<') ||
    name.includes('${') ||
    name.includes('*')
  );
}

interface TreeScan {
  readonly children: RuntimeChildLiteral[];
  readonly constantValues: ReadonlySet<string>;
}

/**
 * Walk a source tree. `root` is a parameter rather than the module constant so
 * the decision below can be driven from a fixture (see the behavior cases).
 */
function scanTree(root: string): TreeScan {
  const children: RuntimeChildLiteral[] = [];
  const constantValues = new Set<string>();
  for (const file of listTsFiles(root)) {
    const sourceFile = parse(file);
    children.push(...findRuntimeChildren(sourceFile, file));
    for (const value of moduleStringConstants(sourceFile).values()) constantValues.add(value);
  }
  return { children, constantValues };
}

interface Drift {
  /** `src/**` writes this name; the registry does not list it. */
  readonly unregistered: readonly RuntimeChildLiteral[];
  /** The registry lists this name; no `src/**` file mentions it. */
  readonly dead: readonly string[];
}

function decide(scan: TreeScan, registered: ReadonlySet<string>, root: string): Drift {
  const inScope = scan.children.filter((child) => !isExcused(child.name));
  const unregistered = inScope
    .filter((child) => !registered.has(child.name))
    .map((child) => ({ file: relativePath(root, child.file).replace(/\\/g, '/'), name: child.name }));
  const seen = new Set(scan.children.map((child) => child.name));
  const dead = [...registered].filter((name) => !seen.has(name) && !scan.constantValues.has(name));
  return { unregistered, dead };
}

/**
 * The message the guard fails with — asserted under `render`.
 *
 * `labelRoot` is the PROJECT root, not the scanned root, so every path in the
 * message reads `src/...` — the form the operator can paste into an editor.
 */
function describeDrift(drift: Drift, registryPath: string): string {
  const parts: string[] = [];
  if (drift.unregistered.length > 0) {
    parts.push(
      `src/** writes .peaks/_runtime/ child(ren) missing from RUNTIME_SYSTEM_ENTRIES in ${registryPath}: ${drift.unregistered
        .map((child) => `${child.file}: '${child.name}'`)
        .join(', ')}`
    );
  }
  if (drift.dead.length > 0) {
    parts.push(
      `RUNTIME_SYSTEM_ENTRIES lists name(s) that no longer appear as a .peaks/_runtime/ child in src/: ${drift.dead.join(', ')}`
    );
  }
  return parts.join('; ');
}

const REGISTRY_RELATIVE_PATH = 'src/services/workspace/runtime-layout.ts';

function withFixtureTree(files: Readonly<Record<string, string>>, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-runtime-layout-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — the guard walks the real src/ tree', () => {
  const scan = scanTree(SRC_ROOT);
  const drift = decide(scan, REGISTERED, REPO_ROOT);

  it('scans a non-trivial part of the tree (the guard is not sampling nothing)', () => {
    // A probe that samples nothing reports green for the whole space. Pin the
    // reach so a broken walk fails here instead of silently passing below.
    const inScope = scan.children.filter((child) => !isExcused(child.name));
    expect(inScope.length).toBeGreaterThanOrEqual(8);
    expect(new Set(inScope.map((child) => child.file)).size).toBeGreaterThanOrEqual(6);
  });

  it('finds no unregistered `_runtime` child name', () => {
    expect(drift.unregistered, describeDrift(drift, REGISTRY_RELATIVE_PATH)).toEqual([]);
  });

  it('finds no registry entry whose writer disappeared', () => {
    expect(drift.dead, describeDrift(drift, REGISTRY_RELATIVE_PATH)).toEqual([]);
  });

  it('the check consumes the registry instead of re-declaring a local set', () => {
    // The regression this whole file exists for was a LOCAL literal in the
    // check (`new Set(['change'])`) drifting from the tree.
    const checkSource = readFileSync(join(SRC_ROOT, 'services/doctor/doctor-service/checks/l3-orphan-sessions.ts'), 'utf8');
    expect(checkSource).toContain("from '../../../workspace/runtime-layout.js'");
    expect(checkSource).not.toMatch(/const\s+RUNTIME_SYSTEM_SUBDIRS\s*:/);
  });
});

// ── behavior: the decision, on fixtures ──────────────────────────────

describe('Scenario: behavior — the decision, on fixture trees', () => {
  const registered = new Set(['change', 'callers']);

  it('passes a tree whose `_runtime` children are all registered', () => {
    withFixtureTree(
      { 'a.ts': `import { join } from 'node:path';\nexport const A = join(root, '.peaks', '_runtime', 'callers');\n` },
      (root) => expect(decide(scanTree(root), registered, root).unregistered).toEqual([])
    );
  });

  it('flags an unregistered `_runtime` child written by a join chain', () => {
    withFixtureTree(
      { 'a.ts': `import { join } from 'node:path';\nexport const A = join(root, '.peaks', '_runtime', 'newsystem');\n` },
      (root) => {
        const drift = decide(scanTree(root), registered, root);
        expect(drift.unregistered).toEqual([{ file: 'a.ts', name: 'newsystem' }]);
      }
    );
  });

  it('flags an unregistered `_runtime` child written as one literal', () => {
    withFixtureTree({ 'a.ts': `export const P = '.peaks/_runtime/test-cache/';\n` }, (root) => {
      expect(decide(scanTree(root), registered, root).unregistered).toEqual([{ file: 'a.ts', name: 'test-cache' }]);
    });
  });

  it('excuses session-id-shaped children and placeholders', () => {
    withFixtureTree(
      {
        'a.ts': [
          `import { join } from 'node:path';`,
          `export const S = join(root, '.peaks', '_runtime', '2026-09-16-session-5bcf09');`,
          `export const D = join(root, '.peaks', '_runtime', sid);`,
          `export const T = '.peaks/_runtime/<session-id>/leases/';`,
          ``
        ].join('\n')
      },
      (root) => expect(decide(scanTree(root), registered, root).unregistered).toEqual([])
    );
  });

  it('reads a path in a COMMENT as prose, not as a write', () => {
    // `evidence-generator.ts` really carries `.peaks/_runtime/pwned.md` in a
    // comment; a text scan would demand a registry entry for an attack string.
    withFixtureTree(
      { 'a.ts': `// measured: --rid '../../../pwned' wrote .peaks/_runtime/pwned.md\nexport const A = 1;\n` },
      (root) => expect(decide(scanTree(root), registered, root).unregistered).toEqual([])
    );
  });

  it('reads two adjacent literals as two entries, not as one path', () => {
    // `migrate-1-4-1-service.ts` really carries `'_runtime', '_sub_agents'` as
    // consecutive elements of a SKIP array — children of `.peaks/`, not a
    // `.peaks/_runtime/_sub_agents/` path.
    withFixtureTree(
      { 'a.ts': `export const SKIP = new Set(['_runtime', '_sub_agents']);\n` },
      (root) => expect(decide(scanTree(root), registered, root).unregistered).toEqual([])
    );
  });

  it('reports a registry entry that nothing writes any more', () => {
    withFixtureTree({ 'a.ts': `export const A = 1;\n` }, (root) => {
      expect(decide(scanTree(root), new Set(['ghostdir']), root).dead).toEqual(['ghostdir']);
    });
  });

  it('keeps a registry entry alive through a module constant it is written into', () => {
    withFixtureTree(
      {
        'a.ts': `import { join } from 'node:path';\nexport const SCOPE = '_audit';\nexport const P = join(root, '.peaks', '_runtime', SCOPE);\n`
      },
      (root) => expect(decide(scanTree(root), new Set(['_audit']), root).dead).toEqual([])
    );
  });
});

// ── render: the failure message ──────────────────────────────────────

describe('Scenario: render — the failure message names the file and the name', () => {
  it('names each offending file, its literal, and the registry to edit', () => {
    withFixtureTree(
      { 'src/a.ts': `import { join } from 'node:path';\nexport const A = join(root, '.peaks', '_runtime', 'newsystem');\n` },
      (root) => {
        const drift = decide(scanTree(join(root, 'src')), new Set(['change']), root);
        const message = describeDrift(drift, REGISTRY_RELATIVE_PATH);
        expect(message).toContain('src/a.ts');
        expect(message).toContain("'newsystem'");
        expect(message).toContain(REGISTRY_RELATIVE_PATH);
      }
    );
  });

  it('says nothing at all when there is no drift', () => {
    expect(describeDrift({ unregistered: [], dead: [] }, REGISTRY_RELATIVE_PATH)).toBe('');
  });
});
