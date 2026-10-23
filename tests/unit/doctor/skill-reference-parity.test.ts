// tests/unit/doctor/skill-reference-parity.test.ts
//
// 4-dimension unit test for the `skills:reference-parity` doctor check
// (slice 2026-10-18-skill-reference-parity).
//
// The reported shape is the missing-reference control: a file exists in the
// canonical store (`~/.peaks/skills/peaks-code/references/fast-lane-norm.md`)
// and is absent at an existing IDE skill root. The check must name it, warn
// (never block), and point at the LLM-run repair instead of a typed CLI verb.
//
// IT ALWAYS EMITS A ROW. Identical trees produce a GREEN
// `skills:reference-parity:store` row (the comparison ran and found nothing);
// the SAME id goes RED when the store could not be compared at all — absent,
// or present but not a readable directory. It must never write.
//
// The comparator is injected with temp roots in every case, so this file
// never reads or writes the real home directory.
//
// Dimensions covered:
//   - render:      check id shape, ok/severity shape, registry + schema pins
//   - behavior:    missing / extra / identical / absent roots / managed names
//   - integration: real temp trees on disk, including a junction install, and
//                  a before/after listing proving the check wrote nothing
//   - a11y:        the warning names the IDE, the skill, the paths, and the
//                  LLM-run repair; the first 3 paths per side are capped
//
// Run with: pnpm vitest run tests/unit/doctor/skill-reference-parity.test.ts

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { schemasDir } from 'peaks-loop-shared/paths';

import {
  compareSkillReferenceParity,
  check as skillParityCheck
} from '~/src/services/doctor/doctor-service/checks/skill-reference-parity';
import { PLUGINS } from '~/src/services/doctor/doctor-service/plugin-registry';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/doctor/skill-reference-parity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) {
    rmSync(temp, { recursive: true, force: true });
  }
});

function makeTempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `peaks-skill-parity-${label}-`));
  temps.push(root);
  return root;
}

