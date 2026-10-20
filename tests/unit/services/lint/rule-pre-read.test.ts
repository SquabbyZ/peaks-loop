// tests/unit/services/lint/rule-pre-read.test.ts
//
// The rule pre-read — the three layers that decide what "good code" means for
// a given file set.
//
// THE CLAIMS ASSERTED HERE, and none of them is structural:
//
//   - the project's own lint tooling is DISCOVERED from the declaration sites
//     the project ships, and a project that declares none says so EXPLICITLY.
//     A silent empty list would be indistinguishable from "the tool found
//     nothing wrong" — the distinction this repository has been bitten by.
//
//   - the same pattern's rule text is emitted ONCE, never once per file. A
//     single TypeScript pattern carries about 2 KB of rule text, so a
//     per-file emission is what blows a fix prompt up.
//
//   - the file set is never inspected to decide WHICH rules apply. The
//     curated layer matches the patterns each rule file DECLARES, so a rule
//     file with no declared pattern governs every file and one with
//     `**\/*.ts` governs the TypeScript files only.
//
//   - every layer that could not be read says so. "No rules" and "the layer
//     never ran" are different answers.
//
// Dimensions covered:
//   - behavior:    what each layer returns for a given project and file set
//   - integration: the declaration sites and the curated rule tree on disk
//   - a11y:        the reasons a caller reads when a layer is missing
// Omitted:
//   - render:      the rule set is data — the `peaks lint rules` verb renders
//                  it, and that verb is covered by its own CLI test

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectProjectLintTools,
  normalizeFileSet,
  readEffectiveRules
} from '../../../../src/services/lint/rule-pre-read.js';
import type { RulePreReadDeps } from '../../../../src/services/lint/rule-pre-read-types.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

/** A project directory holding the given files. */
function makeProject(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rule-preread-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return root;
}

/** The `ocr delegate rule` envelope, as the pinned CLI prints it. */
function delegateOutput(groups: readonly unknown[]): string {
  return JSON.stringify({ schema_version: '1', groups });
}

/** One delegate group, with the shape the pinned CLI prints. */
function delegateGroup(pattern: string, files: readonly string[], rule: string): unknown {
  return { group_id: 1, source: 'system', pattern, files: [...files], rule };
}

/** A printed ESLint configuration, as `eslint --print-config` prints it. */
const ESLINT_CONFIG = JSON.stringify({
  rules: { 'no-magic-numbers': ['warn'], eqeqeq: ['error'] }
});

/** The seams that keep the read from spawning anything. */
function deps(overrides: Partial<RulePreReadDeps> = {}): RulePreReadDeps {
  return {
    invokeDelegate: () => ({ ok: true, stdout: delegateOutput([]) }),
    invokeProjectTool: () => ({ ok: true, stdout: ESLINT_CONFIG }),
    resolveCuratedRoot: () => null,
    ...overrides
  };
}

