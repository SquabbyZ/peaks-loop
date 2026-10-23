import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { PRESENCE_CONTRACT_TEXT } from './standards-render-common.js';

/**
 * The constitution files a legacy block can live in, newest layout first.
 *
 * `AGENTS.md` carries the body today. `CLAUDE.md` is still checked because a
 * 1.x-era consumer tree has only that one — migrating it is the whole point
 * of this command.
 */
const CONSTITUTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * The file to migrate: the first constitution file that exists, or `null`.
 */
function resolveMigrationTarget(projectRoot: string): string | null {
  for (const name of CONSTITUTION_CANDIDATES) {
    const path = resolve(projectRoot, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * project's `CLAUDE.md` to drop the legacy heartbeat block.
 *
 * The legacy block (rendered by `peaks standards init` / `peaks
 * standards update` before slice 028) contained instructions that:
 *   1. pointed the LLM at the legacy `.peaks/.active-skill.json` path;
 *   2. required the LLM to invoke `peaks skill heartbeat:touch` and
 *      `peaks skill presence:clear` on every turn;
 *   3. ended with an `External reference: https://github.com/affaan-m/...`
 *      line that was peaks-loop-internal, not consumer-facing.
 *
 * The replacement text matches the post-slice-025 peaks-loop repo's own
 * `CLAUDE.md`: route the LLM through `peaks skill presence --json` and
 * render a compact status header when a valid skill is active. This
 * service is the deterministic in-place rewriter that brings existing
 * consumer trees in line with the new template.
 *
 * Behavior:
 *   - `migrateStandards({ project, apply: true })`     — rewrites the
 *     file when the legacy block is present, returns
 *     `applied: true`.
 *   - `migrateStandards({ project, dryRun: true })`    — returns the
 *     would-change preview, no write.
 *   - `migrateStandards({ project })`                  — defaults to a
 *     dry-run. `--apply` is the only opt-in for a destructive write.
 *   - File missing → `file: null`, no throw.
 *   - Legacy block not present → `foundOldBlock: false`, no write.
 */

export const NEW_TEMPLATE_TEXT = PRESENCE_CONTRACT_TEXT;

const LEGACY_BLOCK_OPENER_LINE = 'Peaks-Loop 心跳检测 (heartbeat check)';
const LEGACY_BLOCK_CLOSER =
  'External reference: https://github.com/affaan-m/everything-claude-code';
const LEGACY_MARKER_FALLBACK = 'Do NOT skip step 3-5. The CLI heartbeat:touch command';

const FORBIDDEN_LEGACY_STRINGS = [
  'heartbeat:touch',
  'presence:clear',
  'Default runbook',
  'Startup sequence',
  'Swarm parallel phase'
] as const;

const NEW_TEMPLATE_FINGERPRINT = 'peaks skill presence --json';

export type MigrateStandardsInput = {
  project: string;
  apply?: boolean;
  dryRun?: boolean;
};

export type MigrateStandardsData = {
  file: string | null;
  foundOldBlock: boolean;
  wouldChange: boolean;
  applied: boolean;
  before: { lines: number } | null;
  after: { lines: number } | null;
  nextActions: string[];
};

export type MigrateStandardsResult = {
  ok: true;
  data: MigrateStandardsData;
  warnings: string[];
};

export function detectLegacyBlock(content: string): { found: boolean; start: number; end: number } {
  const openerIndex = content.indexOf(LEGACY_BLOCK_OPENER_LINE);
  if (openerIndex >= 0) {
    // Walk back to the start of the `<!--` line. The opener text is
    // typically indented on the line after `<!--` (the legacy block
    // is a multi-line HTML comment), so we cut from the most recent
    // `<!--` line above. If no `<!--` is found in the surrounding
    // 4 lines, fall back to the start of the opener's own line.
    const htmlCommentIndex = content.lastIndexOf('<!--', openerIndex);
    const previousNewlineBeforeOpener = content.lastIndexOf('\n', openerIndex);
    let start: number;
    if (htmlCommentIndex < 0 || htmlCommentIndex < previousNewlineBeforeOpener - 200) {
      // No `<!--` line within a reasonable distance — start of the
      // opener's own line.
      start = previousNewlineBeforeOpener + 1;
    } else {
      start = content.lastIndexOf('\n', htmlCommentIndex) + 1;
    }
    const closerIndex = content.indexOf(LEGACY_BLOCK_CLOSER, openerIndex);
    let endIndex: number;
    if (closerIndex < 0) {
      const tailIndex = content.indexOf(LEGACY_MARKER_FALLBACK, openerIndex);
      if (tailIndex < 0) {
        endIndex = content.length;
      } else {
        endIndex = content.indexOf('\n', tailIndex);
        if (endIndex < 0) endIndex = content.length;
      }
    } else {
      endIndex = content.indexOf('\n', closerIndex);
      if (endIndex < 0) endIndex = content.length;
    }
    return { found: true, start, end: endIndex };
  }
  // Fallback: opener stripped by editor / re-format. Detect by the
  // first forbidden string that survives the rewrite, then walk back
  // to the start of the line.
  for (const marker of FORBIDDEN_LEGACY_STRINGS) {
    const idx = content.indexOf(marker);
    if (idx >= 0) {
      const start = content.lastIndexOf('\n', idx) + 1;
      return { found: true, start, end: content.length };
    }
  }
  return { found: false, start: -1, end: -1 };
}

export function rewriteLegacyBlock(
  content: string,
  newText: string = NEW_TEMPLATE_TEXT
): { rewritten: string; replaced: boolean } {
  const detection = detectLegacyBlock(content);
  if (!detection.found) {
    return { rewritten: content, replaced: false };
  }
  const before = content.slice(0, detection.start);
  const after = content.slice(detection.end);
  const trimmedBefore = before.replace(/\s+$/u, '\n');
  const cleanedAfter = after.replace(/^\n+/u, '\n');
  const rewritten = `${trimmedBefore}${newText}${cleanedAfter}`;
  return { rewritten, replaced: true };
}

export function migrateStandards(input: MigrateStandardsInput): MigrateStandardsResult {
  const project = input.project;
  const projectRoot = isAbsolute(project) ? project : resolve(project);
  const filePath = resolveMigrationTarget(projectRoot);
  const apply = input.apply === true;
  const dryRun = input.dryRun === true || apply === false;

  if (filePath === null) {
    return {
      ok: true,
      data: {
        file: null,
        foundOldBlock: false,
        wouldChange: false,
        applied: false,
        before: null,
        after: null,
        nextActions: ['AGENTS.md does not exist; nothing to migrate']
      },
      warnings: []
    };
  }

  const original = readFileSync(filePath, 'utf8');
  const detection = detectLegacyBlock(original);

  if (!detection.found) {
    if (original.includes(NEW_TEMPLATE_FINGERPRINT)) {
      return {
        ok: true,
        data: {
          file: filePath,
          foundOldBlock: false,
          wouldChange: false,
          applied: false,
          before: { lines: original.split('\n').length },
          after: null,
          nextActions: ['AGENTS.md is already up to date']
        },
        warnings: []
      };
    }
    return {
      ok: true,
      data: {
        file: filePath,
        foundOldBlock: false,
        wouldChange: false,
        applied: false,
        before: { lines: original.split('\n').length },
        after: null,
        nextActions: ['AGENTS.md has no peaks-loop block; nothing to migrate']
      },
      warnings: []
    };
  }

  const { rewritten } = rewriteLegacyBlock(original);
  const nextActions: string[] = [];

  if (dryRun) {
    nextActions.push('Re-run with --apply to perform the rewrite');
    return {
      ok: true,
      data: {
        file: filePath,
        foundOldBlock: true,
        wouldChange: true,
        applied: false,
        before: { lines: original.split('\n').length },
        after: { lines: rewritten.split('\n').length },
        nextActions
      },
      warnings: []
    };
  }

  writeFileSync(filePath, rewritten, 'utf8');
  nextActions.push('AGENTS.md rewritten; no further action required');
  return {
    ok: true,
    data: {
      file: filePath,
      foundOldBlock: true,
      wouldChange: true,
      applied: true,
      before: { lines: original.split('\n').length },
      after: { lines: rewritten.split('\n').length },
      nextActions
    },
    warnings: []
  };
}
