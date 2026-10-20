// src/services/lint/rule-pre-read-types.ts
//
// The shapes the rule pre-read speaks in.
//
// THREE LAYERS, THREE QUESTIONS. A rule set is only useful if a reader can
// tell WHERE a rule came from, because the three sources answer different
// questions and a fix that ignores one of them is still a fix that gets
// rejected:
//
//   - `project`  — "what will THIS project's gate reject?" (the project's own
//                  lint tooling, asked for its effective configuration)
//   - `language` — "how should code in this language be written?" (the OCR
//                  delegate rule channel: deterministic, no key, no LLM call)
//   - `curated`  — "what are the general rules for this language?" (the ECC
//                  curated rule sets)
//
// `pattern` is the scope a rule was resolved for: a glob for the language and
// curated layers (the same pattern's text is emitted ONCE, never once per
// file), and the file list a project's resolved configuration covers for the
// project layer (a project's configuration is resolved per file, so the files
// that share one are named together).

/** Where a rule came from. */
export type RuleLayer = 'project' | 'language' | 'curated';

/** One effective rule, tagged with the layer that produced it. */
export interface EffectiveRule {
  readonly layer: RuleLayer;
  /** The concrete source: `eslint`, `ocr:system`, `ecc:typescript`, … */
  readonly source: string;
  /** The scope the rule was resolved for — a glob, or the files it covers. */
  readonly pattern: string;
  /** The rule text itself. */
  readonly rule: string;
}

/** The three layers, read for one file set. */
export interface RuleSet {
  /** The files the rules were read for, POSIX-normalized and deduplicated. */
  readonly files: readonly string[];
  readonly rules: readonly EffectiveRule[];
  /** The lint tools the project declared, by name. */
  readonly detectedTools: readonly string[];
  /**
   * Why the read looks the way it does. NEVER empty: a layer that could not
   * be read says so here, because "no rules found" and "the layer never ran"
   * are different answers and this repository has been bitten by that
   * distinction before.
   */
  readonly reason: string;
}

/** A lint tool the project declared for itself. */
export interface ProjectLintTool {
  /** The tool's name (`eslint`, `ruff`, `golangci-lint`, …). */
  readonly name: string;
  /** Where the project declared it — the declaration site, not a guess. */
  readonly declaredBy: string;
  /** The command the project declared. */
  readonly command: string;
}

/** The outcome of looking for the project's own lint tooling. */
export interface ProjectLintToolDetection {
  readonly tools: readonly ProjectLintTool[];
  /**
   * The explicit reason when no tool was found — never a silent empty list.
   */
  readonly reason: string;
  /** Declaration sites that could not be read (malformed, unreadable, …). */
  readonly problems: readonly string[];
}

/** The result of running one external tool as a subprocess. */
export type ToolInvocation =
  { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly reason: string };

/**
 * The seams a test replaces so a rule read never spawns anything. Production
 * callers pass nothing: every seam falls back to the real tool.
 */
export interface RulePreReadDeps {
  /** Replaces the OCR delegate rule invocation. */
  readonly invokeDelegate?: (args: readonly string[], cwd: string) => ToolInvocation;
  /** Replaces the invocation of a project's own lint tool. */
  readonly invokeProjectTool?: (argv: readonly string[], cwd: string) => ToolInvocation;
  /** Replaces the lookup of the curated (ECC) rule root. */
  readonly resolveCuratedRoot?: () => string | null;
}