describe("Scenario: behavior — the project's own lint tooling is discovered", () => {
  it('when the project declares no lint tool, should say so explicitly instead of returning silence', () => {
    // given: a project that ships no declaration site at all
    const root = makeProject({ 'README.md': '# nothing here' });
    // when: the project is asked what lint tooling it declared
    const detection = detectProjectLintTools(root);
    // then: there are no tools, and the reason says WHY
    expect(detection.tools).toEqual([]);
    expect(detection.reason).toBe('no lint tool declared by this project');
  });

  it('when package.json declares a lint script, should detect the tool and name the declaration site', () => {
    // given: a project whose lint script runs eslint
    const root = makeProject({
      'package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run' } })
    });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: eslint is found, and the site that declared it is named
    expect(detection.tools.map((tool) => tool.name)).toContain('eslint');
    expect(detection.tools[0]?.declaredBy).toBe('package.json scripts.lint');
  });

  it('when the Makefile declares a lint target, should detect the tool it runs', () => {
    // given: a Makefile whose lint target runs ruff
    const root = makeProject({ Makefile: 'lint:\n\truff check .\n\ntest:\n\tpytest\n' });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: ruff is found
    expect(detection.tools.map((tool) => tool.name)).toContain('ruff');
  });

  it('when pyproject.toml declares a tool table, should detect that tool', () => {
    // given: a Python project with a ruff table
    const root = makeProject({ 'pyproject.toml': '[project]\nname = "x"\n\n[tool.ruff]\n' });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: ruff is found
    expect(detection.tools.map((tool) => tool.name)).toContain('ruff');
  });

  it('when go.mod declares a lint tool directive, should detect that tool', () => {
    // given: a Go module that declares golangci-lint as a tool
    const root = makeProject({
      'go.mod': 'module x\n\ngo 1.24\n\ntool github.com/golangci/golangci-lint/cmd/golangci-lint\n'
    });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: golangci-lint is found
    expect(detection.tools.map((tool) => tool.name)).toContain('golangci-lint');
  });

  it('when a CI workflow runs a lint step, should detect the tool it runs', () => {
    // given: a workflow that lints on every push
    const root = makeProject({
      '.github/workflows/ci.yml':
        'name: ci\non: push\njobs:\n  build:\n    steps:\n      - run: npx eslint .\n'
    });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: eslint is found, and the workflow line is named
    expect(detection.tools.map((tool) => tool.name)).toContain('eslint');
    expect(detection.tools[0]?.declaredBy).toBe('.github/workflows/ci.yml:6');
  });

  it('when the project declares only a test command, should not report a lint tool', () => {
    // given: a project whose only script runs the tests
    const root = makeProject({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } })
    });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: no lint tool, and the reason is still explicit
    expect(detection.tools).toEqual([]);
    expect(detection.reason).toBe('no lint tool declared by this project');
  });

  it('when a package script is a wrapper around a real linter, should still name the linter', () => {
    // given: a script whose NAME says lint and whose body runs a wrapper
    const root = makeProject({
      'package.json': JSON.stringify({ scripts: { lint: 'node ./scripts/lint/run-lint.mjs' } })
    });
    // when: the project is asked
    const detection = detectProjectLintTools(root);
    // then: the declaration is reported — the executable is not a linter, but
    //   the project named the step as one
    expect(detection.tools.map((tool) => tool.name)).toContain('lint');
    expect(detection.tools[0]?.command).toBe('node ./scripts/lint/run-lint.mjs');
  });
});

