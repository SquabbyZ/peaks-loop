// src/services/lint/project-lint-tool-detection.ts
//
// L1, step one — DISCOVER the lint tooling a project declared for itself.
//
// THE QUESTION THIS ANSWERS: "what will THIS project's gate reject?" The
// answer is not ours to guess: the project already says, in the declaration
// sites it ships. This module reads those declarations (see
// `project-lint-declarations.ts`) and reports which of them name a lint tool.
//
// WHY THERE IS NO LANGUAGE SWITCH HERE. A Go project with golangci-lint, a
// Python project with ruff and a TypeScript project with eslint all travel the
// SAME code path: the file set is never inspected to decide which tool to ask.
// The only vocabulary in this file is a set of lint TOOL names — the DETECTORS,
// not a list of supported languages. Adding a tool to that set is a one-line
// data change; no branch anywhere keys on the language of a file.
//
// WHY "NOTHING FOUND" IS AN EXPLICIT ANSWER. A project that declares no lint
// tool is a real, common state, and reporting it as an empty list would be
// indistinguishable from "we looked and the tool said there is nothing wrong".
// The two are different answers, so the empty case carries a reason.

import { readProjectDeclarations, type DeclaredCommand } from './project-lint-declarations.js';
import type { ProjectLintTool, ProjectLintToolDetection } from './rule-pre-read-types.js';

/** The reason a project with no lint tooling gets. Exact, and never empty. */
export const NO_LINT_TOOL_REASON = 'no lint tool declared by this project';

/**
 * The lint vocabulary — tool names that report style or correctness findings.
 *
 * A tool whose NAME carries one of these markers is recognized without being
 * listed here (`eslint`, `golangci-lint`, `gofmt`, `swiftlint`, …); the set
 * below covers the tools whose name carries no marker. This is a list of
 * DETECTORS, never a list of languages: nothing in this file branches on the
 * language of a file.
 */
const LINT_TOOL_NAMES = new Set([
  'bandit',
  'biome',
  'black',
  'clippy',
  'codespell',
  'credo',
  'flake8',
  'gosec',
  'govet',
  'isort',
  'misspell',
  'mypy',
  'perlcritic',
  'phpcs',
  'phpstan',
  'prettier',
  'pylint',
  'pyright',
  'radon',
  'revive',
  'rubocop',
  'ruff',
  'safety',
  'scalafix',
  'selene',
  'shellcheck',
  'shfmt',
  'spotbugs',
  'standardrb',
  'stylua',
  'tsc',
  'typos',
  'vulture'
]);

/**
 * A name that CARRIES a lint marker is a lint tool without being listed:
 * `eslint`, `stylelint`, `golangci-lint`, `gofmt`, `rustfmt`, `ktlint`,
 * `swiftlint`, `markdownlint`, `hadolint`, `clang-format`, `go vet`, …
 */
const LINT_NAME_MARKER = /lint|fmt|format|style|vet/;

/** Package managers whose next argument is a SCRIPT the project declares. */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Runners whose next argument is the tool itself. */
const DIRECT_RUNNERS = new Set(['npx', 'bunx', 'uvx', 'pipx', 'dlx']);

/** The tool a command line invokes, or `null` when it invokes no known tool. */
export function toolNameFromCommand(
  command: string,
  scripts: ReadonlyMap<string, string>,
  depth = 0
): string | null {
  const tokens = tokenize(command);
  const head = tokens[0];
  if (head === undefined) return null;
  if (PACKAGE_MANAGERS.has(head)) return packageManagerTool(tokens, scripts, depth);
  if (DIRECT_RUNNERS.has(head)) return baseName(tokens[1]);
  const special = specialTool(head, tokens);
  if (special !== null) return special;
  return baseName(head);
}

/** The command's words, without the environment assignments in front of it. */
function tokenize(command: string): readonly string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^[\w.-]+=/.test(token));
}

/**
 * The tool a command reaches THROUGH another program: `poetry run ruff`,
 * `go vet`, `cargo clippy`, `dotnet format`, `python -m flake8`.
 */
