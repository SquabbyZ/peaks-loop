/**
 * peaks upgrade --to 2.0 — umbrella service for the 1.x → 2.0
 * migration.
 *
 * Per the "one-key completion" + "minimal-user-operation" tenets
 * (2026-06-11), the typical upgrade path is:
 *
 *   $ npm i -g peaks-cli@2.0   # postinstall does everything
 *
 * OR (postinstall skipped / manual fallback):
 *
 *   $ peaks upgrade --to 2.0
 *
 * The umbrella orchestrates 7 sub-commands:
 *   1. config migrate       (already ships as `peaks config migrate`)
 *   2. standards migrate    (`peaks standards migrate --from-claude-rules`)
 *   3. memory extract       (already ships as `peaks memory extract`)
 *   4. hooks install        (already ships as `peaks hooks install`)
 *   5. skill sync           (this session, `peaks skill sync --all`)
 *   6. audit verify         (already ships as `peaks audit red-lines`)
 *   7. write upgrade record (in-process, .peaks/memory/upgrade-2.0-*.md)
 *
 * Each sub-step is a thin shell-out to the existing CLI; the
 * umbrella's only in-process work is the audit and the upgrade
 * record write. Sub-step failures are SOFT (logged + nextActions
 * populated) so the umbrella never blocks a successful partial
 * upgrade.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRedLinesAudit } from '../audit/red-lines-service.js';
import { savePreferences } from '../preferences/preferences-service.js';
import { migrateGitignoreFile } from './gitignore-migrate-service.js';

export interface UpgradeInput {
  readonly projectRoot: string;
  /**
   * When true, the umbrella is being invoked from the
   * `npm i -g peaks-cli` postinstall. Suppresses the
   * interactive prompts and accepts soft-fail on any
   * sub-step.
   */
  readonly auto?: boolean;
  /**
   * When omitted, the sub-commands are inferred from PATH
   * (the postinstall puts the binary there). The umbrella
   * never blocks on a missing binary — it surfaces the
   * install hint in `nextActions` instead.
   */
  readonly peaksBin?: string;
}

export interface SubStepResult {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'skipped';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface UpgradeResult {
  readonly applied: boolean;
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly projectRoot: string;
  readonly steps: readonly SubStepResult[];
  readonly passedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly auditBefore: { totalRedLines: number; cliBacked: number } | null;
  readonly auditAfter: { totalRedLines: number; cliBacked: number } | null;
  readonly upgradeRecordPath: string | null;
  readonly nextActions: readonly string[];
  readonly warnings: readonly string[];
}

const STEPS: ReadonlyArray<{ name: string; args: (projectRoot: string) => string[] }> = [
  { name: 'config-migrate', args: (p) => ['config', 'migrate', '--project', p, '--apply', '--json'] },
  { name: 'standards-migrate', args: (p) => ['standards', 'migrate', '--from-claude-rules', '--project', p, '--apply', '--json'] },
  // memory extract is special: its --artifact takes literal file
  // paths (memory-service rejects glob patterns via realpathSync).
  // The umbrella expands the three documented patterns
  // (skills/**/SKILL.md, CLAUDE.md, .claude/rules/**/*.md) on disk
  // and passes the resulting literal list. See runUpgrade's special
  // case below for the args resolution; the args function here is
  // a placeholder so the STEPS table stays uniform.
  { name: 'memory-extract', args: (p) => ['memory', 'extract', '--project', p, '--json'] },
  { name: 'hooks-install', args: (p) => ['hooks', 'install', '--project', p, '--json'] },
  { name: 'skill-sync', args: (p) => ['skill', 'sync', '--all', '--project', p, '--json'] },
  { name: 'audit-verify', args: (p) => ['audit', 'red-lines', '--project', p, '--json'] },
];

/**
 * Walk `<root>` recursively and collect every file whose basename
 * matches `predicate`. Returns absolute paths.
 *
 * Mirrors `readMarkdownFilesRecursive` in
 * src/services/standards/migrate-claude-rules-service.ts so the
 * umbrella does not pull a new glob dependency (Node 20+ engine
 * constraint — `fs.globSync` requires Node 22+).
 */
function collectFilesRecursive(
  root: string,
  predicate: (basename: string) => boolean
): readonly string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) {
    return predicate(root.split(/[\\/]/).pop() ?? '') ? [root] : [];
  }
  if (!stat.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const child = join(root, entry);
    let childStat;
    try {
      childStat = statSync(child);
    } catch {
      continue;
    }
    if (childStat.isFile()) {
      if (predicate(entry)) out.push(child);
    } else if (childStat.isDirectory()) {
      out.push(...collectFilesRecursive(child, predicate));
    }
  }
  return out;
}

