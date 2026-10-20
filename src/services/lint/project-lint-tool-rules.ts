// src/services/lint/project-lint-tool-rules.ts
//
// L1, step two — ask the PROJECT'S OWN tooling for its effective rules.
//
// The project already owns the answer to "what will your gate reject?"; this
// module asks that tool directly instead of re-implementing a lint engine or
// parsing a configuration format. ESLint answers with `eslint --print-config
// <file>`; stylelint has the equivalent. A tool that cannot answer is still
// reported — the reader learns what the project DECLARES it runs, which is the
// part of the answer that does not need a tool to be installed.
//
// GROUPING IS THE POINT. A project's configuration is resolved per file, so
// ten files of the same kind resolve to the SAME configuration. The resolved
// text is therefore keyed by content: one entry covers every file that shares
// it, and the entry names those files. Without that, N files would carry N
// copies of the same rule text into a fix prompt.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ESLINT_PACKAGE_PINS } from './eslint-runner-types.js';
import { resolveNpxInvocation } from './npx-resolver.js';
import type {
  EffectiveRule,
  ProjectLintTool,
  RulePreReadDeps,
  ToolInvocation
} from './rule-pre-read-types.js';

/** How long a project's own tool may take to print its configuration. */
const TOOL_TIMEOUT_MS = 60_000;

/** The buffer a tool's configuration may fill — 32 MiB. */
const TOOL_MAX_BUFFER_BYTES = 33_554_432;

/** How much of a failed tool's output is quoted back as the reason. */
const REASON_EXCERPT_CHARS = 400;

/** A command to run, resolved to something spawnable. */
type ToolCommand = {
  readonly command: string;
  readonly args: readonly string[];
};

/** A tool that can print the configuration in force for one file. */
type ConfigPrinter = {
  readonly tool: string;
  readonly commandFor: (file: string, root: string) => ToolCommand;
  readonly render: (config: unknown) => string | null;
};

/**
 * The tools that can be asked for their effective configuration. A tool that
 * is not here is still detected and still reported — as a declaration.
 */
const CONFIG_PRINTERS: readonly ConfigPrinter[] = [
  {
    tool: 'eslint',
    commandFor: eslintCommand,
    render: renderRuleMap
  },
  {
    tool: 'stylelint',
    commandFor: stylelintCommand,
    render: renderRuleMap
  }
];

/** ESLint: the project's own copy when it has one, the pinned release otherwise. */
function eslintCommand(file: string, root: string): ToolCommand {
  const local = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (existsSync(local)) {
    return { command: process.execPath, args: [local, '--print-config', file] };
  }
  const resolved = resolveNpxInvocation([
    '--package',
    `eslint@${ESLINT_PACKAGE_PINS.eslint}`,
    '--',
    'eslint',
    '--print-config',
    file
  ]);
  return { command: resolved.command, args: resolved.args };
}

/** stylelint: the project's own copy when it has one, the registry release otherwise. */
function stylelintCommand(file: string, root: string): ToolCommand {
  for (const relative of ['stylelint/bin/stylelint.mjs', 'stylelint/bin/stylelint.js']) {
    const local = join(root, 'node_modules', relative);
    if (existsSync(local)) {
      return { command: process.execPath, args: [local, '--print-config', file] };
    }
  }
  const resolved = resolveNpxInvocation([
    '--package',
    'stylelint',
    '--',
    'stylelint',
    '--print-config',
    file
  ]);
  return { command: resolved.command, args: resolved.args };
}

/**
 * The rules inside a printed configuration, one per line, sorted by rule id.
 *
 * `null` means "this is not a configuration I can read" — a different answer
 * from "the configuration enables no rules", which is an empty string.
 */
