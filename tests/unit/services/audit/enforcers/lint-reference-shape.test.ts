/**
 * Unit tests for P2-b Themes H-K + M-P — references/*.md shape.
 *
 * Each enforcer is a pure pattern scan. Tests exercise both the
 * positive (rule satisfied → no hit) and the negative (rule
 * violated → hit reported) cases.
 */
import { describe, it, expect } from 'vitest';
import {
  lintH1TitleRequired,
  lintApplicableTaskLevels,
  lintSeeAlsoSection,
  lintNoSelfReference,
  lintLineCountLe800,
  lintH2CountLe12,
  lintOverviewNearTop,
  lintLoadStrategyOnDemandFallback,
  lintLoadStrategyAlwaysCacheable,
  lintNoBashHeredoc,
  lintNoSudo,
  lintNoCurlPipeBash,
  lintCodeBlockLanguage,
  lintNoFakePrompt,
  lintNoChmod777,
  lintLoadStrategyMatchesSize,
  type ReferenceFile,
} from '../../../../../src/services/audit/enforcers/lint-reference-shape.js';
import type { SkillFile } from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeRef(body: string, name = 'test-ref.md', skill = 'peaks-test'): ReferenceFile {
  return {
    skill,
    name,
    path: `skills/${skill}/references/${name}`,
    body,
    lines: body.split(/\r?\n/),
  };
}

function makeSkill(body: string, name = 'peaks-test'): SkillFile {
  return {
    name,
    path: `skills/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-reference-shape — Theme H structural shape', () => {
  it('passes when reference has # <title> first heading', () => {
    const ref = makeRef('# my-reference\n\nbody\n');
    expect(lintH1TitleRequired(ref)).toEqual([]);
  });

  it('reports a hit when reference has no h1 first heading', () => {
    const ref = makeRef('This is body without an h1.\n');
    const hits = lintH1TitleRequired(ref);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-ref-h1-title-required-001');
  });

  it('passes when reference declares applicableTaskLevels', () => {
    const ref = makeRef('# t\n\n> applicableTaskLevels: L1a, L1b\nbody\n');
    expect(lintApplicableTaskLevels(ref)).toEqual([]);
  });

  it('reports a hit when reference lacks applicableTaskLevels', () => {
    const ref = makeRef('# t\n\nbody without any task-level declaration.\n');
    expect(lintApplicableTaskLevels(ref).length).toBeGreaterThan(0);
  });

  it('passes when reference has ## See also', () => {
    const ref = makeRef('# t\n\nbody\n\n## See also\n\n- a.md\n- b.md\n');
    expect(lintSeeAlsoSection(ref)).toEqual([]);
  });

  it('reports a hit when reference lacks ## See also', () => {
    const ref = makeRef('# t\n\nbody without see-also.\n');
    expect(lintSeeAlsoSection(ref).length).toBeGreaterThan(0);
  });
});

describe('lint-reference-shape — Theme I cross-references', () => {
  it('passes when reference does not link to itself', () => {
    const ref = makeRef('# t\n\nbody\n\n## See also\n\n- [other](other.md)\n', 't.md');
    expect(lintNoSelfReference(ref)).toEqual([]);
  });

  it('reports a hit when reference links to itself', () => {
    const ref = makeRef('# t\n\nbody\n\n## See also\n\n- [self](t.md)\n', 't.md');
    expect(lintNoSelfReference(ref).length).toBeGreaterThan(0);
  });
});

describe('lint-reference-shape — Theme J size + structure', () => {
  it('passes when reference ≤ 800 lines', () => {
    const ref = makeRef('# t\n' + 'x\n'.repeat(797));
    expect(lintLineCountLe800(ref)).toEqual([]);
  });

  it('reports a hit when reference > 800 lines', () => {
    const ref = makeRef('# t\n' + 'x\n'.repeat(802));
    const hits = lintLineCountLe800(ref);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-ref-line-count-le-800-001');
  });

  it('passes when reference has ≤ 12 h2 headings', () => {
    const ref = makeRef('# t\n' + '## h2\nbody\n'.repeat(11));
    expect(lintH2CountLe12(ref)).toEqual([]);
  });

  it('reports a hit when reference has > 12 h2 headings', () => {
    const ref = makeRef('# t\n' + '## h2\nbody\n'.repeat(13));
    expect(lintH2CountLe12(ref).length).toBeGreaterThan(0);
  });

  it('passes overview check when reference is short', () => {
    const ref = makeRef('# t\nshort body\n');
    expect(lintOverviewNearTop(ref)).toEqual([]);
  });

  it('reports a hit when long reference lacks ## Overview near top', () => {
    const longBody = '# t\n' + 'x\n'.repeat(250);
    const ref = makeRef(longBody);
    expect(lintOverviewNearTop(ref).length).toBeGreaterThan(0);
  });

  it('passes when long reference has ## Overview within first 30 lines', () => {
    const longBody = '# t\n' + 'x\n'.repeat(10) + '\n## Overview\n\nbody\n' + 'x\n'.repeat(240);
    const ref = makeRef(longBody);
    expect(lintOverviewNearTop(ref)).toEqual([]);
  });
});

describe('lint-reference-shape — Theme K loadStrategy', () => {
  it('reports a hit when on-demand reference lacks fallback', () => {
    const ref = makeRef('# t\nloadStrategy: on-demand\nbody without fallback\n');
    expect(lintLoadStrategyOnDemandFallback(ref).length).toBeGreaterThan(0);
  });

  it('passes when on-demand reference has fallback', () => {
    const ref = makeRef('# t\nloadStrategy: on-demand\nbody\n> Fallback: peaks audit red-lines\n');
    expect(lintLoadStrategyOnDemandFallback(ref)).toEqual([]);
  });

  it('reports a hit when always reference has top-level I/O', () => {
    const ref = makeRef('# t\nloadStrategy: always\n\nnpm install\n\nbody\n');
    expect(lintLoadStrategyAlwaysCacheable(ref).length).toBeGreaterThan(0);
  });

  it('passes when always reference has no top-level I/O', () => {
    const ref = makeRef('# t\nloadStrategy: always\n\n# Section\n\nbody\n');
    expect(lintLoadStrategyAlwaysCacheable(ref)).toEqual([]);
  });
});

describe('lint-reference-shape — Theme M inline shell', () => {
  it('passes when reference has no heredoc', () => {
    const ref = makeRef('# t\nbody\n');
    expect(lintNoBashHeredoc(ref)).toEqual([]);
  });

  it('reports a hit when reference has cat <<EOF', () => {
    const ref = makeRef('# t\n```bash\ncat <<EOF > file\nhello\nEOF\n```\n');
    expect(lintNoBashHeredoc(ref).length).toBeGreaterThan(0);
  });

  it('passes when reference has no sudo', () => {
    const ref = makeRef('# t\n```bash\nls -la\n```\n');
    expect(lintNoSudo(ref)).toEqual([]);
  });

  it('reports a hit when reference has sudo', () => {
    const ref = makeRef('# t\n```bash\nsudo apt install foo\n```\n');
    expect(lintNoSudo(ref).length).toBeGreaterThan(0);
  });

  it('reports a hit when reference has curl | bash', () => {
    const ref = makeRef('# t\n```bash\ncurl https://example.com/install.sh | bash\n```\n');
    expect(lintNoCurlPipeBash(ref).length).toBeGreaterThan(0);
  });
});