describe('Scenario: behavior — one file is one string', () => {
  it('when the same file is written with a backslash and with a slash, should normalize both to the same value', () => {
    // given: one file measured two ways
    const root = makeProject({});
    // when: the set is normalized
    const set = normalizeFileSet(root, ['src\\a.ts', 'src/a.ts']);
    // then: the set holds one file, not two
    expect(set).toEqual(['src/a.ts']);
  });

  it('when the set is unordered, should sort it so the read is deterministic', () => {
    const root = makeProject({});
    expect(normalizeFileSet(root, ['src/b.ts', 'src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('Scenario: behavior — the language channel groups by pattern', () => {
  it('when the delegate returns one group covering three files, should emit that pattern once', () => {
    // given: a project and a delegate that answers with ONE group for three files
    const root = makeProject({});
    const invokeDelegate = (): { ok: true; stdout: string } => ({
      ok: true,
      stdout: delegateOutput([
        delegateGroup(
          '**/*.{ts,js}',
          ['a.ts', 'b.ts', 'c.ts'],
          '#### Code Quality\n- no duplication'
        )
      ])
    });
    // when: the rules are read for the three files
    const ruleSet = readEffectiveRules(root, ['a.ts', 'b.ts', 'c.ts'], deps({ invokeDelegate }));
    // then: the pattern's text appears ONCE, not once per file
    const language = ruleSet.rules.filter((rule) => rule.layer === 'language');
    expect(language).toHaveLength(1);
    expect(language[0]?.pattern).toBe('**/*.{ts,js}');
  });

  it('when the delegate answers with two patterns, should emit one rule per pattern', () => {
    // given: a delegate that answers with two groups
    const root = makeProject({});
    const invokeDelegate = (): { ok: true; stdout: string } => ({
      ok: true,
      stdout: delegateOutput([
        delegateGroup('**/*.{ts,js}', ['a.ts'], 'rule one'),
        delegateGroup('**/*.md', ['b.md'], 'rule two')
      ])
    });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['a.ts', 'b.md'], deps({ invokeDelegate }));
    // then: both patterns are present, each once
    const language = ruleSet.rules.filter((rule) => rule.layer === 'language');
    expect(language.map((rule) => rule.pattern)).toEqual(['**/*.{ts,js}', '**/*.md']);
  });
});

describe("Scenario: behavior — the project layer asks the project's own tool", () => {
  it('when the project declares eslint, should read the effective configuration it printed', () => {
    // given: a project whose lint script runs eslint
    const root = makeProject({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
    // when: the rules are read for one file
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps());
    // then: the project's own rules are present, tagged as the project layer
    const project = ruleSet.rules.filter((rule) => rule.layer === 'project');
    expect(project).toHaveLength(1);
    expect(project[0]?.source).toBe('eslint');
    expect(project[0]?.rule).toContain('no-magic-numbers');
    expect(ruleSet.detectedTools).toContain('eslint');
  });

  it('when two files resolve to the same configuration, should carry that configuration once', () => {
    // given: two files and a tool that prints the same configuration for both
    const root = makeProject({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
    // when: the rules are read for both files
    const ruleSet = readEffectiveRules(root, ['src/a.ts', 'src/b.ts'], deps());
    // then: ONE project entry covers both files
    const project = ruleSet.rules.filter((rule) => rule.layer === 'project');
    expect(project).toHaveLength(1);
    expect(project[0]?.pattern).toBe('src/a.ts, src/b.ts');
  });

  it('when the project declares a tool that cannot print a configuration, should still report what it runs', () => {
    // given: a project whose lint script runs a tool this module cannot query
    const root = makeProject({
      'package.json': JSON.stringify({ scripts: { lint: 'golangci-lint run' } })
    });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.go'], deps());
    // then: the declaration itself is the rule the reader gets
    const project = ruleSet.rules.filter((rule) => rule.layer === 'project');
    expect(project).toHaveLength(1);
    expect(project[0]?.rule).toContain('golangci-lint run');
  });

  it("when the project's own tool cannot run, should report the failure and still say what it runs", () => {
    // given: a project whose lint script runs eslint, and an eslint that is not installed
    const root = makeProject({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
    const invokeProjectTool = (): { ok: false; reason: string } => ({
      ok: false,
      reason: 'eslint could not be spawned: ENOENT'
    });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps({ invokeProjectTool }));
    // then: the failure is named, and the declaration still reaches the reader
    expect(ruleSet.reason).toContain('eslint: src/a.ts');
    const project = ruleSet.rules.filter((rule) => rule.layer === 'project');
    expect(project).toHaveLength(1);
    expect(project[0]?.rule).toContain('eslint .');
  });
});

describe('Scenario: integration — the curated layer matches the patterns a rule file declares', () => {
  it('when a curated rule file declares a pattern, should apply it to the matching files only', () => {
    // given: a curated tree with one typed rule and one untyped rule
    const curated = makeProject({
      'rules/typescript/coding-style.md':
        '---\npaths:\n  - "**/*.ts"\n---\n# TypeScript Coding Style\n\n- prefer explicit types\n',
      'rules/common/coding-style.md': '# Common Coding Style\n\n- always name new objects\n'
    });
    const root = makeProject({});
    // when: the rules are read for a TypeScript and a Python file
    const ruleSet = readEffectiveRules(
      root,
      ['src/a.ts', 'src/b.py'],
      deps({ resolveCuratedRoot: () => join(curated, 'rules') })
    );
    // then: the typed rule covers the TypeScript file only, the untyped one both
    const typed = ruleSet.rules.find((rule) => rule.source === 'ecc:typescript');
    const untyped = ruleSet.rules.find((rule) => rule.source === 'ecc:common');
    expect(typed?.pattern).toBe('**/*.ts');
    expect(typed?.rule).toContain('prefer explicit types');
    expect(untyped?.pattern).toBe('*');
  });

  it('when the curated tree is not available, should say the layer did not run', () => {
    // given: a project whose curated layer cannot be resolved
    const root = makeProject({});
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps());
    // then: the reason names the missing layer
    expect(ruleSet.reason).toContain('curated');
  });
});

describe('Scenario: a11y — the reasons name what could not be read', () => {
  it('when the language channel fails, should name the failure instead of returning an empty rule set', () => {
    // given: a delegate that cannot run
    const root = makeProject({});
    const invokeDelegate = (): { ok: false; reason: string } => ({
      ok: false,
      reason: 'ocr18-missing: the pinned CLI is not installed'
    });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps({ invokeDelegate }));
    // then: the reason says the channel failed, and the failure is quoted
    expect(ruleSet.reason).toContain('the language rule channel failed');
    expect(ruleSet.reason).toContain('ocr18-missing');
  });

  it('when the project declares no lint tool, should say so in the reason of the whole read', () => {
    // given: a project with no declaration site
    const root = makeProject({ 'README.md': '# x' });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps());
    // then: the reason names the missing project layer
    expect(ruleSet.reason).toContain('no lint tool declared by this project');
    expect(ruleSet.detectedTools).toEqual([]);
  });

  it('when every layer was read, should say so rather than leaving the reason empty', () => {
    // given: a project whose layers all answer
    const root = makeProject({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
    // when: the rules are read
    const ruleSet = readEffectiveRules(root, ['src/a.ts'], deps());
    // then: the reason is not empty
    expect(ruleSet.reason.length).toBeGreaterThan(0);
  });
});
