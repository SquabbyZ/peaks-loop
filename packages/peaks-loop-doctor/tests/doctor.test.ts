import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  isWorkspaceInitializedAt,
  runDoctor
} from '../src/services/doctor/doctor-service.js';

describe('runDoctor', () => {
  test('passes the repository skeleton with required skills and schemas', async () => {
    // Isolate from real workspace state so this assertion is not coupled
    // to whatever orphan sessions or stale skill-presence happen to be on
    // the test runner's disk. The test asserts the skeleton contract —
    // required skills + schemas — not the repo's runtime hygiene.
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      // Inject a passing workspace-layout probe so the live check
      // (which would otherwise fail against the real repo because the
      // c4c553 top-level session dir is still present as the current
      // binding from F3) doesn't incidentally flip the skeleton
      // summary. This test asserts "skeleton has required skills and
      // schemas", not "the repo is canonical".
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      // Point the L3:l3-orphan-sessions and L3:l3-memory-health checks at
      // a fresh empty dir so the real .peaks/_runtime/ orphan sessions
      // (e.g. heartbeat-test fixtures left behind by other test files)
      // don't flip the skeleton summary to red.
      l3ProjectRoot: await mkdtemp(join(tmpdir(), 'peaks-doctor-skeleton-')),
      // Inject a null skill presence so the freshness check does not
      // age out against a presence file older than the 24h threshold.
      skillPresenceProbe: () => null
    });

    expect(report.summary.ok).toBe(true);
    expect(report.checks.some((check) => check.id === 'skill:peaks-code' && check.ok)).toBe(true);
    expect(report.checks.some((check) => check.id === 'schema:refactor-slice-spec.schema.json' && check.ok)).toBe(true);
  });

  test('reports invalid skills without aborting doctor checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-skills-'));
    await mkdir(join(root, 'peaks-code'));
    await mkdir(join(root, 'broken-skill'));
    await writeFile(join(root, 'peaks-code', 'SKILL.md'), `---\nname: peaks-code\ndescription: Required skill\n---\n# Skill\n`);
    await writeFile(join(root, 'broken-skill', 'SKILL.md'), `---\nname: broken-skill\n---\n# Broken\n`);

    const report = await runDoctor({ skillsBaseDir: root });

    expect(report.summary.ok).toBe(false);
    expect(report.checks.some((check) => check.id === 'skill-parse:broken-skill' && !check.ok)).toBe(true);
    expect(report.checks.some((check) => check.id === 'schema:refactor-slice-spec.schema.json')).toBe(true);
  });

  test('reports invalid schemas without undefined error messages', async () => {
    const schemasRoot = await mkdtemp(join(tmpdir(), 'peaks-doctor-schemas-'));
    await writeFile(join(schemasRoot, 'artifact-manifest.schema.json'), '{');

    const report = await runDoctor({ schemasBaseDir: schemasRoot });
    const check = report.checks.find((item) => item.id === 'schema:artifact-manifest.schema.json');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('Schema artifact-manifest.schema.json is missing or invalid:');
    expect(check?.message).not.toContain('undefined');
  });
});

describe('runDoctor skill runbook completeness', () => {
  test('reports each required skill declares a Default runbook', async () => {
    const report = await runDoctor();

    for (const name of ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt', 'peaks-code']) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: `skill-runbook:${name}`, ok: true })
      );
    }
  });

  test('flags a required skill that is missing its Default runbook section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-runbook-'));
    for (const name of ['peaks-code', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
      await mkdir(join(root, name));
      const body = name === 'peaks-rd'
        ? `---\nname: ${name}\ndescription: ${name} skill\n---\n# Body without runbook\n`
        : `---\nname: ${name}\ndescription: ${name} skill\n---\n# Body\n\n## Default runbook\n\n\`\`\`bash\npeaks doctor --json\n\`\`\`\n`;
      await writeFile(join(root, name, 'SKILL.md'), body);
    }

    const report = await runDoctor({ skillsBaseDir: root });
    const failing = report.checks.find((check) => check.id === 'skill-runbook:peaks-rd');

    expect(failing).toMatchObject({ ok: false });
    expect(failing?.message).toContain('missing a ## Default runbook');
    expect(report.summary.ok).toBe(false);
  });
});

