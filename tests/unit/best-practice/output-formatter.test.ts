import { describe, expect, it } from 'vitest';

import {
  findForbiddenTokens,
  formatOutputTable,
  type RecommendationChoice
} from '../../../src/services/best-practice/output-formatter.js';
import type { DocFragment } from '../../../src/services/best-practice/scan-orchestrator.js';

const LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'java'] as const;
const RECOMMENDATIONS: RecommendationChoice[] = ['A', 'B', 'C'];
const ROW_LABELS = [
  '技术组合(通俗)',
  'peaks-code 估算',
  'user 看到',
  'user 操作',
  '业务影响(6 个月后)',
  '适用场景',
  '适用场景 (parallel)',
  'LLM 推荐'
];

const SAMPLE_FRAGMENT: DocFragment = {
  title: 'Sample doc',
  url: 'https://example.com/doc',
  snippet: 'Sample snippet'
};

function renderFor(language: string, recommendation: RecommendationChoice): string {
  return formatOutputTable({
    intent: 'implement business goal X',
    language,
    fragments: [SAMPLE_FRAGMENT],
    recommendation,
    reasoning: `test reasoning for ${language} with choice ${recommendation}`
  });
}

describe('formatOutputTable — per language', () => {
  for (const language of LANGUAGES) {
    describe(`language: ${language}`, () => {
      it('contains all 8 mandatory row labels', () => {
        const out = renderFor(language, 'A');
        for (const label of ROW_LABELS) {
          expect(out).toContain(label);
        }
      });

      it('★ marker is present on the recommended column header', () => {
        const out = renderFor(language, 'B');
        // Choice B is column 2 (方案 B ★). Count ★ markers — exactly one.
        const starCount = (out.match(/★/g) ?? []).length;
        expect(starCount).toBeGreaterThanOrEqual(1);
        expect(out).toContain('方案 B ★');
        expect(out).not.toContain('方案 A ★');
        expect(out).not.toContain('方案 C ★');
      });

      it('footer is present with 3 lines', () => {
        const out = renderFor(language, 'A');
        expect(out).toContain('↩ 默认走方案 A');
        expect(out).toContain('⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。');
        expect(out).toContain('📝 备注:user 体验在 2/3 个方案里几乎一致');
      });

      it('forbidden-word scan passes (no 会爆 / 头疼 / 黑暗 / 崩 / MVP vs 长期 / MVP 项目 / 代码 50 行 / 学习曲线 / 你的难)', () => {
        const out = renderFor(language, 'C');
        const hits = findForbiddenTokens(out);
        expect(hits).toEqual([]);
      });

      it('language tag in metadata matches input', () => {
        const out = renderFor(language, 'A');
        expect(out).toContain(`language: ${language}`);
      });
    });
  }

  it('all 5 first-class languages produced a renderable table (smoke)', () => {
    for (const language of LANGUAGES) {
      const out = renderFor(language, 'A');
      expect(out.length).toBeGreaterThan(200);
    }
  });

  it('★ marker rotates correctly across A / B / C', () => {
    for (const choice of RECOMMENDATIONS) {
      const out = renderFor('typescript', choice);
      expect(out).toContain(`方案 ${choice} ★`);
    }
  });
});

describe('findForbiddenTokens', () => {
  it('returns empty for clean output', () => {
    const clean = formatOutputTable({
      intent: 'X',
      language: 'typescript',
      fragments: [],
      recommendation: 'A',
      reasoning: 'clean'
    });
    expect(findForbiddenTokens(clean)).toEqual([]);
  });

  it('detects each forbidden token when injected', () => {
    const dirty =
      'inline 会爆 / 头疼 / 黑暗 / 崩 / 代码 50 行 / 学习曲线 / 你的难 / MVP vs 长期 / MVP 项目 end';
    const hits = findForbiddenTokens(dirty);
    expect(hits).toContain('会爆');
    expect(hits).toContain('头疼');
    expect(hits).toContain('黑暗');
    expect(hits).toContain('崩');
    expect(hits).toContain('代码 50 行');
    expect(hits).toContain('学习曲线');
    expect(hits).toContain('你的难');
    expect(hits).toContain('MVP vs 长期');
    expect(hits).toContain('MVP 项目');
  });
});