function specialTool(head: string, tokens: readonly string[]): string | null {
  if (head === 'poetry') return tokens[1] === 'run' ? baseName(tokens[2]) : null;
  if (head === 'go') return goTool(tokens);
  if (head === 'cargo') return cargoTool(tokens);
  if (head === 'dotnet') return tokens[1] === 'format' ? 'dotnet format' : null;
  if (head === 'python' || head === 'python3') {
    return tokens[1] === '-m' ? baseName(tokens[2]) : null;
  }
  return null;
}

function packageManagerTool(
  tokens: readonly string[],
  scripts: ReadonlyMap<string, string>,
  depth: number
): string | null {
  const next = tokens[1];
  if (next === undefined) return null;
  if (next === 'run' || next === 'exec' || next === 'dlx') return baseName(tokens[2]);
  if (depth > 0) return null;
  const script = scripts.get(next);
  return script === undefined ? null : toolNameFromCommand(script, scripts, depth + 1);
}

function goTool(tokens: readonly string[]): string | null {
  if (tokens[1] === 'tool') return baseName(tokens[2]);
  if (tokens[1] === 'vet') return 'go vet';
  if (tokens[1] === 'fmt') return 'gofmt';
  return null;
}

function cargoTool(tokens: readonly string[]): string | null {
  if (tokens[1] === 'clippy') return 'clippy';
  if (tokens[1] === 'fmt') return 'rustfmt';
  return null;
}

/** A command's executable, reduced to a comparable name. */
function baseName(token: string | undefined): string | null {
  if (token === undefined) return null;
  const name = token.split(/[\\/]/).pop() ?? token;
  const stripped = name.replace(/\.(exe|cmd|bat|ps1|sh|py|js|mjs|cjs)$/i, '');
  return stripped.toLowerCase();
}

/** Whether a name is a lint tool's name. */
export function isLintToolName(name: string): boolean {
  return LINT_TOOL_NAMES.has(name) || LINT_NAME_MARKER.test(name);
}

/**
 * The project's own lint tooling, discovered from its declaration sites.
 *
 * A project that declares no lint tool gets an EXPLICIT reason, never a
 * silent empty list.
 */
export function detectProjectLintTools(projectRoot: string): ProjectLintToolDetection {
  const declarations = readProjectDeclarations(projectRoot);
  const tools: ProjectLintTool[] = [];
  const seen = new Set<string>();
  for (const declared of declarations.commands) {
    const name = declaredToolName(declared, declarations.scripts);
    if (name === '') continue;
    const key = `${name}|${declared.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push({ name, declaredBy: declared.declaredBy, command: declared.command });
  }
  if (tools.length === 0) {
    const suffix =
      declarations.problems.length === 0 ? '' : ` (${declarations.problems.join('; ')})`;
    return { tools, reason: `${NO_LINT_TOOL_REASON}${suffix}`, problems: declarations.problems };
  }
  return {
    tools,
    reason: `${String(tools.length)} lint tool(s) declared by this project`,
    problems: declarations.problems
  };
}

/**
 * The name a declaration is reported under.
 *
 * The tool the command RUNS wins when that tool is a lint tool. Otherwise the
 * declaration's own name is used — a script called `lint` that wraps a
 * wrapper is still a lint step, and the reader deserves to see it.
 *
 * The NAME's own namespace decides, not the whole name: `lint:silent-warning`
 * is a lint step, `test:lint` is a test that happens to run a lint config.
 * A namespace's first segment says what the step IS; a later segment only
 * says which variant it is.
 */
function declaredToolName(declared: DeclaredCommand, scripts: ReadonlyMap<string, string>): string {
  const resolved = toolNameFromCommand(declared.command, scripts);
  if (resolved !== null && isLintToolName(resolved)) return resolved;
  return isLintToolName(labelRoot(declared.label)) ? declared.label : '';
}

/** A declaration name's own namespace: `lint:silent-warning` → `lint`. */
function labelRoot(label: string): string {
  return label.split(/[:/]/)[0] ?? label;
}