describe('runDoctor skill apply-note completeness', () => {
  test('passes apply-note check for each required skill on the real repo', async () => {
    const report = await runDoctor();

    for (const name of ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt', 'peaks-code']) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: `skill-apply-note:${name}`, ok: true })
      );
    }
  });

  test('flags a required skill whose runbook lists destructive --apply without an authorization note', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-apply-note-'));
    for (const name of ['peaks-code', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
      await mkdir(join(root, name));
      const runbookBody = name === 'peaks-txt'
        ? '```bash\npeaks memory extract --project x --artifact y --apply --json\n```'
        : '```bash\npeaks doctor --json\n```';
      const body = `---\nname: ${name}\ndescription: ${name} skill\n---\n# Body\n\n## Default runbook\n\n${runbookBody}\n`;
      await writeFile(join(root, name, 'SKILL.md'), body);
    }

    const report = await runDoctor({ skillsBaseDir: root });
    const failing = report.checks.find((check) => check.id === 'skill-apply-note:peaks-txt');

    expect(failing).toMatchObject({ ok: false });
    expect(failing?.message).toContain('without an authorization/dry-run note');
    expect(report.summary.ok).toBe(false);
  });

  test('passes apply-note check when destructive --apply commands carry --dry-run guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-apply-note-ok-'));
    for (const name of ['peaks-code', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
      await mkdir(join(root, name));
      const runbookBody = name === 'peaks-txt'
        ? '```bash\npeaks memory extract --project x --artifact y --dry-run --json\npeaks memory extract --project x --artifact y --apply --json\n```\n\nOnly run --apply after explicit user authorization.'
        : '```bash\npeaks doctor --json\n```';
      const body = `---\nname: ${name}\ndescription: ${name} skill\n---\n# Body\n\n## Default runbook\n\n${runbookBody}\n`;
      await writeFile(join(root, name, 'SKILL.md'), body);
    }

    const report = await runDoctor({ skillsBaseDir: root });
    const passing = report.checks.find((check) => check.id === 'skill-apply-note:peaks-txt');

    expect(passing).toMatchObject({ ok: true });
    expect(passing?.message).toContain('destructive --apply command');
  });
});

describe('runDoctor recommendation schemas', () => {
  test('validates recommendation foundation schemas', async () => {
    const report = await runDoctor();

    for (const schemaId of [
      'schema:capability-source.schema.json',
      'schema:capability-item.schema.json',
      'schema:capability-availability.schema.json',
      'schema:recommendation-plan.schema.json'
    ]) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: schemaId, ok: true })
      );
    }
  });
});

describe('doctor-report schema documents the check ID prefixes', () => {
  test('every check ID emitted by runDoctor matches the documented schema pattern', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join: joinPath } = await import('node:path');
    const { schemasDir } = await import('peaks-loop-shared/paths');
    const schema = JSON.parse(await readFile(joinPath(schemasDir, 'doctor-report.schema.json'), 'utf8')) as {
      properties: { checks: { items: { properties: { id: { pattern: string } } } } };
    };
    const idPattern = new RegExp(schema.properties.checks.items.properties.id.pattern);

    const report = await runDoctor();
    for (const check of report.checks) {
      expect(idPattern.test(check.id), `check id ${check.id} does not match documented pattern`).toBe(true);
    }
  });

  test('schema documents skill-apply-note as a known check prefix', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join: joinPath } = await import('node:path');
    const { schemasDir } = await import('peaks-loop-shared/paths');
    const raw = await readFile(joinPath(schemasDir, 'doctor-report.schema.json'), 'utf8');

    expect(raw).toContain('skill-apply-note');
    const schema = JSON.parse(raw) as {
      properties: { checks: { items: { properties: { id: { pattern: string; description: string } } } } };
    };
    expect(schema.properties.checks.items.properties.id.pattern).toContain('skill-apply-note');
    expect(schema.properties.checks.items.properties.id.description).toContain('skill-apply-note');
  });

  test('runDoctor emits a doctor-self:check-id-pattern self-validation check', async () => {
    const report = await runDoctor();
    const selfCheck = report.checks.find((check) => check.id === 'doctor-self:check-id-pattern');

    expect(selfCheck).toMatchObject({ ok: true });
    expect(selfCheck?.message).toContain('match the doctor-report schema pattern');
  });

  test('runDoctor fails the self-validation check when the schema file is missing', async () => {
    const schemasRoot = await mkdtemp(join(tmpdir(), 'peaks-doctor-self-missing-'));

    const report = await runDoctor({ schemasBaseDir: schemasRoot });
    const selfCheck = report.checks.find((check) => check.id === 'doctor-self:check-id-pattern');

    expect(selfCheck).toMatchObject({ ok: false });
    expect(selfCheck?.message).toContain('Failed to load doctor-report.schema.json');
    expect(report.summary.ok).toBe(false);
  });
});

