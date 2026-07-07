import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SPEC_PATH = resolve(
  REPO_ROOT,
  'docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md'
);
const SPEC_BASENAME = 'docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md';

const PEAKS_CODE_SKILL = resolve(REPO_ROOT, 'skills/peaks-code/SKILL.md');
const ADR_0007 = resolve(REPO_ROOT, 'docs/adr/0007-peaks-workflow-primitive.md');
const README_ZH = resolve(REPO_ROOT, 'README.md');
const README_EN = resolve(REPO_ROOT, 'README-en.md');

function safeRead(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Required fixture file missing: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

describe('M9 — Loop Engineering positioning narrative', () => {
  describe('peaks-code SKILL.md — RL-8 self-identification', () => {
    const skill = safeRead(PEAKS_CODE_SKILL);

    it('declares the explicit code-domain long-task loop engineering phrasing', () => {
      expect(skill).toContain('code-domain long-task loop engineering');
    });

    it('explicitly disclaims being a general-purpose orchestrator', () => {
      expect(skill).toMatch(/not a general-purpose orchestrator/i);
    });

    it('references the Loop Engineering crystallization spec', () => {
      expect(skill).toContain(SPEC_BASENAME);
    });

    it('names the ## Scope section heading', () => {
      expect(skill).toMatch(/^##\s+Scope\s*\(RL-8\b/m);
    });

    it('keeps the original Karpathy guidance block (semantic content preserved)', () => {
      expect(skill).toContain('Karpathy guidance');
      expect(skill).toContain('Karpathy-guidelines context');
    });
  });

  describe('ADR 0007 — v3 demotion section', () => {
    const adr = safeRead(ADR_0007);

    it('contains the v3 demotion heading dated 2026-07-07', () => {
      expect(adr).toMatch(/^##\s+v3 demotion\s*\(2026-07-07\)/m);
    });

    it('states peaks-workflow.yaml is no longer the durable asset', () => {
      const demotionBlock = adr.split(/^##\s+v3 demotion\s*\(2026-07-07\)/m)[1] ?? '';
      expect(demotionBlock).toMatch(/execution trace/i);
      expect(demotionBlock).toMatch(/not the user-facing asset|no longer the user-facing asset|durable asset|not the durable product/i);
    });

    it('names the durable assets (loop_release + bee_release + loop_bee_relation + crystallization_event + evolution_evaluation)', () => {
      const demotionBlock = adr.split(/^##\s+v3 demotion\s*\(2026-07-07\)/m)[1] ?? '';
      expect(demotionBlock).toContain('loop_release');
      expect(demotionBlock).toContain('bee_release');
      expect(demotionBlock).toContain('loop_bee_relation');
      expect(demotionBlock).toContain('crystallization_event');
      expect(demotionBlock).toContain('evolution_evaluation');
    });

    it('reframes the user-facing verb as "replay this run"', () => {
      const demotionBlock = adr.split(/^##\s+v3 demotion\s*\(2026-07-07\)/m)[1] ?? '';
      expect(demotionBlock).toMatch(/replay this run/i);
      expect(demotionBlock).toMatch(/create a new asset/i);
    });

    it('references the Loop Engineering crystallization spec (§7.6)', () => {
      expect(adr).toContain(SPEC_BASENAME);
      const demotionBlock = adr.split(/^##\s+v3 demotion\s*\(2026-07-07\)/m)[1] ?? '';
      expect(demotionBlock).toMatch(/§\s*7\.6|7\.6/);
    });
  });

  describe('README.md (zh) — leads with Loop Engineering', () => {
    const readme = safeRead(README_ZH);

    it('leads the "它是什么" hero section with Loop Engineering', () => {
      const heroMatch = readme.match(/##\s*它是什么([\s\S]*?)(?=\n##\s|\Z)/);
      expect(heroMatch, '它是什么 hero section not found').toBeTruthy();
      const hero = heroMatch![1];
      expect(hero).toMatch(/loop engineering/i);
    });

    it('opens the hero with the explicit positioning sentence', () => {
      const heroMatch = readme.match(/##\s*它是什么([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      // the new positioning text — "loop engineering 结晶系统" or the "不是工作流工具" framing
      expect(hero).toMatch(/Loop Engineering\s*结晶系统|loop engineering\s*的工程实现/);
      expect(hero).toMatch(/不是工作流工具/);
    });

    it('states the four-layer asset model', () => {
      const heroMatch = readme.match(/##\s*它是什么([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).toContain('Loop Engineering');
      expect(hero).toMatch(/Bee\s*资产|Bee Asset/);
      expect(hero).toMatch(/Workflow Trace|执行轨迹/);
      expect(hero).toMatch(/Evolution Evaluation|反漂移/);
    });

    it('states the karpathy × darwin dual discipline', () => {
      const heroMatch = readme.match(/##\s*它是什么([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).toMatch(/karpathy/);
      expect(hero).toMatch(/darwin/);
    });

    it('mentions peaks-code as code-domain only', () => {
      expect(readme).toMatch(/peaks-code[\s\S]{0,40}code-domain|code-domain[\s\S]{0,80}peaks-code/);
    });

    it('references the sediment design and the loop-engineering spec', () => {
      expect(readme).toContain('docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md');
      expect(readme).toContain('docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md');
    });

    it('preserves the install command (npx line at the end)', () => {
      expect(readme).toMatch(/npm\s+i\s+-g\s+peaks-loop/);
    });

    it('does NOT enumerate the 19 skill names in the hero section', () => {
      const heroMatch = readme.match(/##\s*它是什么([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      // The 19-skill inventory should not be in the hero block.
      expect(hero).not.toMatch(/19\s*(个|skills?)/i);
    });
  });

  describe('README-en.md — leads with Loop Engineering', () => {
    const readme = safeRead(README_EN);

    it('leads the "What it is" hero section with Loop Engineering', () => {
      const heroMatch = readme.match(/##\s*What it is([\s\S]*?)(?=\n##\s|\Z)/);
      expect(heroMatch, 'What it is hero section not found').toBeTruthy();
      const hero = heroMatch![1];
      expect(hero).toMatch(/loop engineering/i);
    });

    it('opens the hero with the explicit positioning sentence', () => {
      const heroMatch = readme.match(/##\s*What it is([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).toMatch(/Loop Engineering\s*crystallization system|Loop engineering, engineered/);
      expect(hero).toMatch(/not a workflow tool/i);
    });

    it('states the four-layer asset model', () => {
      const heroMatch = readme.match(/##\s*What it is([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).toContain('Loop Engineering');
      expect(hero).toMatch(/Bee Asset/);
      expect(hero).toMatch(/Workflow Trace/);
      expect(hero).toMatch(/Evolution Evaluation/);
    });

    it('states the karpathy × darwin dual discipline', () => {
      const heroMatch = readme.match(/##\s*What it is([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).toMatch(/karpathy/i);
      expect(hero).toMatch(/darwin/i);
    });

    it('mentions peaks-code as code-domain only', () => {
      expect(readme).toMatch(/code-domain/);
      expect(readme).toMatch(/peaks-code/);
    });

    it('references the sediment design and the loop-engineering spec', () => {
      expect(readme).toContain('docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md');
      expect(readme).toContain('docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md');
    });

    it('preserves the install command (npx line at the end)', () => {
      expect(readme).toMatch(/npm\s+i\s+-g\s+peaks-loop/);
    });

    it('does NOT enumerate the 19 skill names in the hero section', () => {
      const heroMatch = readme.match(/##\s*What it is([\s\S]*?)(?=\n##\s|\Z)/);
      const hero = heroMatch![1];
      expect(hero).not.toMatch(/19\s*(skills?|roles?)/i);
    });
  });
});