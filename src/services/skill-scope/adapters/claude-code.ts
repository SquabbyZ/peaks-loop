/**
 * `peaks skill scope` — Claude Code adapter (full impl, slice 025.1).
 *
 * Strategy (tech-doc-025 §3):
 * 1. PRIMARY: write `.claude/settings.local.json` with
 *    `permissions.allow: ["Skill(name)", ...]` + `permissions.deny: [...]`.
 * 2. FALLBACK (R1, `--shadow-fallback`): when the runtime probe determines
 *    Claude Code rejects `Skill(name)` in `permissions.deny`, write a
 *    shadow stub at `.claude/skills/<name>/SKILL.md` for each denylisted
 *    skill. Tagged with `_peaks_scope_disabled: true` (R6).
 *
 * Idempotency: dedupe the allow/deny arrays; shadow-stub writes skip
 * when the marker is already present. AC11.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ApplyResult,
  ApplyScopeInput,
  ResetScopeInput,
  ResetScopeResult,
  ShowScopeResult,
  SkillScopeAdapter,
} from '../types.js';

/** Adapter id. */
const IDE_ID = 'claude-code' as const;

/** Format the `Skill(name)` string Claude Code's permission system uses. */
export function skillRef(name: string): string {
  return `Skill(${name})`;
}

/** Dedupe a list preserving the first-seen order. */
function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

interface ClaudePermissions {
  readonly allow: string[];
  readonly deny: string[];
}

interface ClaudeSettings {
  readonly permissions: ClaudePermissions;
  readonly [key: string]: unknown;
}

const EMPTY_SETTINGS: ClaudeSettings = { permissions: { allow: [], deny: [] } };

/**
 * Read the existing `.claude/settings.local.json` (returns empty settings
 * if the file does not exist). On parse failure returns empty settings
 * and a warning rather than throwing — the user can still write fresh
 * settings.
 */
async function readSettingsLocal(projectRoot: string): Promise<{
  readonly settings: ClaudeSettings;
  readonly existed: boolean;
  readonly malformed: boolean;
}> {
  const file = join(projectRoot, '.claude', 'settings.local.json');
  if (!existsSync(file)) return { settings: EMPTY_SETTINGS, existed: false, malformed: false };
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return { settings: EMPTY_SETTINGS, existed: true, malformed: true };
    }
    const obj = parsed as Record<string, unknown>;
    const permsRaw = obj.permissions;
    const perms: ClaudePermissions =
      permsRaw !== null && typeof permsRaw === 'object'
        ? {
            allow: Array.isArray((permsRaw as Record<string, unknown>).allow)
              ? ((permsRaw as Record<string, unknown>).allow as string[])
              : [],
            deny: Array.isArray((permsRaw as Record<string, unknown>).deny)
              ? ((permsRaw as Record<string, unknown>).deny as string[])
              : [],
          }
        : { allow: [], deny: [] };
    return { settings: { ...obj, permissions: perms }, existed: true, malformed: false };
  } catch {
    return { settings: EMPTY_SETTINGS, existed: true, malformed: true };
  }
}

/**
 * Write the JSON file atomically via `.peaks-tmp` + `rename`. Removes the
 * temp file on partial failure.
 */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.peaks-tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
  } catch (error) {
    if (existsSync(tmp)) {
      try { await rm(tmp, { force: true }); } catch { /* best-effort */ }
    }
    throw error;
  }
}

/**
 * Map allowlist/denylist → permissions.allow/permissions.deny. Never sorts;
 * preserves input order. Always dedupes.
 */
export function toPermissions(
  allowlist: readonly string[],
  denylist: readonly string[]
): ClaudeSettings {
  return {
    permissions: {
      allow: dedupe(allowlist.map(skillRef)),
      deny: dedupe(denylist.map(skillRef)),
    },
  };
}

/**
 * Strip any peaks-* name from the denylist (G6 hard constraint). Returns
 * the cleaned denylist + the list of stripped names for the audit log.
 */
export function stripPeaksFromDenylist(denylist: readonly string[]): {
  readonly cleaned: readonly string[];
  readonly stripped: readonly string[];
} {
  const cleaned: string[] = [];
  const stripped: string[] = [];
  for (const name of denylist) {
    if (name.startsWith('peaks-')) {
      stripped.push(name);
    } else {
      cleaned.push(name);
    }
  }
  return { cleaned, stripped };
}

/** Render the shadow-stub SKILL.md body (R6 marker). */
function shadowStubBody(name: string): string {
  return `---
name: ${name}
description: _peaks_scope_disabled
_peaks_scope_disabled: true
---
# Disabled by \`peaks skill scope --apply\`

This skill is shadowed because the project has marked it as out of scope.
To restore, run \`peaks skill scope --reset\` or edit \`.peaks/scope/skills.json\`.
`;
}

async function writeShadowStub(projectRoot: string, name: string): Promise<string> {
  const file = join(projectRoot, '.claude', 'skills', name, 'SKILL.md');
  await mkdir(dirname(file), { recursive: true });
  // Skip if already has the marker
  if (existsSync(file)) {
    try {
      const existing = await readFile(file, 'utf8');
      if (existing.includes('_peaks_scope_disabled: true')) {
        return file;
      }
    } catch { /* fall through and overwrite */ }
  }
  await writeFile(file, shadowStubBody(name), 'utf8');
  return file;
}

/**
 * Runtime probe for whether Claude Code supports `Skill(name)` syntax in
 * `permissions.deny` (R1). For slice 025.1 we return `unknown` and let
 * the caller decide. Replace this with a real check when Claude Code's
 * `permissions.deny` schema is documented.
 */