describe('skill runbooks reference their own peaks skill runbook self-check', () => {
  test('every required skill runbook embeds `peaks skill runbook <self> --json`', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join: joinPath } = await import('node:path');
    const { skillsDir, requiredSkillNames } = await import('peaks-loop-shared/paths');

    // After the v2.13.0 bee-demote (commit de0872b), the role skills
    // (peaks-prd, peaks-rd, peaks-qa, peaks-ui, peaks-sc, peaks-txt)
    // moved under `skills/bee/<role>/` while user-facing helpers stayed
    // at `skills/<name>/`. Resolve a skill path walking both layouts.
    async function resolveSkill(suffix: string[]): Promise<string> {
      const candidates = [
        joinPath(skillsDir, ...suffix),
        joinPath(skillsDir, 'bee', ...suffix),
      ];
      for (const candidate of candidates) {
        try {
          await readFile(candidate, 'utf8');
          return candidate;
        } catch {
          // try the next candidate
        }
      }
      // Fall back to the first candidate so callers see a clean ENOENT
      // error pointing at the canonical location.
      return candidates[0]!;
    }

    for (const name of requiredSkillNames) {
      const skillPath = await resolveSkill([name, 'SKILL.md']);
      const body = await readFile(skillPath, 'utf8');
      // The self-check `peaks skill runbook <self> --json` may live in
      // references/runbook.md (or `<role>-runbook.md`, used by skills
      // that extracted the runbook to a sibling reference to keep
      // SKILL.md under the 800-line cap). Try both candidates.
      let haystack = body;
      if (!haystack.includes(`peaks skill runbook ${name} --json`)) {
        const candidates = [
          await resolveSkill([name, 'references', 'runbook.md']),
          await resolveSkill([name, 'references', `${name.replace(/^peaks-/, '')}-runbook.md`])
        ];
        for (const refPath of candidates) {
          try {
            const refBody = await readFile(refPath, 'utf8');
            if (refBody.includes(`peaks skill runbook ${name} --json`)) {
              haystack = refBody;
              break;
            }
          } catch {
            // candidate not present; try the next one
          }
        }
      }
      expect(haystack, `skill ${name} should embed its own runbook self-check (in SKILL.md or references/runbook.md)`).toContain(`peaks skill runbook ${name} --json`);
    }
  });
});

describe('runDoctor skill-presence checks', () => {
  test('skill-presence:current is informational and reports no active skill when probe returns null', async () => {
    const report = await runDoctor({ skillPresenceProbe: () => null });
    const check = report.checks.find((item) => item.id === 'skill-presence:current');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('No active Peaks skill presence');
  });

  test('skill-presence:current surfaces the current skill name, mode, and gate', async () => {
    const setAt = new Date(Date.now() - 60_000).toISOString();
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-rd', mode: 'swarm', gate: 'dry-run', setAt })
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:current');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('peaks-rd');
    expect(check?.message).toContain('swarm');
    expect(check?.message).toContain('dry-run');
    expect(check?.message).toContain(setAt);
  });

  test('skill-presence:freshness passes when no presence file exists', async () => {
    const report = await runDoctor({ skillPresenceProbe: () => null });
    const check = report.checks.find((item) => item.id === 'skill-presence:freshness');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('No active Peaks skill presence to age-check');
  });

  test('skill-presence:freshness passes when setAt is recent', async () => {
    const setAt = new Date(Date.now() - 60_000).toISOString();
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-rd', setAt })
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:freshness');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('fresh');
  });

  test('skill-presence:freshness fails when setAt is older than 24h (default threshold)', async () => {
    const setAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-rd', setAt })
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:freshness');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('stale');
    expect(check?.message).toContain('peaks-rd');
    expect(report.summary.ok).toBe(false);
  });

  test('skill-presence:freshness fails when setAt is unparsable', async () => {
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-rd', setAt: 'not-a-date' })
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:freshness');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('invalid setAt');
    expect(report.summary.ok).toBe(false);
  });
});