export function renderRuleMap(config: unknown): string | null {
  if (config === null || typeof config !== 'object') return null;
  const rules = (config as Record<string, unknown>)['rules'];
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const entries = Object.entries(rules as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return entries.map(([id, value]) => `${id}: ${JSON.stringify(value)}`).join('\n');
}

/** The JSON object a tool printed, or the reason it printed none. */
function parsePrintedConfig(
  stdout: string
): { ok: true; config: unknown } | { ok: false; reason: string } {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, reason: 'the tool printed no JSON object' };
  }
  try {
    return { ok: true, config: JSON.parse(stdout.slice(start, end + 1)) as unknown };
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Run one tool and hand back what it printed. */
function runTool(tool: ToolCommand, cwd: string, deps: RulePreReadDeps): ToolInvocation {
  if (deps.invokeProjectTool !== undefined) return deps.invokeProjectTool(tool.args, cwd);
  const result = spawnSync(tool.command, [...tool.args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: TOOL_MAX_BUFFER_BYTES
  });
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, reason: result.error.message };
  }
  if (result.status !== 0) {
    const output = result.stderr || result.stdout || `exit ${String(result.status)}`;
    return { ok: false, reason: output.slice(0, REASON_EXCERPT_CHARS) };
  }
  return { ok: true, stdout: result.stdout ?? '' };
}

/**
 * The project's own effective rules for a file set.
 *
 * Returns the rules AND the reasons the read could not produce them: a tool
 * that is declared but not installed, or a file the tool could not resolve, is
 * reported rather than dropped.
 */
export function readProjectLintRules(
  projectRoot: string,
  tools: readonly ProjectLintTool[],
  files: readonly string[],
  deps: RulePreReadDeps
): { rules: readonly EffectiveRule[]; reasons: readonly string[] } {
  const rules: EffectiveRule[] = [];
  const reasons: string[] = [];
  for (const tool of tools) {
    const printer = CONFIG_PRINTERS.find((entry) => entry.tool === tool.name);
    if (printer === undefined) {
      rules.push(declaredCommandRule(tool));
      continue;
    }
    const resolved = resolveWithTool(printer, projectRoot, files, deps);
    rules.push(...resolved.rules);
    reasons.push(...resolved.reasons);
    // A tool that could not answer still tells the reader what the project
    // DECLARES it runs — that part of the answer does not need the tool to be
    // installed, and a reader who knows the gate runs `eslint .` is not lost.
    if (resolved.rules.length === 0) rules.push(declaredCommandRule(tool));
  }
  return { rules, reasons };
}

/** What a declared-but-unqueryable tool still tells the reader. */
function declaredCommandRule(tool: ProjectLintTool): EffectiveRule {
  return {
    layer: 'project',
    source: tool.name,
    pattern: tool.command,
    rule: `the project runs \`${tool.command}\` (declared at ${tool.declaredBy})`
  };
}

/** One tool's resolved configurations, grouped by content. */
function resolveWithTool(
  printer: ConfigPrinter,
  projectRoot: string,
  files: readonly string[],
  deps: RulePreReadDeps
): { rules: readonly EffectiveRule[]; reasons: readonly string[] } {
  const byConfig = new Map<string, string[]>();
  const reasons: string[] = [];
  for (const file of files) {
    const invoked = runTool(printer.commandFor(file, projectRoot), projectRoot, deps);
    if (!invoked.ok) {
      reasons.push(`${printer.tool}: ${file}: ${invoked.reason}`);
      continue;
    }
    const printed = parsePrintedConfig(invoked.stdout);
    if (!printed.ok) {
      reasons.push(`${printer.tool}: ${file}: ${printed.reason}`);
      continue;
    }
    const rendered = printer.render(printed.config);
    if (rendered === null) {
      reasons.push(`${printer.tool}: ${file}: the tool printed no readable configuration`);
      continue;
    }
    if (rendered.length === 0) continue;
    const covered = byConfig.get(rendered) ?? [];
    covered.push(file);
    byConfig.set(rendered, covered);
  }
  const rules: EffectiveRule[] = [];
  for (const [rendered, covered] of byConfig) {
    rules.push({
      layer: 'project',
      source: printer.tool,
      pattern: covered.join(', '),
      rule: rendered
    });
  }
  return { rules, reasons };
}
