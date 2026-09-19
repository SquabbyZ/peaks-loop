// tests/unit/services/workspace/generated-artifacts-stamp.test.ts
//
// S6 (2026-09-15) — G4: generated artifacts carry a version stamp, and
// "behind the installed peaks-loop" is a DECIDABLE question.
//
// The defect this closes (diagnosis D1): `initWorkspace` is the only writer of
// a consumer project's generated config, and `ensureSession` early-returns
// once a session is bound — so after the first init nothing ever re-runs the
// generator. `npm i -g peaks-loop@<newer>` upgrades the CLI and leaves the
// project's `.claude/settings.local.json` exactly as the old release wrote it,
// with no signal anywhere. The user's own workaround was to delete
// `.claude/*.json` and restart.
//
// The load-bearing test here is "a stamp written by an older release is
// reported stale": the brief's required verification is a FORGED OLD STAMP
// that the detector flags. `writeGeneratedArtifactsStamp(root, {
// packageVersion })` is the forge — it uses the same writer the generator
// uses, so the test cannot pass by agreeing with a hand-rolled byte shape.
//
// Dimensions covered:
//   - behavior:    stale / not-stale branch per reason code
//   - integration: real `initWorkspace` against a real tmp project tree
//   - render:      OMITTED — the service returns a typed object; the
//                  human-visible surface is `peaks skill presence` (covered by
//                  tests/unit/cli/skill-presence-generated-config-drift.test.ts)
//   - a11y:        OMITTED — no human-facing text in this module

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from 'peaks-loop-shared/version';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { TEMPLATE_VERSION } from '../../../../src/services/workspace/claude-settings-template.js';
import {
  detectStaleGeneratedArtifacts,
  generatedArtifactsStampPath,
  readGeneratedArtifactsStamp,
  writeGeneratedArtifactsStamp
} from '../../../../src/services/workspace/generated-artifacts-stamp.js';
import { initWorkspace } from '../../../../src/services/workspace/workspace-service.js';

declareDimensions(
  'tests/unit/services/workspace/generated-artifacts-stamp.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'service returns a typed object; the human-visible surface is `peaks skill presence`, covered by its own CLI test'
    },
    { dim: 'a11y', reason: 'no human-facing text in this module' }
  ]
);

const SESSION_ID = '2026-09-15-session-abcdef';
const getWs = withTmpWorkspacePerTest('peaks-stamp-');

/** Materialize a project the way `peaks workspace init` does. */
async function initProject(projectRoot: string): Promise<void> {
  await initWorkspace({ projectRoot, sessionId: SESSION_ID });
}

/** Write the stamp file verbatim — the only way to forge a foreign shape. */
function writeRawStamp(projectRoot: string, raw: string): void {
  const stampPath = generatedArtifactsStampPath(projectRoot);
  mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(stampPath, raw, 'utf8');
}

describe('Scenario: generated-artifact version stamp', () => {
  it('initWorkspace stamps the project with this release and the current template shape', async () => {
    const ws = getWs();
    await initProject(ws.path);

    const stamp = readGeneratedArtifactsStamp(ws.path);
    expect(stamp).not.toBeNull();
    expect(stamp?.packageVersion).toBe(CLI_VERSION);
    expect(stamp?.templateVersion).toBe(TEMPLATE_VERSION);
    // A freshly generated project is by definition not behind.
    expect(detectStaleGeneratedArtifacts(ws.path)).toMatchObject({ stale: false, reasons: [] });
  });

  it('a stamp left behind by an OLDER release is reported stale (package-upgraded)', async () => {
    const ws = getWs();
    await initProject(ws.path);

    // Forge what `npm i -g peaks-loop@4.0.40` would have left on disk. This is
    // the verification the brief asks for: an old version stamp must trip the
    // detector. It cannot pass by accident — CLI_VERSION is not '4.0.40'.
    writeGeneratedArtifactsStamp(ws.path, {
      packageVersion: '4.0.40',
      now: new Date('2026-09-01T00:00:00.000Z')
    });

    const staleness = detectStaleGeneratedArtifacts(ws.path);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons).toContain('package-upgraded');
    expect(staleness.onDisk?.packageVersion).toBe('4.0.40');
    expect(staleness.expected.packageVersion).toBe(CLI_VERSION);
    expect(staleness.onDisk?.writtenAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('a stamp from an older TEMPLATE shape is reported stale (template-changed)', async () => {
    const ws = getWs();
    await initProject(ws.path);
    writeRawStamp(
      ws.path,
      JSON.stringify({
        stampVersion: 1,
        packageVersion: CLI_VERSION,
        templateVersion: '0.0.1-does-not-exist',
        writtenAt: '2026-09-01T00:00:00.000Z'
      })
    );

    const staleness = detectStaleGeneratedArtifacts(ws.path);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons).toEqual(['template-changed']);
    expect(staleness.expected.templateVersion).toBe(TEMPLATE_VERSION);
  });

  it('generated artifacts with NO stamp are reported stale (unstamped) — the population that reported the defect', async () => {
    const ws = getWs();
    mkdirSync(join(ws.path, '.claude'), { recursive: true });
    writeFileSync(join(ws.path, '.claude', 'settings.local.json'), '{}\n', 'utf8');

    expect(readGeneratedArtifactsStamp(ws.path)).toBeNull();
    const staleness = detectStaleGeneratedArtifacts(ws.path);
    expect(staleness.stale).toBe(true);
    expect(staleness.reasons).toEqual(['unstamped']);
    expect(staleness.onDisk).toBeNull();
  });

  it('a stamp file that is not parseable is reported stale (stamp-unreadable), never a crash', async () => {
    const ws = getWs();
    await initProject(ws.path);
    writeRawStamp(ws.path, '{ not json');

    expect(readGeneratedArtifactsStamp(ws.path)).toBeNull();
    expect(detectStaleGeneratedArtifacts(ws.path).reasons).toEqual(['stamp-unreadable']);
  });

  it('a project with no generated artifact at all is NOT stale (never initialized is not "behind")', () => {
    const ws = getWs();
    expect(existsSync(join(ws.path, '.claude'))).toBe(false);

    const staleness = detectStaleGeneratedArtifacts(ws.path);
    expect(staleness.stale).toBe(false);
    expect(staleness.reasons).toEqual([]);
  });

  it('re-running init is idempotent — the stamp stays current and the detector stays quiet', async () => {
    const ws = getWs();
    await initProject(ws.path);
    const first = readGeneratedArtifactsStamp(ws.path);
    await initProject(ws.path);
    const second = readGeneratedArtifactsStamp(ws.path);

    expect(second?.packageVersion).toBe(first?.packageVersion);
    expect(second?.templateVersion).toBe(first?.templateVersion);
    expect(detectStaleGeneratedArtifacts(ws.path).stale).toBe(false);
  });

  it('the stamp is the only thing that became decidable — the detector does NOT read the artifact content', async () => {
    const ws = getWs();
    await initProject(ws.path);
    // Hand-edit the generated settings file: a user's own change is NOT this
    // detector's question. It answers "when did a release last regenerate
    // this project", not "do the bytes still match the template" — that is
    // `templateContentMatches`'s question, asked on the next init.
    writeFileSync(
      join(ws.path, '.claude', 'settings.local.json'),
      '{"theme":"hand-edited"}\n',
      'utf8'
    );
    expect(detectStaleGeneratedArtifacts(ws.path).stale).toBe(false);
  });
});