describe('runDoctor skill-presence:workspace guard', () => {
  test('fails when a skill is active but no workspace session exists', async () => {
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-code', mode: 'full-auto', gate: 'startup', setAt: new Date().toISOString() }),
      workspaceInitializedProbe: () => false
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:workspace');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('peaks workspace init');
    expect(report.summary.ok).toBe(false);
  });

  test('passes when a skill is active and the workspace session exists', async () => {
    const report = await runDoctor({
      skillPresenceProbe: () => ({ skill: 'peaks-code', setAt: new Date().toISOString() }),
      workspaceInitializedProbe: () => true
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:workspace');

    expect(check).toMatchObject({ ok: true });
  });

  test('is not applicable when no skill is active', async () => {
    const report = await runDoctor({
      skillPresenceProbe: () => null,
      workspaceInitializedProbe: () => false
    });
    const check = report.checks.find((item) => item.id === 'skill-presence:workspace');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('not applicable');
  });
});

describe('isWorkspaceInitializedAt — runtime-layer canonical + legacy back-compat', () => {
  async function emptyProject(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'peaks-doctor-ws-probe-'));
  }

  test('returns false when neither .peaks/_runtime/session.json nor .peaks/.session.json exists', async () => {
    const project = await emptyProject();
    expect(isWorkspaceInitializedAt(project)).toBe(false);
  });

  test('returns true when the canonical .peaks/_runtime/session.json exists (post-runtime-layer migration)', async () => {
    const project = await emptyProject();
    await mkdir(join(project, '.peaks', '_runtime'), { recursive: true });
    await writeFile(join(project, '.peaks', '_runtime', 'session.json'), '{"sessionId":"x"}', 'utf8');
    expect(isWorkspaceInitializedAt(project)).toBe(true);
  });

  test('returns true when the legacy .peaks/.session.json exists (pre-runtime-layer, not yet reconciled)', async () => {
    const project = await emptyProject();
    await mkdir(join(project, '.peaks'), { recursive: true });
    await writeFile(join(project, '.peaks', '.session.json'), '{"sessionId":"x"}', 'utf8');
    expect(isWorkspaceInitializedAt(project)).toBe(true);
  });

  test('returns true when BOTH bindings exist (defensive — runtime layer wins on read, legacy kept for back-compat)', async () => {
    const project = await emptyProject();
    await mkdir(join(project, '.peaks', '_runtime'), { recursive: true });
    await writeFile(join(project, '.peaks', '_runtime', 'session.json'), '{"sessionId":"canonical"}', 'utf8');
    await writeFile(join(project, '.peaks', '.session.json'), '{"sessionId":"legacy"}', 'utf8');
    expect(isWorkspaceInitializedAt(project)).toBe(true);
  });

  test('does not be confused by other .peaks/_runtime/<sid>/session.json files (per-session, not the binding)', async () => {
    // The per-session file at .peaks/_runtime/<sid>/session.json is NOT the binding —
    // it's the session artifact. The probe must NOT treat it as "initialized"
    // or it will give a false positive on projects that have a session
    // subdir but no runtime binding (e.g. a half-reconciled migration).
    const project = await emptyProject();
    await mkdir(join(project, '.peaks', '2026-06-05-session-abc1234'), { recursive: true });
    await writeFile(join(project, '.peaks', '2026-06-05-session-abc1234', 'session.json'), '{"sessionId":"abc1234"}', 'utf8');
    expect(isWorkspaceInitializedAt(project)).toBe(false);
  });
});

describe('runDoctor statusline:runtime diagnostic', () => {
  test('emits a Windows-specific hint on win32', async () => {
    const report = await runDoctor({ platform: 'win32', skillPresenceProbe: () => null });
    const check = report.checks.find((item) => item.id === 'statusline:runtime');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('win32');
    expect(check?.message).toContain('PATH');
  });

  test('reports the running version on non-Windows platforms', async () => {
    const report = await runDoctor({ platform: 'linux', skillPresenceProbe: () => null });
    const check = report.checks.find((item) => item.id === 'statusline:runtime');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('linux');
  });
});