/** Create `relative` under `root` as a file with fixed content. */
function writeFile(root: string, relative: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${relative}\n`, 'utf8');
}

/** Recursive, sorted listing of every name under `root` — for the no-write proof. */
function listEverything(root: string): string[] {
  const entries: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    const dirents = readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const dirent of dirents) {
      const relative = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      entries.push(relative);
      if (dirent.isDirectory()) walk(join(dir, dirent.name), relative);
    }
  };
  walk(root, '');
  return entries;
}

function only(checks: readonly DoctorCheck[]): DoctorCheck {
  expect(checks).toHaveLength(1);
  const [check] = checks;
  if (check === undefined) throw new Error('expected one check');
  return check;
}

/** Minimal DoctorContext — this check only reads `options`. */
function makeContext(options: DoctorOptions = {}): DoctorContext {
  return {
    options,
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root: '',
    projectRootResolver: () => null,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

function runCheck(context: DoctorContext): readonly DoctorCheck[] {
  return skillParityCheck.run(context) as readonly DoctorCheck[];
}

const IDE = 'claude-code';

describe('(render) skill-reference-parity output shape', () => {
  it('emits skills:reference-parity:<ide>:<skill> with ok:false and severity:warning', () => {
    const canonical = makeTempRoot('render-canonical');
    const ide = makeTempRoot('render-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(ide, 'peaks-code/SKILL.md');

    const check = only(compareSkillReferenceParity(canonical, [{ ide: IDE, skillsDir: ide }]));

    expect(check.id).toBe('skills:reference-parity:claude-code:peaks-code');
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.message.length).toBeGreaterThan(0);
  });

  it('the clean row id goes red when the canonical store is absent (control arm)', () => {
    const missingStore = join(makeTempRoot('render-store'), 'skills');
    const check = only(compareSkillReferenceParity(missingStore, []));

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.message).toContain(missingStore);
    expect(check.message).toContain('were not compared');
  });

  it('emits one green skills:reference-parity:store row when the trees are in parity', () => {
    // given: a canonical store and an IDE root holding the same file set
    // when: the comparison runs
    // then: exactly ONE row is emitted, it carries the store id, and it is ok
    const canonical = makeTempRoot('render-clean-canonical');
    const ide = makeTempRoot('render-clean-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/SKILL.md');

    const checks = compareSkillReferenceParity(canonical, [{ ide: IDE, skillsDir: ide }]);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe('skills:reference-parity:store');
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.severity).toBeUndefined();
    expect(checks[0]?.message).toContain('in parity');
  });

  it('is registered in the doctor plugin list, at the end of the skill group', () => {
    const names = PLUGINS.map((plugin) => plugin.name);
    expect(names).toContain('skill-reference-parity');
    expect(names.indexOf('skill-reference-parity')).toBe(names.indexOf('skill-apply-note') + 1);
  });

  it('the doctor-report schema accepts every id the comparator can emit', () => {
    const canonical = makeTempRoot('render-schema-canonical');
    const ide = makeTempRoot('render-schema-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/extra-note.md');

    const emitted = [
      ...compareSkillReferenceParity(canonical, [{ ide: IDE, skillsDir: ide }]),
      ...compareSkillReferenceParity(join(canonical, 'absent'), [])
    ].map((check) => check.id);

    const schema = JSON.parse(
      readFileSync(join(schemasDir, 'doctor-report.schema.json'), 'utf8')
    ) as { properties: { checks: { items: { properties: { id: { pattern: string } } } } } };
    const pattern = new RegExp(schema.properties.checks.items.properties.id.pattern);

    expect(emitted).toContain('skills:reference-parity:claude-code:peaks-code');
    expect(emitted).toContain('skills:reference-parity:store');
    expect(emitted.filter((id) => !pattern.test(id))).toEqual([]);
  });
});

describe('(behavior) skill-reference-parity verdicts', () => {
  it('reports the reported case: a canonical reference missing at the IDE root', () => {
    const canonical = makeTempRoot('behavior-missing-canonical');
    const ide = makeTempRoot('behavior-missing-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(ide, 'peaks-code/SKILL.md');

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.ok).toBe(false);
    expect(check.message).toContain('missing: references/fast-lane-norm.md');
    expect(check.message).not.toContain('extra:');
  });

  it('reports an IDE-only file as extra, never as missing', () => {
    const canonical = makeTempRoot('behavior-extra-canonical');
    const ide = makeTempRoot('behavior-extra-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/references/local-notes.md');

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.ok).toBe(false);
    expect(check.message).toContain('extra: references/local-notes.md');
    expect(check.message).not.toContain('missing:');
  });

  it('reports clean when both trees hold the same files', () => {
    const canonical = makeTempRoot('behavior-equal-canonical');
    const ide = makeTempRoot('behavior-equal-ide');
    for (const root of [canonical, ide]) {
      writeFile(root, 'peaks-code/SKILL.md');
      writeFile(root, 'peaks-code/references/fast-lane-norm.md');
    }

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(true);
    expect(check.message).toContain('in parity');
  });

  it('skips an IDE root that does not exist, and still says what it compared', () => {
    const canonical = makeTempRoot('behavior-absent-ide-canonical');
    writeFile(canonical, 'peaks-code/SKILL.md');
    const absent = join(makeTempRoot('behavior-absent-ide'), 'never-created');

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'trae', skillsDir: absent }])
    );

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(true);
    expect(check.message).toContain('nothing to compare');
  });

  it('ignores .peaks-managed and .peaks-tmp- names at the root and inside a skill tree', () => {
    const canonical = makeTempRoot('behavior-managed-canonical');
    const ide = makeTempRoot('behavior-managed-ide');
    for (const root of [canonical, ide]) {
      writeFile(root, 'peaks-code/SKILL.md');
      writeFile(root, 'peaks-code.peaks-managed');
      writeFile(root, 'peaks-code/references/fast-lane-norm.md.peaks-managed');
      writeFile(root, 'peaks-code/.peaks-tmp-abc');
      writeFile(root, '.peaks-tmp-store-scratch');
    }

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(true);
  });

  it('the clean row id goes red when the store is malformed (control arm)', () => {
    const store = join(makeTempRoot('behavior-store-file'), 'skills');
    writeFileSync(store, 'not a directory\n', 'utf8');

    const check = only(compareSkillReferenceParity(store, []));

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('warning');
    expect(check.message).toContain(store);
    expect(check.message).toContain('is not a directory');
    expect(check.message).toContain('were not compared');
  });

  it('leaves a user-authored skill that exists only on the IDE side alone', () => {
    const canonical = makeTempRoot('behavior-ide-only-canonical');
    const ide = makeTempRoot('behavior-ide-only-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/SKILL.md');
    writeFile(ide, 'user-skill/SKILL.md');

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(true);
  });

  it('normalises every emitted id into the doctor-report schema alphabet', () => {
    const canonical = makeTempRoot('behavior-id-canonical');
    const ide = makeTempRoot('behavior-id-ide');
    writeFile(canonical, 'my skill/SKILL.md');
    writeFile(ide, 'my skill/notes.md');

    const [check] = compareSkillReferenceParity(canonical, [
      { ide: 'claude-code', skillsDir: ide }
    ]);
    const schema = JSON.parse(
      readFileSync(join(schemasDir, 'doctor-report.schema.json'), 'utf8')
    ) as { properties: { checks: { items: { properties: { id: { pattern: string } } } } } };

    expect(check?.id).toBe('skills:reference-parity:claude-code:my-skill');
    expect(check?.message).toContain('my skill');
    expect(
      new RegExp(schema.properties.checks.items.properties.id.pattern).test(check?.id ?? '')
    ).toBe(true);
  });
});

describe('(integration) skill-reference-parity against real temp trees', () => {
  it('follows a junction install: a linked IDE skill tree compares equal', () => {
    const home = makeTempRoot('integration-junction');
    const canonical = join(home, 'canonical-skills');
    const ide = join(home, 'ide-skills');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    mkdirSync(ide, { recursive: true });
    symlinkSync(
      join(canonical, 'peaks-code'),
      join(ide, 'peaks-code'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.id).toBe('skills:reference-parity:store');
    expect(check.ok).toBe(true);
  });

  it('never writes: both trees hold the same names after a diverged run', () => {
    const canonical = makeTempRoot('integration-nowrite-canonical');
    const ide = makeTempRoot('integration-nowrite-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(ide, 'peaks-code/SKILL.md');
    const before = listEverything(canonical).concat(listEverything(ide));

    compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }]);

    expect(listEverything(canonical).concat(listEverything(ide))).toEqual(before);
  });

  it('does not invent phantom paths from a self-referential junction', () => {
    const home = makeTempRoot('integration-cycle');
    const canonical = join(home, 'canonical-skills');
    const ide = join(home, 'ide-skills');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/SKILL.md');
    symlinkSync(
      join(canonical, 'peaks-code'),
      join(canonical, 'peaks-code', 'loop'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    // Without the visited set the canonical tree grows loop/SKILL.md,
    // loop/loop/SKILL.md, … and every one is reported missing.
    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.ok).toBe(true);
  });

  it('the plugin wrapper compares the injected roots instead of the real home', () => {
    const canonical = makeTempRoot('integration-wrapper-canonical');
    const ide = makeTempRoot('integration-wrapper-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(ide, 'peaks-code/SKILL.md');

    const checks = runCheck(
      makeContext({
        skillParity: {
          canonicalRoot: canonical,
          ideRoots: [{ ide: 'zcode', skillsDir: ide }]
        }
      })
    );

    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe('skills:reference-parity:zcode:peaks-code');
    expect(checks[0]?.message).toContain('references/fast-lane-norm.md');
  });

  it('reports every existing IDE root independently', () => {
    const canonical = makeTempRoot('integration-multi-canonical');
    const clashCode = makeTempRoot('integration-multi-claude');
    const zcode = makeTempRoot('integration-multi-zcode');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(clashCode, 'peaks-code/SKILL.md');
    writeFile(zcode, 'peaks-code/references/fast-lane-norm.md');

    const ids = compareSkillReferenceParity(canonical, [
      { ide: 'claude-code', skillsDir: clashCode },
      { ide: 'zcode', skillsDir: zcode }
    ]).map((check) => check.id);

    expect(ids).toContain('skills:reference-parity:claude-code:peaks-code');
    expect(ids).toContain('skills:reference-parity:zcode:peaks-code');
  });
});

describe('(a11y) skill-reference-parity message text', () => {
  it('names the IDE, the skill, the missing path, and the LLM-run repair', () => {
    const canonical = makeTempRoot('a11y-canonical');
    const ide = makeTempRoot('a11y-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(canonical, 'peaks-code/references/fast-lane-norm.md');
    writeFile(ide, 'peaks-code/SKILL.md');

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.message).toContain('claude-code');
    expect(check.message).toContain('peaks-code');
    expect(check.message).toContain('references/fast-lane-norm.md');
    expect(check.message).toContain('Ask the LLM to run `peaks skill sync`');
    expect(check.message).not.toMatch(/you (must|should) run/i);
  });

  it('caps each side at the first 3 paths so the warning stays readable', () => {
    const canonical = makeTempRoot('a11y-cap-canonical');
    const ide = makeTempRoot('a11y-cap-ide');
    writeFile(canonical, 'peaks-code/SKILL.md');
    writeFile(ide, 'peaks-code/SKILL.md');
    for (const name of ['a.md', 'b.md', 'c.md', 'd.md']) {
      writeFile(canonical, `peaks-code/references/${name}`);
    }

    const check = only(
      compareSkillReferenceParity(canonical, [{ ide: 'claude-code', skillsDir: ide }])
    );

    expect(check.message).toContain('a.md');
    expect(check.message).toContain('b.md');
    expect(check.message).toContain('c.md');
    expect(check.message).toContain('and 1 more');
    expect(check.message).not.toContain('d.md');
  });
});
