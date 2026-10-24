// tests/unit/skills/peaks-mut-doc-parity.test.ts
//
// The defect this file exists to kill: the `peaks mut` flag table in
// `src/skills/peaks-mut/SKILL.md` is read by an LLM that then types the
// command. Nothing compared that table against the parser, so it drifted —
// `--mutate` was missing, `asserts` claimed the same flags as `run` (it has
// no `--mutate` at all), and the two root `package.json` scripts carried flag
// shapes the parser rejects.
//
// The guard compares the DOCUMENT against the PARSER, mechanically:
// `createMutCommands({...}).commands` → each subcommand's `options` → the
// real flag set and its required-ness. A bare flag in the document's Flags
// column means REQUIRED; a flag in `[...]` means OPTIONAL. Any difference is
// a red.
//
// It also pins the two root scripts to the same parser, and pins the
// repository's own `stryker.conf.js` to mutate targets that a test actually
// imports — the property that makes a dogfood run measure something.
//
// The Stryker invoker is a FAKE: no test in this file runs Stryker.
//
// Dimensions covered:
//   - behavior:    the flag table, the scripts and the stryker config
//   - integration: real files on disk (SKILL.md, package.json, stryker.conf.js)
//   - render:      the report command's stdout / stderr envelope
//   - a11y:        the documented exit codes
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/peaks-mut-doc-parity.test.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMutCommands } from '../../../src/cli/commands/mut-commands.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import type { StrykerInvoker } from 'peaks-loop-mut';

