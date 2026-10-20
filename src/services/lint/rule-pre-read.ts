// src/services/lint/rule-pre-read.ts
//
// The rule pre-read — "what are the rules in force for these files?"
//
// THREE LAYERS, THREE QUESTIONS, NONE OF THEM OPTIONAL:
//
//   L1 `project`  — what will THIS project's gate reject?  The project's own
//                   lint tooling, asked for its effective configuration.
//   L2 `language` — how should code in this language be written?  The OCR
//                   delegate rule channel: deterministic, no API key, no LLM
//                   call, and it accepts a plain path list.
//   L3 `curated`  — what are the general rules for this language?  The ECC
//                   curated rule sets, matched by the file patterns each rule
//                   file declares.
//
// WHY THE FILE SET IS NEVER INSPECTED FOR A LANGUAGE. The mechanism is "ask
// the project what it declares", not "we support these languages". Nothing in
// this module — or in the three it composes — branches on the language of a
// file. A Go project, a Python project and a TypeScript project travel the
// same path; which rules come back is decided by what those projects declare.
//
// GROUPING IS WHAT KEEPS A FIX PROMPT SMALL. One TypeScript pattern carries
// about 2 KB of rule text, so the same pattern's text is emitted ONCE, never
// once per file. The layers that resolve per file (the project's own
// configuration) are grouped by the resolved text instead, so files that share
// a configuration share one entry.
//
// ZERO IS NOT "NEVER RAN". Every layer that could not be read says so in the
// reason, so a caller can tell "there are no rules" from "the layer was
// never asked".

import { buildDelegateRuleArgs, parseDelegateRules } from './ocr-18-delegate-payload.js';
import { invokeOcr } from './ocr-multilang-adapter.js';
import {
  readCuratedRules,
  resolveCuratedRulesRoot,
  type CuratedRoot
} from './curated-rule-reader.js';
import { detectProjectLintTools, NO_LINT_TOOL_REASON } from './project-lint-tool-detection.js';
import { readProjectLintRules } from './project-lint-tool-rules.js';
import { repoRelativeKey } from '../../shared/path-utils.js';
import type {
  EffectiveRule,
  RulePreReadDeps,
  RuleSet,
  ToolInvocation
} from './rule-pre-read-types.js';

export type {
  EffectiveRule,
  ProjectLintTool,
  ProjectLintToolDetection,
  RuleLayer,
  RulePreReadDeps,
  RuleSet,
  ToolInvocation
} from './rule-pre-read-types.js';
export { detectProjectLintTools, NO_LINT_TOOL_REASON } from './project-lint-tool-detection.js';

/** How long the language rule channel may take. */
const DELEGATE_TIMEOUT_MS = 60_000;

/** The reason a read with no problem reports. */
export const RULES_RESOLVED_REASON = 'all three layers resolved';

/**
 * The effective rules for a file set, from all three layers.
 *
 * The returned `reason` is never empty: it names every layer that could not
 * be read, and says so plainly when all three were.
 */
export function readEffectiveRules(
  projectRoot: string,
  files: readonly string[],
  deps: RulePreReadDeps = {}
): RuleSet {
  const normalized = normalizeFileSet(projectRoot, files);
  const detection = detectProjectLintTools(projectRoot);
  const reasons: string[] = [];
  const rules: EffectiveRule[] = [];

  if (detection.tools.length === 0) {
    reasons.push(detection.reason === '' ? NO_LINT_TOOL_REASON : detection.reason);
  } else {
    const project = readProjectLintRules(projectRoot, detection.tools, normalized, deps);
    rules.push(...project.rules);
    reasons.push(...project.reasons);
  }

  const language = readLanguageRules(projectRoot, normalized, deps);
  rules.push(...language.rules);
  reasons.push(...language.reasons);

  const curated = readCuratedRules(normalized, curatedRootFor(deps));
  rules.push(...curated.rules);
  reasons.push(...curated.reasons);

  return {
    files: normalized,
    rules,
    detectedTools: detection.tools.map((tool) => tool.name),
    reason: reasons.length === 0 ? RULES_RESOLVED_REASON : reasons.join('; ')
  };
}

/**
 * The file set, repo-relative and POSIX-normalized.
 *
 * One file must be one string: a Windows path and a POSIX path naming the same
 * file would otherwise be two entries, and a rule that governs one of them
 * would look like it governs only half of the file.
 */
export function normalizeFileSet(projectRoot: string, files: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const raw of files) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const relative = repoRelativeKey(raw, projectRoot).replace(/^\.\//, '');
    if (relative.length > 0) set.add(relative);
  }
  return [...set].sort();
}

/**
 * L2 — the language rule channel.
 *
 * The channel is deterministic: it takes a path list and returns rule text
 * grouped by pattern. No key is read and no model is called.
 */
function readLanguageRules(
  projectRoot: string,
  files: readonly string[],
  deps: RulePreReadDeps
): { rules: readonly EffectiveRule[]; reasons: readonly string[] } {
  if (files.length === 0) return { rules: [], reasons: [] };
  const invoked = invokeDelegateChannel(files, projectRoot, deps);
  if (!invoked.ok) {
    return { rules: [], reasons: [`the language rule channel failed: ${invoked.reason}`] };
  }
  const parsed = parseDelegateRules(invoked.stdout);
  if (!parsed.ok) {
    return { rules: [], reasons: [`the language rule channel failed: ${parsed.rawOutput}`] };
  }
  const rules: EffectiveRule[] = [];
  const seen = new Set<string>();
  for (const group of parsed.groups) {
    // The same pattern's text is emitted ONCE — not once per file it covers.
    const key = `${group.source} ${group.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({
      layer: 'language',
      source: `ocr:${group.source}`,
      pattern: group.pattern,
      rule: group.rule
    });
  }
  return { rules, reasons: [] };
}

/** The language rule channel, through the test seam when there is one. */
function invokeDelegateChannel(
  files: readonly string[],
  projectRoot: string,
  deps: RulePreReadDeps
): ToolInvocation {
  const args = buildDelegateRuleArgs(files, {});
  if (deps.invokeDelegate !== undefined) return deps.invokeDelegate(args, projectRoot);
  const invoked = invokeOcr(args, projectRoot, DELEGATE_TIMEOUT_MS);
  if (!invoked.ok) {
    return { ok: false, reason: `${invoked.state}: ${invoked.rawOutput}` };
  }
  return { ok: true, stdout: invoked.stdout };
}

/** Where the curated rule sets live, through the test seam when there is one. */
function curatedRootFor(deps: RulePreReadDeps): CuratedRoot {
  if (deps.resolveCuratedRoot === undefined) return resolveCuratedRulesRoot();
  const path = deps.resolveCuratedRoot();
  return path === null
    ? { ok: false, reason: 'the curated rule sets are not available' }
    : { ok: true, path };
}