describe('doctor-report schema documents the skill-presence prefix', () => {
  test('schema pattern includes skill-presence prefix', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join: joinPath } = await import('node:path');
    const { schemasDir } = await import('peaks-loop-shared/paths');
    const raw = await readFile(joinPath(schemasDir, 'doctor-report.schema.json'), 'utf8');

    expect(raw).toContain('skill-presence');
    const schema = JSON.parse(raw) as {
      properties: { checks: { items: { properties: { id: { pattern: string; description: string } } } } };
    };
    expect(schema.properties.checks.items.properties.id.pattern).toContain('skill-presence');
    expect(schema.properties.checks.items.properties.id.description).toContain('skill-presence');
  });
});

describe('runDoctor codegraph capability check', () => {
  test('passes when the pinned @colbymchenry/codegraph package and binary resolve', async () => {
    const report = await runDoctor();
    const check = report.checks.find((item) => item.id === 'capability:codegraph');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('@colbymchenry/codegraph@0.7.10');
    expect(check?.message).toContain('binary at');
  });

  test('fails when the resolved package version drifts from the pin', async () => {
    const report = await runDoctor({
      codegraphProbe: () => ({
        packagePath: '/fake/node_modules/@colbymchenry/codegraph/package.json',
        version: '0.7.11',
        binaryPath: '/fake/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
        binaryExists: true
      })
    });
    const check = report.checks.find((item) => item.id === 'capability:codegraph');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('version mismatch');
    expect(check?.message).toContain('expected 0.7.10');
    expect(check?.message).toContain('resolved 0.7.11');
    expect(report.summary.ok).toBe(false);
  });

  test('fails when the package resolves at the right version but the binary is missing', async () => {
    const report = await runDoctor({
      codegraphProbe: () => ({
        packagePath: '/fake/node_modules/@colbymchenry/codegraph/package.json',
        version: '0.7.10',
        binaryPath: '/fake/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
        binaryExists: false
      })
    });
    const check = report.checks.find((item) => item.id === 'capability:codegraph');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('binary is missing');
    expect(report.summary.ok).toBe(false);
  });

  test('fails when the probe throws (package not installed)', async () => {
    const report = await runDoctor({
      codegraphProbe: () => {
        throw new Error('Cannot find module @colbymchenry/codegraph');
      }
    });
    const check = report.checks.find((item) => item.id === 'capability:codegraph');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('not resolvable');
    expect(check?.message).toContain('Cannot find module @colbymchenry/codegraph');
    expect(report.summary.ok).toBe(false);
  });
});

describe('runDoctor build:dist-version-matches-source check', () => {
  test('passes when the dist CLI_VERSION matches the source package.json#version', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      l3ProjectRoot: await mkdtemp(join(tmpdir(), 'peaks-doctor-dist-match-')),
      skillPresenceProbe: () => null
    });
    const check = report.checks.find((item) => item.id === 'build:dist-version-matches-source');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('1.3.1');
    expect(report.summary.ok).toBe(true);
  });

  test('fails with an actionable message when dist and source versions diverge', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.2.9', source: '1.3.1', match: false, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] })
    });
    const check = report.checks.find((item) => item.id === 'build:dist-version-matches-source');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('1.2.9');
    expect(check?.message).toContain('1.3.1');
    expect(check?.message).toContain('pnpm build');
    expect(report.summary.ok).toBe(false);
  });

  test('passes with an informational message when dist/ is absent (fresh clone, pre-build)', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: null, source: '1.3.1', match: false, distReadable: false }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      l3ProjectRoot: await mkdtemp(join(tmpdir(), 'peaks-doctor-dist-absent-')),
      skillPresenceProbe: () => null
    });
    const check = report.checks.find((item) => item.id === 'build:dist-version-matches-source');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('dist/');
    expect(check?.message).toContain('pnpm build');
    expect(report.summary.ok).toBe(true);
  });
});

