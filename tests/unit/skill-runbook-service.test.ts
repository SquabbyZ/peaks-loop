import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { inspectSkillRunbook } from '../../src/services/skills/skill-runbook-service.js';

async function writeSkill(root: string, name: string, runbookBody: string | null): Promise<void> {
  await mkdir(join(root, name));
  const section = runbookBody === null ? '' : `\n## Default runbook\n\n${runbookBody}\n`;
  const body = `---\nname: ${name}\ndescription: ${name} skill\n---\n# Body${section}`;
  await writeFile(join(root, name, 'SKILL.md'), body);
}

describe('inspectSkillRunbook', () => {
  test('reports peaks command count from the Default runbook section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-runbook-svc-'));
    await writeSkill(root, 'demo-skill', '```bash\npeaks doctor --json\npeaks request list --project x --json\necho "not a peaks command"\n```');

    const inspection = await inspectSkillRunbook('demo-skill', root);

    expect(inspection).toMatchObject({
      name: 'demo-skill',
      hasRunbook: true,
      peaksCommandCount: 2,
      destructiveApplyLines: [],
      hasAuthorizationNote: false,
      ok: true
    });
    expect(inspection.peaksCommandLines).toEqual(['peaks doctor --json', 'peaks request list --project x --json']);
  });

  test('flags destructive --apply without an authorization note', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-runbook-svc-bad-'));
    await writeSkill(root, 'demo-skill', '```bash\npeaks memory extract --project x --artifact y --apply --json\n```');

    const inspection = await inspectSkillRunbook('demo-skill', root);

    expect(inspection.destructiveApplyLines).toHaveLength(1);
    expect(inspection.hasAuthorizationNote).toBe(false);
    expect(inspection.ok).toBe(false);
  });

  test('passes when destructive --apply is paired with --dry-run guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-runbook-svc-ok-'));
    await writeSkill(
      root,
      'demo-skill',
      '```bash\npeaks memory extract --project x --artifact y --dry-run --json\npeaks memory extract --project x --artifact y --apply --json\n```\n\nOnly run --apply after explicit user authorization.'
    );

    const inspection = await inspectSkillRunbook('demo-skill', root);

    expect(inspection.destructiveApplyLines).toHaveLength(1);
    expect(inspection.hasAuthorizationNote).toBe(true);
    expect(inspection.ok).toBe(true);
  });

  test('reports hasRunbook false when the skill omits the section', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-runbook-svc-none-'));
    await writeSkill(root, 'demo-skill', null);

    const inspection = await inspectSkillRunbook('demo-skill', root);

    expect(inspection.hasRunbook).toBe(false);
    expect(inspection.peaksCommandCount).toBe(0);
    expect(inspection.ok).toBe(false);
  });

  test('throws when the skill is not registered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-runbook-svc-missing-'));

    await expect(inspectSkillRunbook('ghost-skill', root)).rejects.toThrow(/not found/);
  });

  test('reads peaks-solo from the real repo and surfaces a healthy runbook', async () => {
    const inspection = await inspectSkillRunbook('peaks-solo');

    expect(inspection.hasRunbook).toBe(true);
    expect(inspection.peaksCommandCount).toBeGreaterThanOrEqual(20);
    expect(inspection.ok).toBe(true);
  });
});
