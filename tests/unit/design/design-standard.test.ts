import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DESIGN_GOVERNANCE_RELATIVE_PATH,
  removeDesignGovernanceStandard,
  writeDesignGovernanceStandard
} from '../../../src/services/design/design-standard.js';
import {
  buildConstitutionUpdate,
  DEFAULT_CONSTITUTION
} from '../../../src/services/standards/standards-constitution.js';
import { renderAgentsMd } from '../../../src/services/standards/standards-render-agents.js';

declareDimensions('tests/unit/design/design-standard.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-std-'));
  roots.push(root);
  return root;
}

describe('Scenario: behavior — the governance standard lifecycle', () => {
  it('when written twice, should leave exactly one block', async () => {
    // given: a project root
    // when: the standard is written twice
    // then: one start and one end marker exist
    const root = makeRoot();
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    const body = readFileSync(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), 'utf8');
    expect(body.match(/peaks:design-governance:start/g)).toHaveLength(1);
    expect(body.match(/peaks:design-governance:end/g)).toHaveLength(1);
    expect(body).toContain('design/tokens.json');
  });

  it('when removed, should delete the file', async () => {
    // given: a written standard
    // when: it is removed
    // then: the file is gone
    const root = makeRoot();
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    const result = await removeDesignGovernanceStandard(root);
    expect(result.removed).toBe(true);
    expect(() => readFileSync(result.path, 'utf8')).toThrow();
  });

  it('when removed and absent, should report not removed', async () => {
    // given: a project root without the standard
    // when: removal runs
    // then: nothing was removed
    const root = makeRoot();
    const result = await removeDesignGovernanceStandard(root);
    expect(result.removed).toBe(false);
  });

  it('when the standard is rendered, should name the S1 diagnostic and defer the gate', async () => {
    // given: a written standard
    // when: its body is read
    // then: it names the S1 diagnostic, defers --gate to S3, and points at the exemplar rule
    const root = makeRoot();
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    const body = readFileSync(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), 'utf8');
    expect(body).toContain('--allow-source-only --accept-note');
    expect(body).toContain('S3');
    expect(body).not.toContain('check --gate');
    expect(body).toContain('design/exemplars/README.md');
    expect(body).toContain('design/exemplars/<archetype>/');
    expect(body).toContain('<name>.tsx');
  });

  it('when the design path carries a backtick, should widen the code span', async () => {
    // given: an app directory whose name contains a backtick
    // when: the standard is written
    // then: the path is fenced by a wider run so the span cannot break
    const root = makeRoot();
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'web/des`ign' });
    const body = readFileSync(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), 'utf8');
    expect(body).toContain('``web/des`ign/contract.md``');
  });
});

describe('Scenario: a11y — the standard write refuses symlinked and escaping targets', () => {
  it('when the standards directory links outside the project, should refuse the write', async () => {
    // given: a standards directory that resolves outside the project root
    // when: the standard is written
    // then: the write is refused and nothing lands outside
    const root = makeRoot();
    const outside = makeRoot();
    mkdirSync(join(outside, 'common'), { recursive: true });
    mkdirSync(join(root, '.peaks'), { recursive: true });
    symlinkSync(
      outside,
      join(root, '.peaks', 'standards'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(
      writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' })
    ).rejects.toThrow(/outside the project root/i);
    expect(existsSync(join(outside, 'common', 'design-governance.md'))).toBe(false);
  });

  it('when the standard file is itself a symlink, should refuse the write', async () => {
    // given: a governance file that is a symlink to another file
    // when: the standard is written
    // then: the symlinked target is refused even though it resolves inside the root
    const root = makeRoot();
    const commonDir = dirname(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH));
    mkdirSync(commonDir, { recursive: true });
    const real = join(commonDir, 'real.md');
    writeFileSync(real, '# real\n', 'utf8');
    symlinkSync(real, join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), 'file');
    await expect(
      writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' })
    ).rejects.toThrow(/symlink/i);
    expect(readFileSync(real, 'utf8')).toBe('# real\n');
  });
});

describe('Scenario: render — the AGENTS line is conditional', () => {
  it('when design governance exists, should print the read line', () => {
    // given: the renderer with the flag on
    // when: the body is rendered
    // then: the line is present
    const body = renderAgentsMd(
      'typescript',
      { packageManager: 'pnpm', commands: [] },
      '.peaks/standards',
      {
        hasDesignGovernance: true
      }
    );
    expect(body).toContain(
      '- Read `.peaks/standards/common/design-governance.md` before changing UI code.'
    );
  });

  it('when it does not exist, should omit the line', () => {
    // given: the renderer with the flag off
    // when: the body is rendered
    // then: the line is absent
    const body = renderAgentsMd(
      'typescript',
      { packageManager: 'pnpm', commands: [] },
      '.peaks/standards',
      {
        hasDesignGovernance: false
      }
    );
    expect(body).not.toContain('common/design-governance.md');
  });
});

describe('Scenario: integration — the live constitution plan', () => {
  it('when the governance standard exists, should plan a body that reads it', () => {
    // given: a project root carrying the standard
    // when: the constitution write plan is built
    // then: the planned body points at it
    const root = makeRoot();
    mkdirSync(dirname(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH)), { recursive: true });
    writeFileSync(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), '# Design governance\n', 'utf8');
    const update = buildConstitutionUpdate({
      projectRoot: root,
      constitution: DEFAULT_CONSTITUTION,
      language: 'typescript',
      scripts: { packageManager: 'pnpm', commands: [] },
      rulesRoot: '.peaks/standards'
    });
    expect(update.body.content).toContain('common/design-governance.md');
  });

  it('when it is absent, should plan a body without the line', () => {
    // given: a project root without the standard
    // when: the constitution write plan is built
    // then: the planned body carries no design governance read line
    const root = makeRoot();
    const update = buildConstitutionUpdate({
      projectRoot: root,
      constitution: DEFAULT_CONSTITUTION,
      language: 'typescript',
      scripts: { packageManager: 'pnpm', commands: [] },
      rulesRoot: '.peaks/standards'
    });
    expect(update.body.content).not.toContain('common/design-governance.md');
  });
});
