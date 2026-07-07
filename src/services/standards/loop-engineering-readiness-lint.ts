/**
 * Loop Engineering Readiness linter (M6 — peak-spec §7.5 + §8.4).
 *
 * Pure function: takes the raw markdown text of a peaks-* SKILL.md
 * file and returns either
 *   { ok: true, findings: [] }
 * or
 *   { ok: false, findings: string[] }.
 *
 * The lint asserts three structural properties the spec binds every
 * Loop-Engineering-participating peaks-* skill to:
 *
 *   1. The skill references the shared guideline file
 *      `.peaks/standards/loop-engineering-guidelines.md` (or its
 *      alias `.peaks/standards/loop-engineering-guidelines.md`).
 *      Reference may appear anywhere in the body — code fence,
 *      plain prose, or list item — as long as the literal token is
 *      present.
 *
 *   2. The skill does NOT introduce a CLI verb that bypasses the
 *      LLM-coordinated model. We flag lines that look like
 *      "Run `peaks <verb>` to …" where `<verb>` is not in the
 *      allowlist of LLM-owned sediment / asset / evolution verbs.
 *      The user types NL; the LLM runs the CLI on the user's behalf
 *      (RL-1 / Human-NL-Choice-Only).
 *
 *   3. The skill does NOT introduce a JSON / manifest
 *      hand-authoring surface. We flag lines containing phrases
 *      like "Edit the manifest", "write the JSON", "fill the JSON
 *      file", etc., when they are not part of an explicit allowlist
 *      (allowlist only references; never an instructional phrase).
 *
 * Each finding is a single line of the form:
 *   "<rule>: <offending excerpt>"
 * so a downstream CLI can render it directly without further
 * parsing.
 *
 * The lint intentionally does NOT touch any application-level
 * code; it only parses a SKILL.md text. The peaks CLI command
 * `peaks skill lint --category loop-engineering-readiness
 *   --path <skill-dir>`
 * (registered in src/cli/commands/skill-loop-engineering-readiness.ts)
 * reads the SKILL.md from disk and calls this function.
 *
 * Per RL-1 / Human-NL-Choice-Only and
 * `.peaks/memory/two-forms-only-rule.md`, the user only ever picks
 * via AskUserQuestion or describes in NL; the LLM runs the CLI.
 * This lint is what stops a future peaks-* skill from regressing
 * that rule at the textual layer.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LintFinding = string;

export type ReadinessLintResult =
  | { ok: true; findings: [] }
  | { ok: false; findings: LintFinding[] };

/**
 * The shared guideline file that every Loop-Engineering-participating
 * peaks-* skill must reference. Both the canonical path and the
 * common alias are accepted.
 *
 * The alias is intentionally identical to the canonical path here:
 * the spec sometimes renders it as
 *   `.peaks/standards/loop-engineering-guidelines.md`
 * with a slash prefix and sometimes without. We accept both.
 */
export const LOOP_ENGINEERING_GUIDELINE_PATHS = [
  '.peaks/standards/loop-engineering-guidelines.md',
] as const;

/**
 * The allowlist of CLI verbs that a peaks-* SKILL.md may legitimately
 * instruct an LLM to invoke on the user's behalf. These are the
 * sediment / asset / evolution surface verbs introduced in
 * 2026-07-07-loop-engineering-crystallization-design §7.4 plus the
 * 18-verb sediment pool from 2026-07-04-peaks-maker-dynamic-skill-
 * sediment-design §4.2.
 *
 * Any other `peaks <verb>` token that appears in the form
 *   "Run `peaks <verb>` to …"
 * is treated as a CLI-verb-bypass attempt and flagged.
 */
export const ALLOWED_CLI_VERBS = new Set<string>([
  // sediment pool verbs (M6 reference; peak-maker's owned surface)
  'add-segment',
  'add-bee',
  'refine-bee',
  'clone-bee',
  'promote',
  'retire',
  'dispose',
  'releases',
  'release-show',
  'release-diff',
  'export',
  'import',
  'gc-blobs',
  'list',
  'show',
  'search',
  'recent',
  'rebuild-index',
  // loop crystallizer surface (§7.4)
  'loop',
  'crystallize',
  // evolution ratchet surface (§7.4)
  'evolution',
  'propose',
  'evaluate',
  'revert',
  'mark-keep',
  // umbrella asset surface (§7.4)
  'asset',
  'status',
  // adapter surface (peaks-maker's owned skill runtime)
  'adapter',
  // lint surface (this command's own kind)
  'lint',
  'standards',
  'skill',
  'ready',
]);

/**
 * Phrases that constitute a JSON / manifest hand-authoring surface.
 * If a SKILL.md instructs the user to perform one of these actions,
 * it violates RL-1 / Human-NL-Choice-Only and is flagged.
 *
 * Each entry is a lowercase substring matched against each line of
 * the SKILL.md. The match is case-insensitive; the surrounding
 * `<verb>` placeholders in the original spec are matched literally.
 */
