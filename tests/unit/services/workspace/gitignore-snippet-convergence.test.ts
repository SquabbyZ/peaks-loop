// tests/unit/services/workspace/gitignore-snippet-convergence.test.ts
//
// S6 (2026-09-15) — D2: the managed `.gitignore` snippet is CONVERGED, not just
// appended.
//
// THE DEFECT (diagnosis 3.17): `upsertPeaksGitignoreSnippet` returned early the
// moment it saw the header line, so the block was written exactly once — by
// whichever release first initialized the project — and never updated. A
// pattern added to the snippet by a later release therefore reached only
// projects that had NOT been initialized yet, i.e. new users got the fix and
// existing users did not.
//
// The contract the fix has to keep is the one the early-return was protecting:
// a user's own lines must survive byte-for-byte. So every case below asserts
// the user's lines are intact AND the managed block is current — the two
// halves together, never one alone.
//
// Dimensions covered:
//   - behavior:    converge / no-op / refuse-to-guess branches
//   - integration: real `materializeClaudeSettingsLocal` against a real tmp tree
//   - render:      OMITTED — no human-visible output in the service
//   - a11y:        OMITTED — no human-facing text in this module

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { materializeClaudeSettingsLocal } from '../../../../src/services/workspace/workspace-service.js';
import {
  PEAKS_GITIGNORE_FOOTER as FOOTER,
  PEAKS_GITIGNORE_HEADER as HEADER
} from '../../../../src/services/workspace/workspace-claude-settings-materializer.js';

declareDimensions(
  'tests/unit/services/workspace/gitignore-snippet-convergence.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no human-visible output in the service' },
    { dim: 'a11y', reason: 'no human-facing text in this module' }
  ]
);

const USER_LINES = ['node_modules/', 'dist/', '# my own note'];

const getWs = withTmpWorkspacePerTest('peaks-gitignore-');

function readGitignore(root: string): string {
  return readFileSync(join(root, '.gitignore'), 'utf8');
}

/**
 * Materialize the way a normal `peaks workspace init` does.
 *
 * `noClaudeHooks` must be `false`: the snippet upsert sits AFTER the
 * `if (noClaudeHooks) return …` early exit, so `--no-claude-hooks` never
 * reaches it.
 */
async function materialize(root: string): Promise<void> {
  await materializeClaudeSettingsLocal(root, false);
}

describe('Scenario: behavior — managed .gitignore snippet converges', () => {
  it('a fresh project gets the block appended below the user lines', async () => {
    const ws = getWs();
    writeFileSync(join(ws.path, '.gitignore'), `${USER_LINES.join('\n')}\n`, 'utf8');

    await materialize(ws.path);

    const body = readGitignore(ws.path);
    for (const line of USER_LINES) expect(body).toContain(line);
    expect(body).toContain('.claude/settings.local.json');
    expect(body).toContain('.peaks/.claude-settings-template.json');
    expect(body.indexOf('.claude/settings.local.json')).toBeGreaterThan(
      body.indexOf('node_modules/')
    );
  });

  it('a block left by an OLDER release is replaced by the current one (the defect)', async () => {
    const ws = getWs();
    // Exactly what an older release wrote: same header/footer, an older body
    // that is missing the pattern this release added.
    const legacyBlock = [
      HEADER,
      '# Consumer-project .claude/settings.local.json: written by `peaks workspace init`',
      '.claude/settings.local.json',
      FOOTER
    ].join('\n');
    writeFileSync(
      join(ws.path, '.gitignore'),
      `${USER_LINES.join('\n')}\n\n${legacyBlock}\n`,
      'utf8'
    );

    await materialize(ws.path);

    const body = readGitignore(ws.path);
    // The newer pattern propagated…
    expect(body).toContain('.peaks/.claude-settings-template.json');
    // …and the user's lines did not move or change.
    for (const line of USER_LINES) expect(body).toContain(line);
    expect(body.split('\n').filter((l) => l === '.claude/settings.local.json')).toHaveLength(1);
  });

  it('user lines ABOVE and BELOW the block both survive a convergence', async () => {
    const ws = getWs();
    const below = ['# trailing user section', 'scratch/'];
    const legacyBlock = [HEADER, '.claude/settings.local.json', FOOTER].join('\n');
    writeFileSync(
      join(ws.path, '.gitignore'),
      `${USER_LINES.join('\n')}\n\n${legacyBlock}\n\n${below.join('\n')}\n`,
      'utf8'
    );

    await materialize(ws.path);

    const body = readGitignore(ws.path);
    for (const line of [...USER_LINES, ...below]) expect(body).toContain(line);
    expect(body.indexOf('scratch/')).toBeGreaterThan(body.indexOf(FOOTER));
    expect(body).toContain('.peaks/.claude-settings-template.json');
  });

  it('an already-current block is left byte-for-byte alone (no rewrite churn)', async () => {
    const ws = getWs();
    writeFileSync(join(ws.path, '.gitignore'), `${USER_LINES.join('\n')}\n`, 'utf8');
    await materialize(ws.path);
    const afterFirst = readGitignore(ws.path);

    await materialize(ws.path);

    expect(readGitignore(ws.path)).toBe(afterFirst);
  });

  it('a MALFORMED block (header, no footer) is left untouched rather than guessed at', async () => {
    const ws = getWs();
    const malformed = `${USER_LINES.join('\n')}\n\n${HEADER}\n.claude/settings.local.json\n`;
    writeFileSync(join(ws.path, '.gitignore'), malformed, 'utf8');

    await materialize(ws.path);

    // The function refuses to open a block it cannot close, exactly as
    // `stripLegacyPeaksGitignoreSnippet` already did — deleting a user's file
    // to tidy our own mess is not a trade worth making.
    expect(readGitignore(ws.path)).toBe(malformed);
    expect(existsSync(join(ws.path, '.gitignore'))).toBe(true);
  });
});
