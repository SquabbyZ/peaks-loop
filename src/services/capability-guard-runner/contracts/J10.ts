import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyHookInstall, planHookInstall } from '../../skills/hooks-settings-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';
import { normalizePath } from '../../../shared/path-utils.js';

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * Behavioural probe of "a plan is produced before anything is written, so the
 * diff is reviewable".
 *
 * The previous version listed four hook/IDE files and passed if any of them
 * contained the word "hook", "install", "ide" or "adapter" — `hooks-commands.ts`
 * satisfies that from its own filename.
 *
 * Here `planHookInstall` runs against a fresh tmp project and the settings file
 * must NOT appear; `applyHookInstall` then writes it, and a second apply must
 * be a no-op that does not duplicate the entry.
 */
export async function runJ10Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J10-'));
  try {
    const plan = planHookInstall('project', root);
    const settingsPath = plan.settingsPath;
    const plannedInsideProject = normalizePath(settingsPath).startsWith(normalizePath(root));
    const planIsReadOnly = !existsSync(settingsPath);
    const freshProjectNotInstalled = plan.exists === false && plan.alreadyInstalled === false;

    // Each managed hook entry is identified by its own sentinel; every one of
    // them must land exactly once and stay at one across a re-apply.
    const sentinels = plan.entryTargets.filter((t) => t.settingsPath === settingsPath).map((t) => t.sentinel);
    const countsNow = (): ReadonlyArray<number> =>
      existsSync(settingsPath) ? sentinels.map((s) => countOccurrences(readFileSync(settingsPath, 'utf8'), s)) : [];

    const first = applyHookInstall('project', root);
    const fileWritten = existsSync(settingsPath);
    const installedCounts = countsNow();
    const sentinelCount = installedCounts.length > 0 ? installedCounts[0]! : -1;

    const second = applyHookInstall('project', root);
    const afterSecondApply = countsNow().length > 0 ? countsNow()[0]! : -1;
    const planAfterApply = planHookInstall('project', root);

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(plannedInsideProject, `the plan targets a settings file inside the project (${settingsPath})`),
      probe(freshProjectNotInstalled, 'a fresh project reports exists=false / alreadyInstalled=false'),
      probe(planIsReadOnly, 'planning does not create the settings file — the diff is reviewable first'),
      probe(first.applied === true, 'apply reports applied=true'),
      probe(fileWritten, 'apply writes the settings file'),
      probe(sentinels.length > 0, `the plan enumerates managed hook entries (${String(sentinels.length)})`),
      probe(
        installedCounts.length > 0 && installedCounts.every((c) => c === 1),
        `apply installs every managed entry exactly once (counts=${installedCounts.join(',') || 'none'})`
      ),
      probe(second.applied === false, `a second apply is a no-op (applied=${String(second.applied)}, first sentinel count=${String(sentinelCount)})`),
      probe(
        afterSecondApply === 1,
        `a duplicate apply does not duplicate the entry (count=${String(afterSecondApply)})`
      ),
      probe(planAfterApply.alreadyInstalled === true, 'the plan reports alreadyInstalled=true after a successful apply')
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/skills/hooks-settings-service.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'planHookInstall() produces a reviewable plan before applyHookInstall() writes, and re-applying is a no-op',
      result.detail,
      'J10 invariant broken: hook install is no longer plan-then-apply, or is not idempotent'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
