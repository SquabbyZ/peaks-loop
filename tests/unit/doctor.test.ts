import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/services/doctor/doctor-service.js';

describe('runDoctor', () => {
  test('passes the repository skeleton with required skills and schemas', async () => {
    const report = await runDoctor();

    expect(report.summary.ok).toBe(true);
    expect(report.checks.some((check) => check.id === 'skill:peaks-solo' && check.ok)).toBe(true);
    expect(report.checks.some((check) => check.id === 'schema:refactor-slice-spec.schema.json' && check.ok)).toBe(true);
  });

  test('reports invalid skills without aborting doctor checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-skills-'));
    await mkdir(join(root, 'peaks-solo'));
    await mkdir(join(root, 'broken-skill'));
    await writeFile(join(root, 'peaks-solo', 'SKILL.md'), `---\nname: peaks-solo\ndescription: Required skill\n---\n# Skill\n`);
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

    for (const name of ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt', 'peaks-solo']) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: `skill-runbook:${name}`, ok: true })
      );
    }
  });

  test('flags a required skill that is missing its Default runbook section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-runbook-'));
    for (const name of ['peaks-solo', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
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

    for (const name of ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt', 'peaks-solo']) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: `skill-apply-note:${name}`, ok: true })
      );
    }
  });

  test('flags a required skill whose runbook lists destructive --apply without an authorization note', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-apply-note-'));
    for (const name of ['peaks-solo', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
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
    for (const name of ['peaks-solo', 'peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa', 'peaks-sc', 'peaks-txt']) {
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
    const { schemasDir } = await import('../../src/shared/paths.js');
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
    const { schemasDir } = await import('../../src/shared/paths.js');
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
    const { skillsDir, requiredSkillNames } = await import('../../src/shared/paths.js');

    for (const name of requiredSkillNames) {
      const body = await readFile(joinPath(skillsDir, name, 'SKILL.md'), 'utf8');
      expect(body, `skill ${name} should embed its own runbook self-check`).toContain(`peaks skill runbook ${name} --json`);
    }
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
