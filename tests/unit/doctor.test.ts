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