declareDimensions('tests/unit/skills/peaks-mut-doc-parity.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILL_MD = join(REPO_ROOT, 'src/skills/peaks-mut/SKILL.md');
const STRYKER_CONF = join(REPO_ROOT, 'stryker.conf.js');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

/** A flag token: `--name`, optionally with its value placeholder. */
const FLAG_TOKEN = /--[a-z0-9-]+(?: <[^>]+>)?/g;

interface FlagSets {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

interface DocRow extends FlagSets {
  readonly name: string;
}

/** A Stryker invoker that never runs Stryker. */
const fakeInvoker: StrykerInvoker = async () => ({
  mutantsTotal: 0,
  mutantsKilled: 0,
  mutantsSurvived: 0,
  mutantsTimeout: 0,
  perFile: []
});

function normalizeFlag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** The flags a commander option declares, as written in the document. */
function flagsOf(text: string): string[] {
  return (text.match(FLAG_TOKEN) ?? []).map(normalizeFlag);
}

/**
 * Parse the CLI table out of the skill document. The table is the one whose
 * header row names a `Subcommand` and a `Flags` column; every other table in
 * the document is ignored.
 */
function docFlagTable(markdown: string): Map<string, DocRow> {
  const rows = new Map<string, DocRow>();
  const lines = markdown.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[1] === 'Subcommand' && cells[2] === 'Flags') {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const name = (cells[1] ?? '').replace(/`/g, '');
    if (!/^[a-z][a-z-]*$/.test(name)) continue;
    const optional: string[] = [];
    const rest = (cells[2] ?? '').replace(/\[([^\]]*)\]/g, (_all, inner: string) => {
      optional.push(...flagsOf(inner));
      return ' ';
    });
    rows.set(name, { name, required: flagsOf(rest), optional });
  }
  return rows;
}

/** The flags the parser actually accepts, per subcommand. */
function parserFlagTable(): Map<string, DocRow> {
  const mut = createMutCommands({ invokeStryker: fakeInvoker });
  const rows = new Map<string, DocRow>();
  for (const cmd of mut.commands) {
    const required: string[] = [];
    const optional: string[] = [];
    for (const opt of cmd.options) {
      (opt.mandatory ? required : optional).push(normalizeFlag(opt.flags));
    }
    rows.set(cmd.name(), {
      name: cmd.name(),
      required: required.sort(),
      optional: optional.sort()
    });
  }
  return rows;
}

/** Every difference between the documented table and the parser. */
function flagDrift(doc: Map<string, DocRow>, parser: Map<string, DocRow>): string[] {
  const problems: string[] = [];
  for (const [name, expected] of parser) {
    const actual = doc.get(name);
    if (!actual) {
      problems.push(`${name}: not documented`);
      continue;
    }
    for (const kind of ['required', 'optional'] as const) {
      const want = [...expected[kind]].sort().join(' ');
      const got = [...actual[kind]].sort().join(' ');
      if (want !== got) problems.push(`${name}.${kind}: doc="${got}" parser="${want}"`);
    }
  }
  for (const name of doc.keys()) {
    if (!parser.has(name)) problems.push(`${name}: documented but not registered`);
  }
  return problems;
}

describe('the peaks-mut skill document describes the CLI that exists (behavior)', () => {
  it('when the documented CLI table is compared with the parser, should document every registered subcommand with the same flags', () => {
    // given: the skill document's CLI table and the live parser flag sets
    // when: the documented table is compared with the parser
    // then: no difference between them is reported
    const doc = docFlagTable(readFileSync(SKILL_MD, 'utf8'));

    expect(flagDrift(doc, parserFlagTable())).toEqual([]);
  });

  it('turns red when a documented flag name is wrong', () => {
    // given: the skill document with one flag renamed
    // when: the renamed document is compared with the parser
    // then: the drift is reported
    const markdown = readFileSync(SKILL_MD, 'utf8');
    const broken = markdown.replace(/--input-sig/g, '--input-signature');

    expect(broken).not.toBe(markdown);
    expect(flagDrift(docFlagTable(broken), parserFlagTable()).length).toBeGreaterThan(0);
  });

  it('turns red when a required flag is documented as optional', () => {
    // given: the skill document with a required flag marked optional
    // when: the edited document is compared with the parser
    // then: the required-ness drift is reported
    const markdown = readFileSync(SKILL_MD, 'utf8');
    const broken = markdown.replace(/--session-id <sid>/g, '[--session-id <sid>]');

    expect(broken).not.toBe(markdown);
    expect(flagDrift(docFlagTable(broken), parserFlagTable()).length).toBeGreaterThan(0);
  });
});

/** The flag NAMES of a set of documented flags (`--out <path>` → `--out`). */
function flagNames(flags: readonly string[]): string[] {
  return flags.map((flag) => flag.split(' ')[0] ?? flag);
}

/** The flags a root script uses, and the subcommand it drives. */
function scriptShape(script: string): { subcommand: string; flags: string[] } {
  const match = /peaks\s+mut\s+([a-z]+)/.exec(script);
  const subcommand = match?.[1] ?? '';
  const flags = (script.match(/--[a-z0-9-]+/g) ?? []).map(normalizeFlag);
  return { subcommand, flags };
}

describe('the root mut scripts carry the real flag shape (behavior)', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('when the mut:run script is read, should name a registered subcommand and only flags that subcommand accepts', () => {
    // given: the mut:run script and the parser's flag sets
    // when: the script's subcommand and flags are extracted
    // then: the subcommand is registered and every flag is one it accepts
    const parser = parserFlagTable();
    const shape = scriptShape(pkg.scripts['mut:run'] ?? '');

    expect(shape.subcommand).toBe('run');
    const accepted = flagNames([
      ...(parser.get('run')?.required ?? []),
      ...(parser.get('run')?.optional ?? [])
    ]);
    for (const flag of shape.flags) {
      expect(accepted).toContain(flag);
    }
  });

  it('when the mut:scan script is read, should drive mut asserts — not mut report — with that subcommand’s flags', () => {
    // given: the mut:scan script and the parser's flag sets
    // when: the script's subcommand and flags are extracted
    // then: it drives mut asserts, with flags that subcommand accepts
    const parser = parserFlagTable();
    const shape = scriptShape(pkg.scripts['mut:scan'] ?? '');

    expect(shape.subcommand).toBe('asserts');
    const accepted = flagNames([
      ...(parser.get('asserts')?.required ?? []),
      ...(parser.get('asserts')?.optional ?? [])
    ]);
    for (const flag of shape.flags) {
      expect(accepted).toContain(flag);
    }
    expect(shape.flags).not.toContain('--in');
  });

  it('when both root scripts are compared with the required flags of their subcommands, should pass every required flag', () => {
    // given: the two root scripts and the required flags of their subcommands
    // when: each script's flags are compared with those required flags
    // then: no required flag is missing from either script
    const parser = parserFlagTable();

    for (const [script, subcommand] of [
      ['mut:run', 'run'],
      ['mut:scan', 'asserts']
    ] as const) {
      const shape = scriptShape(pkg.scripts[script] ?? '');
      for (const required of flagNames(parser.get(subcommand)?.required ?? [])) {
        expect(shape.flags, `${script} is missing ${required}`).toContain(required);
      }
    }
  });

  it('when the mut:run placeholder --input-sig is read, should be a 64-hex value the document calls a PLACEHOLDER', () => {
    // given: the mut:run script's placeholder --input-sig and the skill document
    // when: the placeholder's shape and the document's wording are read
    // then: the placeholder is 64 hex digits and the document names it PLACEHOLDER
    const skill = readFileSync(SKILL_MD, 'utf8');
    const value = /--input-sig ([0-9a-f]+)/.exec(pkg.scripts['mut:run'] ?? '')?.[1] ?? '';

    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(skill).toContain('PLACEHOLDER');
  });
});

/** The `mutate` targets named by the repository's own Stryker configuration. */
function strykerMutateTargets(): string[] {
  const source = readFileSync(STRYKER_CONF, 'utf8');
  const block = /mutate:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

/** Every test file under `tests/`. */
function testFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, acc);
    else if (entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

/** The production file a test's import statement points at, if any. */
function importedSource(specifier: string, testFile: string): string | null {
  let base: string | null = null;
  if (specifier.startsWith('~/src/'))
    base = join(REPO_ROOT, 'src', specifier.slice('~/src/'.length));
  else if (specifier.startsWith('.')) base = resolve(dirname(testFile), specifier);
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, base.replace(/\.js$/, '.ts'), join(base, 'index.ts')];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate.replace(/\\/g, '/');
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Test files that VALUE-import a production file (a type-only import does not count). */
function valueImportersOf(source: string): string[] {
  const target = join(REPO_ROOT, source).replace(/\\/g, '/');
  const found: string[] = [];
  for (const { file, specifiers } of testCorpus()) {
    if (specifiers.some((specifier) => importedSource(specifier, file) === target)) {
      found.push(file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'));
    }
  }
  return found;
}

/** Every test file under `tests/`, with its value-import specifiers. Read once. */
let corpus: Array<{ file: string; specifiers: string[] }> | null = null;
function testCorpus(): Array<{ file: string; specifiers: string[] }> {
  if (corpus !== null) return corpus;
  const pattern = /import\s+(?!type\s)[^;]*?from\s*['"]([^'"]+)['"]/g;
  corpus = testFiles(join(REPO_ROOT, 'tests')).map((file) => {
    const body = readFileSync(file, 'utf8');
    const specifiers: string[] = [];
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(body)) !== null) {
      specifiers.push(match[1] ?? '');
    }
    return { file, specifiers };
  });
  return corpus;
}

describe('the repository dogfood configuration measures something (behavior)', () => {
  it('when the repository dogfood configuration is read, should name at most four mutate targets', () => {
    // given: the mutate targets named by stryker.conf.js
    // when: they are counted
    // then: there are at most four
    expect(strykerMutateTargets().length).toBeLessThanOrEqual(4);
  });

  it('when every mutate target is looked up, should find a test that imports it', () => {
    // given: the mutate targets named by stryker.conf.js
    // when: the tests that value-import each target are collected
    // then: every target has at least one importing test
    for (const target of strykerMutateTargets()) {
      expect(valueImportersOf(target), `${target} has no importing test`).not.toEqual([]);
    }
  });
});

/** A mut-report.json that the report schema accepts. */
function validReport(passed: boolean): string {
  const hex = 'a'.repeat(64);
  return JSON.stringify({
    version: '1.0',
    sha256: hex,
    generatedAt: '2026-10-24T00:00:00.000Z',
    inputSig: hex,
    mutation: {
      tool: 'stryker',
      mutantsTotal: 1,
      mutantsKilled: passed ? 1 : 0,
      mutantsSurvived: passed ? 0 : 1,
      mutantsTimeout: 0,
      killRate: passed ? 1 : 0,
      byFile: []
    },
    assertions: { totalAssertions: 0, weakAssertions: 0, weakRate: 0, weakPatterns: [] },
    thresholds: { mutationKillRateMin: 0.8, weakAssertionRateMax: 0.05, passed },
    followups: []
  });
}

let workdir = '';
let savedExitCode: number | string | null | undefined;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-doc-parity-'));
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  rmSync(workdir, { recursive: true, force: true });
});

async function runReport(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const mut = createMutCommands({ invokeStryker: fakeInvoker, io });
  await mut.parseAsync(['report', ...args], { from: 'user' });
  return { stdout: captured.text(), stderr: captured.stderrText() };
}

describe('the documented exit codes are the ones the CLI returns (a11y)', () => {
  it('exits 1 when the report says thresholds failed', async () => {
    // given: a mut report whose thresholds failed
    // when: the report command reads it
    // then: the process exits 1 and stdout carries passed=false
    const path = join(workdir, 'mut-report.json');
    writeFileSync(path, validReport(false), 'utf8');

    const result = await runReport(['--in', path, '--session-id', 'test-session']);

    expect(process.exitCode).toBe(1);
    expect(result.stdout).toContain('passed=false');
  });

  it('exits 2 with INVALID_JSON when the report file cannot be parsed', async () => {
    // given: a report file that is not valid JSON
    // when: the report command reads it
    // then: the process exits 2 and stderr carries INVALID_JSON
    const path = join(workdir, 'broken.json');
    writeFileSync(path, '{not json', 'utf8');

    const result = await runReport(['--in', path, '--session-id', 'test-session']);

    expect(process.exitCode).toBe(2);
    expect(result.stderr).toContain('INVALID_JSON');
  });

  it('exits 0 when the report says thresholds passed', async () => {
    // given: a mut report whose thresholds passed
    // when: the report command reads it
    // then: the process exit code stays unset
    const path = join(workdir, 'mut-report.json');
    writeFileSync(path, validReport(true), 'utf8');

    await runReport(['--in', path, '--session-id', 'test-session']);

    expect(process.exitCode).toBeUndefined();
  });
});