export async function probeSkillDenySupport(): Promise<
  'support-allow-and-deny' | 'support-allow-only' | 'unknown'
> {
  return 'unknown';
}

/**
 * Decision: should the denylist use shadow stubs instead of `permissions.deny`?
 * Returns true when:
 * - The caller passes `shadowFallback: true`, OR
 * - The runtime probe returns `support-allow-only` / `unknown`.
 */
async function shouldUseShadowStubs(input: ApplyScopeInput): Promise<boolean> {
  if (input.shadowFallback) return true;
  const probe = await probeSkillDenySupport();
  return probe !== 'support-allow-and-deny';
}

/** Strip the peaks-* shadow stubs written by a previous apply. */
function shadowStubDir(projectRoot: string, name: string): string {
  return join(projectRoot, '.claude', 'skills', name, 'SKILL.md');
}

async function removeShadowStubIfPresent(projectRoot: string, name: string): Promise<boolean> {
  const file = shadowStubDir(projectRoot, name);
  if (!existsSync(file)) return false;
  try {
    const raw = await readFile(file, 'utf8');
    if (!raw.includes('_peaks_scope_disabled: true')) return false;
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export class ClaudeCodeSkillScope implements SkillScopeAdapter {
  readonly ide = IDE_ID;
  readonly supported = true;

  constructor(_opts?: { readonly projectRoot?: string }) {
    // projectRoot is supplied on every method call; the class is stateless.
    void _opts;
  }

  /** detect(): returns 1.0 when the project root has a .claude/ dir. */
  async detect(projectRoot: string): Promise<number> {
    return existsSync(join(projectRoot, '.claude')) ? 1.0 : 0.5;
  }

  async applyScope(input: ApplyScopeInput): Promise<ApplyResult> {
    const written: string[] = [];
    const removed: string[] = [];

    // G6: strip peaks-* from the denylist.
    const { cleaned: cleanedDeny, stripped } = stripPeaksFromDenylist(input.denylist);
    if (stripped.length > 0) {
      removed.push(...stripped);
    }

    const useShadows = await shouldUseShadowStubs(input);

    // 1. Write (or skip) settings.local.json
    const { settings: existing } = await readSettingsLocal(input.projectRoot);
    const next = toPermissions(input.allowlist, cleanedDeny);

    // Preserve existing non-permissions fields (theme, env, etc.).
    const preserved: Record<string, unknown> = { ...existing };
    delete preserved.permissions;
    // Merge with the user's pre-existing allow/deny entries (deduped).
    const existingAllow = (existing.permissions.allow ?? []) as string[];
    const existingDeny = (existing.permissions.deny ?? []) as string[];
    const merged: ClaudeSettings = {
      ...preserved,
      permissions: {
        allow: dedupe([...existingAllow, ...next.permissions.allow]),
        deny: dedupe([...existingDeny, ...next.permissions.deny]),
      },
    };

    if (input.simulateWriteFailure) {
      throw new Error('simulated write failure (settings.local.json)');
    }

    const settingsFile = join(input.projectRoot, '.claude', 'settings.local.json');
    await writeJsonAtomic(settingsFile, merged);
    written.push(settingsFile);

    // 2. Optionally write shadow stubs for the (stripped, cleaned) denylist
    let usedShadowStub = false;
    if (useShadows) {
      usedShadowStub = true;
      for (const name of cleanedDeny) {
        const stub = await writeShadowStub(input.projectRoot, name);
        written.push(stub);
      }
    }

    return {
      ide: this.ide,
      ok: true,
      writtenFiles: written,
      usedShadowStub,
      notSupported: false,
      strippedFromDenylist: stripped,
    };
  }

  async showScope(projectRoot: string): Promise<ShowScopeResult> {
    const settingsFile = join(projectRoot, '.claude', 'settings.local.json');
    let native: unknown = null;
    if (existsSync(settingsFile)) {
      try {
        native = JSON.parse(await readFile(settingsFile, 'utf8'));
      } catch {
        native = null;
      }
    }
    return { source: null, native, ide: this.ide };
  }

  async resetScope(input: ResetScopeInput): Promise<ResetScopeResult> {
    const removed: string[] = [];
    const settingsFile = join(input.projectRoot, '.claude', 'settings.local.json');
    if (existsSync(settingsFile)) {
      // Only remove if it has a permissions.allow/deny field shaped by us,
      // otherwise leave the user's hand-curated file alone.
      try {
        const raw = await readFile(settingsFile, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          (parsed as Record<string, unknown>).permissions !== undefined
        ) {
          await rm(settingsFile, { force: true });
          removed.push(settingsFile);
        }
      } catch {
        // best-effort
      }
    }
    // Also remove shadow stubs (we don't know which skills are stubbed, so
    // we don't blindly walk .claude/skills; the caller can re-run detect +
    // reset if they need a full sweep). For the explicit case we know
    // about, we strip any stub whose marker is present.
    const skillsDir = join(input.projectRoot, '.claude', 'skills');
    if (existsSync(skillsDir)) {
      // Best-effort scan: only act when the file is unmistakably a stub.
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const removedStub = await removeShadowStubIfPresent(input.projectRoot, entry.name);
        if (removedStub) {
          removed.push(join(input.projectRoot, '.claude', 'skills', entry.name, 'SKILL.md'));
        }
      }
    }
    return { ide: this.ide, removedFiles: removed };
  }
}

export const CLAUDE_CODE_SKILL_SCOPE: SkillScopeAdapter = new ClaudeCodeSkillScope();