/**
 * Resolve the three documented memory-extract artifact patterns
 * against a real project tree. Returns project-relative paths
 * (memory-service joins them with --project root) so the
 * realpathSync inside memory-service's assertInsideProject
 * succeeds.
 *
 * Patterns:
 *   - skills/[asterisk][asterisk]/SKILL.md       (project-root convention)
 *   - .claude/skills/[asterisk][asterisk]/SKILL.md (Claude-Code consumer convention; ice-cola)
 *   - CLAUDE.md
 *   - .claude/rules/[asterisk][asterisk]/[asterisk].md
 *
 * Returns an empty list when none of the roots exist. The
 * caller marks the step skipped in that case.
 */
function expandMemoryArtifacts(projectRoot: string): readonly string[] {
  const out: string[] = [];

  // skills/**/SKILL.md (peaks-cli repo convention)
  const skillFiles = collectFilesRecursive(
    join(projectRoot, 'skills'),
    (name) => name === 'SKILL.md'
  );
  for (const abs of skillFiles) {
    out.push(relative(projectRoot, abs));
  }

  // .claude/skills/**/SKILL.md (Claude-Code consumer convention;
  // surfaced by ice-cola dogfood 2026-06-12 — the 1.x install
  // landed skills under .claude/skills/, not <root>/skills/)
  const claudeSkillFiles = collectFilesRecursive(
    join(projectRoot, '.claude', 'skills'),
    (name) => name === 'SKILL.md'
  );
  for (const abs of claudeSkillFiles) {
    out.push(relative(projectRoot, abs));
  }

  // CLAUDE.md (literal)
  const claudeMd = join(projectRoot, 'CLAUDE.md');
  if (existsSync(claudeMd) && statSync(claudeMd).isFile()) {
    out.push('CLAUDE.md');
  }

  // .claude/rules/**/*.md
  const claudeRules = collectFilesRecursive(
    join(projectRoot, '.claude', 'rules'),
    (name) => name.endsWith('.md')
  );
  for (const abs of claudeRules) {
    out.push(relative(projectRoot, abs));
  }

  return out;
}

function read1xVersion(cwd: string): string | null {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  if (home.length === 0) return null;
  const global = join(home, '.peaks', 'config.json');
  if (!existsSync(global)) return null;
  try {
    const raw = JSON.parse(readFileSync(global, 'utf8')) as Record<string, unknown>;
    if (typeof raw.version === 'string') return raw.version;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // ignore
  }
  return null;
}