describe('runDoctor build:workspace-layout-canonical check', () => {
  test('passes when no top-level session dirs and no legacy dotfiles are present', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      l3ProjectRoot: await mkdtemp(join(tmpdir(), 'peaks-doctor-layout-')),
      skillPresenceProbe: () => null
    });
    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('canonical');
    expect(report.summary.ok).toBe(true);
  });

  test('fails and lists the offending top-level session dir when one is present', async () => {
    const offender = '.peaks/2026-06-06-session-c4c553/';
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [offender], legacyDotfiles: [] })
    });
    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain(offender);
    expect(check?.message).toContain('top-level session dir');
    expect(check?.message).toContain('peaks workspace migrate');
    expect(report.summary.ok).toBe(false);
  });

  test('fails and lists the offending legacy dotfile when one is present', async () => {
    const offender = '.peaks/.session.json';
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [offender] })
    });
    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain(offender);
    expect(check?.message).toContain('legacy dotfile');
    expect(check?.message).toContain('peaks workspace migrate');
    expect(report.summary.ok).toBe(false);
  });

  /**
   * Slice 007 — sub-agent session sharing. The post-F3 canonical
   * layout is "everything under .peaks/_runtime/<sid>/", and reviewable
   * artifacts live under the per-change-id dir tracked at
   * `.peaks/_runtime/<change-id>/<role>/`. The pre-slice-007 layout was
   * "top-level per-change-id dirs only" (e.g. `.peaks/001-.../`), and
   * five already-shipped slices left such dirs behind. The doctor
   * check now flags them so slice 008's migration can clean them up.
   */
  test('flags per-change-id top-level dirs (e.g. .peaks/NNN-YYYY-MM-DD-<slug>/) when present', async () => {
    const offender = '.peaks/001-2026-06-06-doctor-dist-version-check/';
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({
        topLevelSessionDirs: [],
        legacyDotfiles: [],
        perChangeIdDirs: [offender]
      })
    });
    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain(offender);
    expect(check?.message).toContain('per-change-id top-level dir');
    expect(check?.message).toContain('peaks workspace migrate');
  });

  test('build:workspace-layout-canonical stays ok when only legacy top-level session dirs are absent (no per-change-id scope)', async () => {
    // Sanity for the new probe shape: when perChangeIdDirs is also
    // empty, the check still passes (back-compat for the existing
    // topLevelSessionDirs + legacyDotfiles assertion).
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '1.3.1', source: '1.3.1', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({
        topLevelSessionDirs: [],
        legacyDotfiles: [],
        perChangeIdDirs: []
      })
    });
    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');

    expect(check).toMatchObject({ ok: true });
  });
});

/**
 * L3:l3-memory-health schema drift regression net.
 *
 * Slice 2026-06-13-repair-pre-existing-test-failures: the on-disk
 * .peaks/memory/index.json ships with `version: 1` (per the
 * MemoryIndex type in src/services/memory/project-memory-service.ts)
 * but the doctor check historically probed for `schema_version`. The
 * mismatch turned every doctor test that asserted `summary.ok = true`
 * into a regression. The probe-driven test below verifies the fix:
 * the doctor must report ok:true for the L3:l3-memory-health check
 * when the on-disk index carries `version: 1`.
 *
 * Uses an injected l3ProjectRoot option (slice fix in
 * src/services/doctor/doctor-service.ts) so the test does not depend
 * on the real .peaks/memory/index.json on disk.
 */
describe('runDoctor L3:l3-memory-health check', () => {
  let cwdSpy: { mockRestore: () => void };
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await mkdtemp(join(tmpdir(), 'peaks-doctor-l3-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(scratchRoot);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  test('passes when .peaks/memory/index.json has the production schema (version: 1)', async () => {
    await mkdir(join(scratchRoot, '.peaks', 'memory'), { recursive: true });
    await writeFile(
      join(scratchRoot, '.peaks', 'memory', 'index.json'),
      JSON.stringify({
        version: 1,
        updatedAt: '2026-06-13T00:00:00.000Z',
        hot: { feedback: [], friction: [], lesson: [] },
        warm: { feedback: [], friction: [], lesson: [] }
      }),
      'utf8'
    );

    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.5', source: '2.0.5', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      l3ProjectRoot: scratchRoot
    });
    const check = report.checks.find((item) => item.id === 'L3:l3-memory-health');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('version=1');
  });

  test('passes when no .peaks/memory/index.json exists yet (fresh project)', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.5', source: '2.0.5', match: true, distReadable: true }),
      workspaceLayoutProbe: () => ({ topLevelSessionDirs: [], legacyDotfiles: [] }),
      l3ProjectRoot: scratchRoot
    });
    const check = report.checks.find((item) => item.id === 'L3:l3-memory-health');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('No .peaks/memory/index.json yet');
  });
});