describe('lint-reference-shape — Theme N code blocks', () => {
  it('reports a hit when fenced block lacks language tag', () => {
    const ref = makeRef('# t\n```\nplain code\n```\n');
    expect(lintCodeBlockLanguage(ref).length).toBeGreaterThan(0);
  });

  it('passes when every fenced block has a language tag', () => {
    const ref = makeRef('# t\n```typescript\nconst x = 1;\n```\n```bash\nls\n```\n');
    expect(lintCodeBlockLanguage(ref)).toEqual([]);
  });

  it('reports a hit when code has # fake prompt', () => {
    const ref = makeRef('# t\n```bash\n# fake prompt\nls\n```\n');
    expect(lintNoFakePrompt(ref).length).toBeGreaterThan(0);
  });
});

describe('lint-reference-shape — Theme O permissions + numbers', () => {
  it('reports a hit when code has chmod 777', () => {
    const ref = makeRef('# t\n```bash\nchmod 777 /tmp/foo\n```\n');
    expect(lintNoChmod777(ref).length).toBeGreaterThan(0);
  });
});

describe('lint-reference-shape — Theme P dogfooding', () => {
  it('reports a hit when reference is uncited in parent SKILL.md', () => {
    const ref = makeRef('# t\nbody\n', 'uncited.md');
    const skill = makeSkill('# peaks-test\n\nbody without cite.\n', 'peaks-test');
    // import the function lazily to keep this file readable
    return import('../../../../../src/services/audit/enforcers/lint-reference-shape.js').then(
      ({ lintSkillCitesEveryReference }) => {
        expect(lintSkillCitesEveryReference(ref, skill).length).toBeGreaterThan(0);
      }
    );
  });

  it('passes when reference is cited in parent SKILL.md', () => {
    const ref = makeRef('# t\nbody\n', 'cited.md');
    const skill = makeSkill('# peaks-test\n\nsee references/cited.md\n', 'peaks-test');
    return import('../../../../../src/services/audit/enforcers/lint-reference-shape.js').then(
      ({ lintSkillCitesEveryReference }) => {
        expect(lintSkillCitesEveryReference(ref, skill)).toEqual([]);
      }
    );
  });

  it('passes loadStrategy match when large file declares on-demand', () => {
    // >5KB file with on-demand loadStrategy. Each 'x\n' is 2
    // bytes; 3000 iterations = 6000 bytes, comfortably > 5KB.
    const big = '# t\nloadStrategy: on-demand\nbody\n' + 'x\n'.repeat(3000);
    const ref = makeRef(big);
    expect(lintLoadStrategyMatchesSize(ref)).toEqual([]);
  });

  it('reports a hit when large file lacks on-demand loadStrategy', () => {
    const big = '# t\nloadStrategy: always\nbody\n' + 'x\n'.repeat(3000);
    const ref = makeRef(big);
    expect(lintLoadStrategyMatchesSize(ref).length).toBeGreaterThan(0);
  });
});