function runStep(
  peaksBin: string,
  name: string,
  args: readonly string[],
  timeoutMs: number = 60_000
): SubStepResult {
  const start = Date.now();
  // The global `peaks` shim is a `/bin/sh` symlink script (the
  // npm install postinstall creates `peaks` → `peaks.sh` on
  // Windows). cmd.exe (the default Windows shell) cannot run
  // `.sh` scripts directly, so the shim fails with "unknown
  // command 'migrate'" etc. The fix: prefer the local node
  // binary + the peaks.js script path. The umbrella resolves
  // the script path at startup; only falls back to `peaks` if
  // no script path is available (Unix-only).
  let command: string;
  let spawnArgs: readonly string[];
  if (peaksBin.includes('\\') || peaksBin.includes('/')) {
    // peaksBin is a real path (e.g. /c/.../bin/peaks.js);
    // invoke directly via node.
    command = process.execPath;
    spawnArgs = [peaksBin, ...args];
  } else {
    // peaksBin is just "peaks" — best-effort shell exec.
    command = peaksBin;
    spawnArgs = args;
  }
  try {
    const result = spawnSync(command, spawnArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    return {
      name,
      status: result.status === 0 ? 'pass' : 'fail',
      exitCode: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: 'fail',
      exitCode: null,
      stdout: '',
      stderr: message,
      durationMs: Date.now() - start,
    };
  }
}

function writeUpgradeRecord(
  projectRoot: string,
  result: UpgradeResult
): string | null {
  try {
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = join(memoryDir, `upgrade-2.0-${date}.md`);
    const lines: string[] = [];
    lines.push(`# Upgrade to peaks-cli 2.0 — ${date}`);
    lines.push('');
    lines.push(`> Auto-generated by \`peaks upgrade --to 2.0${result.applied ? ' --auto' : ''}\`.`);
    lines.push(`> Per the "one-key completion" + "minimal-user-operation" tenets.`);
    lines.push('');
    if (result.fromVersion !== null) {
      lines.push(`**From version**: ${result.fromVersion}`);
    }
    lines.push(`**To version**: 2.0.0`);
    lines.push(`**Project root**: \`${result.projectRoot}\``);
    lines.push('');
    lines.push('## Sub-step results');
    lines.push('');
    lines.push('| step | status | exitCode | durationMs |');
    lines.push('|------|--------|----------|------------|');
    for (const step of result.steps) {
      lines.push(`| ${step.name} | ${step.status} | ${step.exitCode ?? 'n/a'} | ${step.durationMs} |`);
    }
    lines.push('');
    if (result.auditBefore !== null || result.auditAfter !== null) {
      lines.push('## Audit snapshot');
      lines.push('');
      if (result.auditBefore !== null) {
        lines.push(`- Before: totalRedLines=${result.auditBefore.totalRedLines}, cliBacked=${result.auditBefore.cliBacked}`);
      }
      if (result.auditAfter !== null) {
        lines.push(`- After:  totalRedLines=${result.auditAfter.totalRedLines}, cliBacked=${result.auditAfter.cliBacked}`);
      }
      lines.push('');
    }
    lines.push('## Next actions');
    lines.push('');
    for (const a of result.nextActions) {
      lines.push(`- ${a}`);
    }
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    return file;
  } catch (err) {
    process.stderr.write(
      `peaks upgrade: failed to write upgrade record: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return null;
  }
}

export function runUpgrade(input: UpgradeInput): UpgradeResult {
  // Resolve the peaks binary. Default: the peaks.js script
  // co-located with this compiled module (the user just installed
  // peaks-cli globally, but the global `peaks` shim is a .sh
  // script that cmd.exe can't run on Windows). Falling back
  // to just "peaks" lets the umbrella work when invoked from
  // a Unix-style environment that can run the shim directly.
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up from the compiled location to find bin/peaks.js.
  // The compiled service lives at dist/src/services/upgrade/upgrade-service.js;
  // bin/peaks.js is at the peaks-cli root.
  const peaksBin =
    input.peaksBin ??
    resolve(here, '..', '..', '..', '..', 'bin', 'peaks.js');
  const fallbackPeaks = 'peaks';
  const resolvedPeaksBin = existsSync(peaksBin) ? peaksBin : fallbackPeaks;

  const fromVersion = read1xVersion(input.projectRoot);
  const steps: SubStepResult[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];

  // Ensure .peaks/preferences.json exists. This is the file the
  // 1.x detector keys off — without it, `peaks upgrade --detect-1x`
  // keeps returning isOneX=true after a successful upgrade and the
  // user gets stuck in a re-prompt loop. savePreferences with an
  // empty override merges with DEFAULT_PREFERENCES and writes; if
  // the file already exists the user's values are preserved.
  // Real bug surfaced by ice-cola dogfood 2026-06-12.
  try {
    savePreferences(input.projectRoot, {});
  } catch (err) {
    warnings.push(
      `ensure-preferences failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Migrate .gitignore so 2.0 tracked artifacts
  // (.peaks/standards/, .peaks/memory/*.md durable memories,
  // .peaks/PROJECT.md) aren't silently hidden by a 1.x wholesale
  // `/.peaks/` ignore rule. Real bug surfaced by ice-cola dogfood
  // 2026-06-12: every consumer artifact was being dropped from git
  // status. Service is idempotent + creates a timestamped backup
  // before any write.
  try {
    const giResult = migrateGitignoreFile({ projectRoot: input.projectRoot, apply: true });
    if (giResult.changed && giResult.appliedWrite && giResult.backupPath !== null) {
      nextActions.push(
        `Updated .gitignore — removed stale wholesale .peaks rule(s): ${giResult.removedRules.join(', ')}. Backup at ${giResult.backupPath}.`
      );
    } else if (giResult.missing) {
      warnings.push('gitignore-migrate skipped: project has no .gitignore');
    }
  } catch (err) {
    warnings.push(
      `gitignore-migrate failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Audit BEFORE the upgrade (baseline)
  let auditBefore: { totalRedLines: number; cliBacked: number } | null = null;
  try {
    const r = runRedLinesAudit({ projectRoot: input.projectRoot });
    auditBefore = { totalRedLines: r.audit.totalRedLines, cliBacked: r.audit.cliBacked };
  } catch (err) {
    warnings.push(
      `audit-before failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Run the 6 sub-steps
  for (const step of STEPS) {
    if (step.name === 'memory-extract') {
      // Special case: expand the three glob patterns to literal
      // paths before spawning. memory-service rejects literal
      // '**' in artifact paths (assertInsideProject's realpathSync
      // throws ENOENT) and refuses to run without --artifact.
      const artifacts = expandMemoryArtifacts(input.projectRoot);
      if (artifacts.length === 0) {
        steps.push({
          name: 'memory-extract',
          status: 'skipped',
          exitCode: null,
          stdout: '',
          stderr: 'no skills/, CLAUDE.md, or .claude/rules/ artifacts found in the project',
          durationMs: 0,
        });
        continue;
      }
      const args = ['memory', 'extract', '--project', input.projectRoot, '--artifact', ...artifacts, '--apply', '--json'];
      const r = runStep(resolvedPeaksBin, 'memory-extract', args);
      steps.push(r);
      if (r.status === 'fail') {
        warnings.push(`memory-extract failed: ${r.stderr.slice(0, 200)}`);
      }
      continue;
    }
    const args = step.args(input.projectRoot);
    const r = runStep(resolvedPeaksBin, step.name, args);
    steps.push(r);
    if (r.status === 'fail') {
      warnings.push(`${step.name} failed: ${r.stderr.slice(0, 200)}`);
    }
  }

  // Audit AFTER the upgrade (verify)
  let auditAfter: { totalRedLines: number; cliBacked: number } | null = null;
  try {
    const r = runRedLinesAudit({ projectRoot: input.projectRoot });
    auditAfter = { totalRedLines: r.audit.totalRedLines, cliBacked: r.audit.cliBacked };
  } catch (err) {
    warnings.push(
      `audit-after failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const passedCount = steps.filter((s) => s.status === 'pass').length;
  const failedCount = steps.filter((s) => s.status === 'fail').length;
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const applied = failedCount === 0;

  if (failedCount > 0) {
    nextActions.push(
      `${failedCount} sub-step(s) failed. Run \`peaks upgrade --to 2.0\` again to retry the failed steps.`
    );
  }
  if (input.auto !== true) {
    nextActions.push('Run `peaks audit red-lines --project .` to verify the L2 catalog is healthy.');
  }
  nextActions.push('See `docs/UPGRADING-2.0.md` for the manual fallback if this auto-upgrade fails.');

  // Write the upgrade record (always, even on partial failure —
  // the user gets a forensic artifact either way)
  const partial: UpgradeResult = {
    applied,
    fromVersion,
    toVersion: '2.0.0',
    projectRoot: input.projectRoot,
    steps,
    passedCount,
    failedCount,
    skippedCount,
    auditBefore,
    auditAfter,
    upgradeRecordPath: null,
    nextActions,
    warnings,
  };
  const upgradeRecordPath = writeUpgradeRecord(input.projectRoot, partial);
  return { ...partial, upgradeRecordPath };
}