describe('runDoctor integration:gateguard-peaks-conflict check', () => {
  /**
   * 2026-06-10 — the gateguard-fact-force hook is a third-party PreToolUse
   * hook (NOT peaks-loop) that fires on Edit/Write tools and demands a
   * 4-fact questionnaire before allowing the edit. When the LLM is in a
   * peaks-qa flow and tries to update `.peaks/_runtime/<sid>/qa/requests/*.md`
   * via the Edit/Write tool, the hook demands facts that are inapplicable
   * to QA envelope templates (no importers, no public API, no data files,
   * user instruction already in the conversation context).
   *
   * The check detects this hook in the user's global and project
   * `.claude/settings.json` and warns when no `.peaks/**` skip is
   * configured. Probe is injected so tests do not depend on the real
   * filesystem state of `~/.claude/settings.json`.
   */

  test('passes when neither global nor project settings have any gateguard hook', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.1', source: '2.0.1', match: true, distReadable: true }),
      gateguardProbe: () => ({
        globalSettingsPath: '/home/user/.claude/settings.json',
        globalSettings: { hooks: { PreToolUse: [] } },
        projectSettingsPath: '/repo/.claude/settings.json',
        projectSettings: null
      }),
      l3ProjectRoot: await mkdtemp(join(tmpdir(), 'peaks-doctor-gateguard-')),
      skillPresenceProbe: () => null
    });
    const check = report.checks.find((item) => item.id === 'integration:gateguard-peaks-conflict');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('No gateguard-fact-force');
    expect(report.summary.ok).toBe(true);
  });

  test('flags a gateguard PreToolUse hook on Edit/Write with no .peaks skip', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.1', source: '2.0.1', match: true, distReadable: true }),
      gateguardProbe: () => ({
        globalSettingsPath: '/home/user/.claude/settings.json',
        globalSettings: {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'gateguard-fact-force --enforce-facts'
                  }
                ]
              }
            ]
          }
        },
        projectSettingsPath: '/repo/.claude/settings.json',
        projectSettings: null
      })
    });
    const check = report.checks.find((item) => item.id === 'integration:gateguard-peaks-conflict');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('gateguard-fact-force');
    expect(check?.message).toContain('Edit');
    expect(check?.message).toContain('.peaks');
    expect(check?.message).toContain('ECC_DISABLED_HOOKS');
  });

  test('passes when gateguard hook is present but a .peaks skip is configured via separate matcher', async () => {
    // The check accepts any PreToolUse entry whose command/path mentions
    // `.peaks` (e.g. a paired matcher that points the hook at a
    // .peaks-allowlist) as evidence the user has routed the conflict.
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.1', source: '2.0.1', match: true, distReadable: true }),
      gateguardProbe: () => ({
        globalSettingsPath: '/home/user/.claude/settings.json',
        globalSettings: {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'gateguard-fact-force --skip-glob ".peaks/**" --enforce-facts'
                  }
                ]
              }
            ]
          }
        },
        projectSettingsPath: '/repo/.claude/settings.json',
        projectSettings: null
      })
    });
    const check = report.checks.find((item) => item.id === 'integration:gateguard-peaks-conflict');

    expect(check).toMatchObject({ ok: true });
    expect(check?.message).toContain('.peaks');
  });

  test('passes when project settings are absent (uninitialized project)', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.1', source: '2.0.1', match: true, distReadable: true }),
      gateguardProbe: () => ({
        globalSettingsPath: '/home/user/.claude/settings.json',
        globalSettings: null,
        projectSettingsPath: null,
        projectSettings: null
      })
    });
    const check = report.checks.find((item) => item.id === 'integration:gateguard-peaks-conflict');

    expect(check).toMatchObject({ ok: true });
  });

  test('detects the conflict when only the project .claude/settings.json has the hook', async () => {
    const report = await runDoctor({
      distVersionProbe: () => ({ dist: '2.0.1', source: '2.0.1', match: true, distReadable: true }),
      gateguardProbe: () => ({
        globalSettingsPath: '/home/user/.claude/settings.json',
        globalSettings: { hooks: {} },
        projectSettingsPath: '/repo/.claude/settings.json',
        projectSettings: {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Edit|Write|MultiEdit',
                hooks: [
                  { type: 'command', command: 'peaks hook handle' },
                  { type: 'command', command: 'gateguard-fact-force --strict' }
                ]
              }
            ]
          }
        }
      })
    });
    const check = report.checks.find((item) => item.id === 'integration:gateguard-peaks-conflict');

    expect(check).toMatchObject({ ok: false });
    expect(check?.message).toContain('/repo/.claude/settings.json');
  });
});
