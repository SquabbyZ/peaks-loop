/**
 * The cross-tool constitution: `AGENTS.md` carries the body, `CLAUDE.md`
 * imports it.
 *
 * WHY TWO FILES. `AGENTS.md` is the cross-tool standard (OpenAI's AGENTS.md,
 * now under the Linux Foundation's Agentic AI Foundation) — 20+ tools read it
 * natively, which is a wider reach than `CLAUDE.md` has. Claude Code reads it
 * too, but only when the project has no `CLAUDE.md` of its own, and Claude
 * Code's own project instructions are `CLAUDE.md`. So the body lives in
 * `AGENTS.md` and `CLAUDE.md` is a pointer that imports it. One body, two
 * readers, no drift.
 *
 * THE IMPORT SYNTAX IS `@AGENTS.md` ON ITS OWN LINE — Claude Code's
 * documented "Import additional files" form (`@path/to/import`), verified
 * against https://code.claude.com/docs/en/memory#import-additional-files.
 * Two facts from that page shape the file: a backticked `@AGENTS.md` is
 * LITERAL text and is NOT imported, and a quoted path is not imported at all.
 * So exactly ONE unbackticked `@AGENTS.md` appears here, and every other
 * mention of the file name is backticked.
 *
 * THE DEGRADED FORM. A tool that does not understand the import sees one
 * pointer line instead of the body — not "nothing". The pointer therefore
 * also names `AGENTS.md` in prose, so a tool that reads the file literally
 * still learns where the instructions are.
 */
import { PRESENCE_CONTRACT_TEXT } from './standards-render-common.js';
import type { ProjectScriptCategory, ProjectScripts } from './project-scripts.js';
import type { StandardsLanguage } from './project-standards-service.js';

/** The shared, cross-tool instruction body. */
export const AGENTS_MD_FILENAME = 'AGENTS.md';

/** The IDE-native file that imports the body. */
export const CLAUDE_MD_FILENAME = 'CLAUDE.md';

/** The category label the AGENTS.md body prints in front of each command. */
const CATEGORY_LABELS: Record<ProjectScriptCategory, string> = {
  build: 'Build',
  test: 'Test',
  lint: 'Lint'
};

/**
 * The exact commands, one line per command, each with its purpose.
 *
 * No command line appears that the project does not actually have — a missing
 * category produces no line at all, because a command an agent cannot run is
 * a failed tool call, not an instruction.
 */
function renderCommandSection(scripts: ProjectScripts): string[] {
  if (scripts.commands.length === 0) return [];
  const lines = ['## Build, test and lint commands', ''];
  for (const entry of scripts.commands) {
    lines.push(`- ${CATEGORY_LABELS[entry.category]}: \`${entry.command}\` — ${entry.purpose}.`);
  }
  lines.push('');
  return lines;
}

/**
 * The standards the agent must read before acting.
 *
 * `rulesRoot` is the directory the project's standards actually live in:
 * `.peaks/standards` for the 2.0 canonical layout, `.claude/rules` for a
 * project still carrying the 1.x tree.
 */
function renderStandardsSection(language: StandardsLanguage, rulesRoot: string): string[] {
  return [
    '## Peaks standards to read',
    '',
    `- Read \`${rulesRoot}/common/coding-style.md\` before editing code.`,
    `- Read \`${rulesRoot}/common/code-review.md\` before reviewing changes.`,
    `- Read \`${rulesRoot}/common/security.md\` before touching filesystem, user input, external calls, auth, or secrets.`,
    `- Read \`${rulesRoot}/${language}/coding-style.md\` for language-specific standards when applicable.`,
    ''
  ];
}

/** The per-role preflight contract the Peaks workflow roles rely on. */
function renderWorkflowSection(): string[] {
  return [
    '## Peaks workflow automation',
    '',
    '- peaks-rd checks these standards before RD planning or implementation work.',
    '- peaks-qa checks code review and security guidance before verification work.',
    '- peaks-code summarizes RD and QA standards preflight before end-to-end code workflows.',
    ''
  ];
}

/** The skill-presence / status-header contract. The text is shared with `peaks standards migrate`. */
function renderPresenceSection(): string[] {
  return ['## Active Peaks-Loop skill presence', '', PRESENCE_CONTRACT_TEXT, ''];
}

/**
 * The provenance marker.
 *
 * It is KEPT — an AI-generated instruction file that reads as if a human had
 * written it is exactly the failure the research behind this layout warns
 * about. It is placed LAST, under its own heading, so it cannot be read as
 * one more instruction at the top of the file.
 */
function renderProvenanceSection(): string[] {
  return ['## Provenance', '', '> 🤖 AI 生成，请审阅', ''];
}

/**
 * The AGENTS.md body.
 *
 * Kept short on purpose: the whole file is loaded on every turn, and a
 * research finding behind this layout says an LLM-generated instruction file
 * that is padded with derivable facts lowers task success and raises
 * reasoning cost. Facts the agent can read off `package.json` (the build
 * tool, the dependency list) are therefore NOT repeated here — they live in
 * the standards files this body points at.
 */
export function renderAgentsMd(
  language: StandardsLanguage,
  scripts: ProjectScripts,
  rulesRoot: string
): string {
  const lines: string[] = [
    '# Project Instructions',
    '',
    'This repository uses project-local Peaks standards. Existing repository conventions override generic generated guidance.',
    ''
  ];
  lines.push(...renderCommandSection(scripts));
  lines.push(...renderStandardsSection(language, rulesRoot));
  lines.push(...renderWorkflowSection());
  lines.push(...renderPresenceSection());
  lines.push(...renderProvenanceSection());
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The CLAUDE.md pointer.
 *
 * `@AGENTS.md` is the import. It must stay unbackticked and unquoted — Claude
 * Code skips code spans and does not import a quoted path — and it must be the
 * only such occurrence in the file, or the body is loaded twice.
 */
export function renderClaudeMdPointer(): string {
  return [
    '# Project Instructions',
    '',
    '@AGENTS.md',
    '',
    'The project instructions live in `AGENTS.md` — the file every coding agent in this',
    'project shares. This file exists only so Claude Code loads that body: edit',
    '`AGENTS.md`, not this file.',
    ''
  ].join('\n');
}