export const JSON_HAND_AUTHORING_PHRASES: ReadonlyArray<string> = [
  'edit the manifest',
  'edit your manifest',
  'edit the json',
  'edit the .json file',
  'write the json',
  'write the json manifest',
  'write the manifest json',
  'fill the json',
  'fill in the json',
  'fill in the manifest',
  'fill in the manifest.json',
  'hand-author the manifest',
  'hand-author the json',
  'open the manifest and',
  'open the manifest.json and',
  'manually edit the manifest',
  'manually edit the json',
];

/**
 * Phrases that explicitly reference a JSON / manifest surface but
 * in an ALLOWED way — e.g. "the manifest is written by the CLI" or
 * "see manifest schema for details". A line that contains one of
 * these allowlisted phrases is NOT flagged even if it contains a
 * JSON-hand-authoring phrase elsewhere on the same line.
 *
 * The allowlist is intentionally narrow; it must mention either
 * the CLI as the writer OR a schema reference, NOT an instructional
 * verb targeting the user.
 */
export const JSON_REFERENCE_ALLOWLIST: ReadonlyArray<string> = [
  'the cli writes',
  'written by the cli',
  'written by peaks',
  'manifest schema',
  'see the manifest schema',
  'see manifest schema',
  'schema_version',
  'peaks.bundle/1',
  'peaks.loop/1',
  'peaks.bee/1',
];

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

/**
 * Lint a SKILL.md text for Loop Engineering readiness.
 *
 * @param skillMdText raw markdown text of a peaks-* SKILL.md
 * @returns a ReadinessLintResult
 */
export function lintSkillLoopEngineeringReadiness(
  skillMdText: string,
): ReadinessLintResult {
  const findings: string[] = [];

  if (typeof skillMdText !== 'string' || skillMdText.trim().length === 0) {
    return {
      ok: false,
      findings: ['skill-md-empty: SKILL.md text is empty or missing'],
    };
  }

  checkGuidelineReference(skillMdText, findings);
  checkCliVerbBypass(skillMdText, findings);
  checkJsonHandAuthoring(skillMdText, findings);

  if (findings.length > 0) {
    return { ok: false, findings };
  }
  return { ok: true, findings: [] };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkGuidelineReference(text: string, findings: string[]): void {
  // Strip code fences before checking — references inside ``` blocks
  // are still valid references (the lint accepts them), but we strip
  // so the substring match is unambiguous.
  const stripped = text;
  for (const ref of LOOP_ENGINEERING_GUIDELINE_PATHS) {
    if (stripped.includes(ref)) {
      return;
    }
  }
  findings.push(
    `missing-guideline-reference: SKILL.md must reference ${LOOP_ENGINEERING_GUIDELINE_PATHS[0]} (spec §7.5 / §8.4 / RL-8)`,
  );
}

function checkCliVerbBypass(text: string, findings: string[]): void {
  // Match lines that contain `peaks <verb>` in a run-this-command
  // pattern: "Run `peaks <verb>` to …" or "`peaks <verb>` to …" or
  // "use `peaks <verb>` to …".
  //
  // The regex is intentionally narrow: it requires backticks around
  // `peaks <verb>` so prose that mentions "peaks <verb>" as a noun
  // (e.g. "peaks skill sediment list") is not flagged. The verb
  // token is captured as the first `[a-z][a-z0-9-]*` chunk after
  // "peaks "; everything between the verb and the closing backtick
  // is allowed (e.g. `peaks custom-evolve my-bee` — verb is
  // "custom-evolve", args are "my-bee").
  const lineRegex = /^\s*[-*]?\s*(?:Run|Use|Type|Execute)\s+`peaks\s+([a-z][a-z0-9-]*)[^`]*`/gim;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    lineRegex.lastIndex = 0;
    while ((m = lineRegex.exec(line)) !== null) {
      const verb = m[1]!;
      if (!ALLOWED_CLI_VERBS.has(verb)) {
        const excerpt = line.trim().slice(0, 120);
        findings.push(
          `cli-verb-bypass: line ${i + 1} introduces CLI verb \`peaks ${verb}\` to be typed by the user (${excerpt}) — only LLM-coordinated verbs from the sediment/asset/evolution surface are allowed (RL-1)`,
        );
      }
    }
  }
}

function checkJsonHandAuthoring(text: string, findings: string[]): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lowered = line.toLowerCase();

    const matchedPhrase = JSON_HAND_AUTHORING_PHRASES.find((p) =>
      lowered.includes(p),
    );
    if (!matchedPhrase) continue;

    const isAllowlisted = JSON_REFERENCE_ALLOWLIST.some((p) =>
      lowered.includes(p),
    );
    if (isAllowlisted) continue;

    const excerpt = line.trim().slice(0, 120);
    findings.push(
      `json-hand-authoring: line ${i + 1} introduces JSON / manifest hand-authoring surface ("${matchedPhrase}") — ${excerpt} (RL-1: user only picks or describes in NL)`,
    );
  }
}