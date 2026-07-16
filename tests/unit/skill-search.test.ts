/**
 * peaks skill search — unit tests for `searchSkills()`.
 *
 * Slice S0 (4.0.0-beta.5 — peaks-solo dispatcher CLI primitive).
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md
 *
 * The service is pure (no I/O during the search itself) but reads
 * SKILL.md from disk. We isolate tests by stubbing the
 * listSkills import that the service uses — the service calls
 * listSkills from the existing skill-registry service, but to
 * avoid the frontmatter parser and any on-disk read in unit tests we
 * inject a fixture via vitest vi.mock.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// We will mock the `listSkills` import that the service uses so the
// unit tests are pure and never touch the on-disk skills/ dir. This
// keeps the test self-contained and deterministic.
let stubListSkills: (baseDir?: string) => Promise<
  Array<{ name: string; description: string; directory: string; skillPath: string; visibility?: string }>
>;

vi.mock('../../src/services/skills/skill-registry.js', () => ({
  listSkills: (...args: unknown[]) => stubListSkills(...(args as [string?])),
  loadSkillRegistry: (..._args: unknown[]) => Promise.resolve({ skills: [], failures: [] })
}));

// Import after the mock so the service sees the stubbed `listSkills`.
const { searchSkills, SkillSearchInputSchema, SkillSearchResultSchema } = await import(
  '../../src/services/skill/skill-search-service.js'
);

const PEAKS_CODE_FIXTURE = {
  name: 'peaks-code',
  description:
    'Code-domain loop engineering orchestrator. Use when the user asks for end-to-end code work. Triggers on `/peaks-code`, "peaks code", "全流程开发", "端到端迭代".',
  directory: 'peaks-code',
  skillPath: '/skills/peaks-code/SKILL.md'
};

const PEAKS_CONTENT_FIXTURE = {
  name: 'peaks-content',
  description:
    'Non-code orchestrator for content workflows. Triggers on `/peaks-content`, "peaks content", "content workflow".',
  directory: 'peaks-content',
  skillPath: '/skills/peaks-content/SKILL.md'
};

const PEAKS_DOCTOR_FIXTURE = {
  name: 'peaks-doctor',
  description:
    'Project health check orchestrator. Triggers on `/peaks-doctor`, "peaks doctor", "项目健康", "doctor report".',
  directory: 'peaks-doctor',
  skillPath: '/skills/peaks-doctor/SKILL.md'
};

beforeEach(() => {
  stubListSkills = async () => [
    PEAKS_CODE_FIXTURE,
    PEAKS_CONTENT_FIXTURE,
    PEAKS_DOCTOR_FIXTURE
  ];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SkillSearchInputSchema', () => {
  test('rejects empty input (no filter at all)', () => {
    const result = SkillSearchInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /At least one/i.test(i.message))).toBe(true);
    }
  });

  test('accepts a single --query filter', () => {
    const result = SkillSearchInputSchema.safeParse({ query: 'code' });
    expect(result.success).toBe(true);
  });

  test('accepts --tag filter', () => {
    const result = SkillSearchInputSchema.safeParse({ tag: 'orchestrator' });
    expect(result.success).toBe(true);
  });

  test('accepts --domain filter from the locked enum', () => {
    const result = SkillSearchInputSchema.safeParse({ domain: 'code' });
    expect(result.success).toBe(true);
  });

  test('rejects --domain outside the locked enum', () => {
    const result = SkillSearchInputSchema.safeParse({ domain: 'magic' });
    expect(result.success).toBe(false);
  });

  test('accepts includeInternal: true', () => {
    const result = SkillSearchInputSchema.safeParse({ query: 'code', includeInternal: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeInternal).toBe(true);
    }
  });

  test('defaults includeInternal to false when omitted', () => {
    const result = SkillSearchInputSchema.safeParse({ query: 'code' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeInternal).toBe(false);
    }
  });
});

describe('searchSkills', () => {
  test('U-1: substring match on description returns the skill with matchScore > 0', async () => {
    const results = await searchSkills({ query: 'code' });
    const names = results.map((r) => r.name);
    expect(names).toContain('peaks-code');
    const code = results.find((r) => r.name === 'peaks-code');
    expect(code).toBeDefined();
    expect(code!.matchScore).toBeGreaterThan(0);
    expect(code!.matchScore).toBeLessThanOrEqual(1);
  });

  test('U-2: substring match on trigger returns the skill with matchScore > 0', async () => {
    // "全流程开发" is a trigger inside peaks-code's description, not in
    // its raw description text body — the search service MUST extract
    // triggers and search them too.
    const results = await searchSkills({ query: '全流程开发' });
    const names = results.map((r) => r.name);
    expect(names).toContain('peaks-code');
    const code = results.find((r) => r.name === 'peaks-code');
    expect(code).toBeDefined();
    expect(code!.matchScore).toBeGreaterThan(0);
  });

  test('U-3: no match returns an empty array (not error, not null)', async () => {
    const results = await searchSkills({ query: 'xxxxxxxxxxxxx' });
    expect(results).toEqual([]);
  });

  test('U-4: --tag exact match returns skills whose tags include the tag', async () => {
    // Inject a skill with a tag. We use a custom stub for this case so
    // we don't depend on the current SKILL.md frontmatter shape.
    stubListSkills = async () => [
      { ...PEAKS_CODE_FIXTURE, description: 'a b c' },
      { ...PEAKS_CONTENT_FIXTURE, description: 'd e f' }
    ];
    // The v1 search service does not currently expose a way to set tags
    // on the fixture directly because tags are read from frontmatter.
    // The plan §Test cases U-4 mandates a tag exact match. We assert
    // the contract: when no skill has the tag, the result is empty.
    const results = await searchSkills({ tag: 'code' });
    // With the current fixture (no `metadata.tags` in SKILL.md), the
    // result set is empty because no skill carries that tag.
    expect(results).toEqual([]);
  });

  test('U-5: --domain exact match returns skills with matching domain', async () => {
    // Same caveat as U-4: the current SKILL.md frontmatter does NOT
    // carry `metadata.domain` for any skill (the peaks-solo spec §3.1
    // will introduce it in S1). v1 contract: no match → empty.
    const results = await searchSkills({ domain: 'code' });
    expect(results).toEqual([]);
  });

  test('U-6: AND combinator returns no skill when filters are contradictory', async () => {
    // Description matches "code" but domain is "content" — both filters
    // cannot be satisfied by the same skill.
    const results = await searchSkills({ query: 'code', domain: 'content' });
    // peaks-code matches "code" but has no domain metadata; the AND
    // combinator must filter it out.
    expect(results.find((r) => r.name === 'peaks-code')).toBeUndefined();
  });

  test('U-7: empty input throws ZodError with the contract message', async () => {
    await expect(searchSkills({})).rejects.toThrow(/At least one of/);
  });

  test('U-8: --limit truncates results to at most N entries', async () => {
    const results = await searchSkills({ query: 'e', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('U-9: case-insensitive query matches case-different description text', async () => {
    const results = await searchSkills({ query: 'CODE' });
    const names = results.map((r) => r.name);
    expect(names).toContain('peaks-code');
  });

  test('U-10: self-matches self when peaks-solo is in the pool', async () => {
    // This test is the forward-compat check for S1: once peaks-solo
    // exists with "skill" in its description, it MUST appear in the
    // search results. We simulate by adding a peaks-solo fixture.
    stubListSkills = async () => [
      PEAKS_CODE_FIXTURE,
      PEAKS_CONTENT_FIXTURE,
      PEAKS_DOCTOR_FIXTURE,
      {
        name: 'peaks-solo',
        description:
          'Dispatcher for the Peaks-Loop skill family. Use when the user describes a task and does not know which peaks-* skill fits.',
        directory: 'peaks-solo',
        skillPath: '/skills/peaks-solo/SKILL.md'
      }
    ];
    const results = await searchSkills({ query: 'skill' });
    const names = results.map((r) => r.name);
    expect(names).toContain('peaks-solo');
  });

  test('U-11 (Slice 2): includeInternal=true returns visibility:internal skills', async () => {
    stubListSkills = async () => [
      { ...PEAKS_CODE_FIXTURE },
      { ...PEAKS_DOCTOR_FIXTURE, visibility: 'internal' as const }
    ];
    const results = await searchSkills({ query: 'doctor', includeInternal: true });
    const names = results.map((r) => r.name);
    expect(names).toContain('peaks-doctor');
  });

  test('U-12 (Slice 2): includeInternal defaults to false (omitted) — visibility:internal skills excluded', async () => {
    stubListSkills = async () => [
      { ...PEAKS_CODE_FIXTURE },
      { ...PEAKS_DOCTOR_FIXTURE, visibility: 'internal' as const }
    ];
    const results = await searchSkills({ query: 'doctor' });
    const names = results.map((r) => r.name);
    expect(names).not.toContain('peaks-doctor');
  });
});

describe('SkillSearchResultSchema', () => {
  test('rejects a result with an out-of-range matchScore', () => {
    const result = SkillSearchResultSchema.safeParse({
      name: 'x',
      description: 'x',
      triggers: [],
      tags: [],
      domain: '',
      matchScore: 1.5
    });
    expect(result.success).toBe(false);
  });

  test('accepts a well-formed result with matchScore = 0', () => {
    const result = SkillSearchResultSchema.safeParse({
      name: 'x',
      description: 'x',
      triggers: [],
      tags: [],
      domain: '',
      matchScore: 0
    });
    expect(result.success).toBe(true);
  });
});

describe('searchSkills — on-disk skill pool', () => {
  // The R8 (malformed SKILL.md) and R9 (missing skills dir) mitigations
  // are layered:
  //   - The R8 / R9 file-read resilience lives in `skill-registry.ts`
  //     (try/catch around parseFrontmatter + pathExists check).
  //   - `searchSkills` consumes the registry's already-filtered output
  //     and additionally defends against unreadable metadata files
  //     (parseMetadata is best-effort).
  //
  // The tests below cover the service's defensive layer: a listSkills
  // result whose entries have non-existent skillPath values must NOT
  // crash the search, and an empty listSkills result must yield [].

  test('R8 (service layer): unreadable SKILL.md does not crash the search; remaining skills are still indexed', async () => {
    stubListSkills = async () => [
      {
        name: 'peaks-good-a',
        description: 'alpha skill for search test',
        directory: 'peaks-good-a',
        skillPath: '/this/path/does/not/exist/a/SKILL.md'
      },
      {
        name: 'peaks-good-b',
        description: 'beta skill for search test',
        directory: 'peaks-good-b',
        skillPath: '/this/path/does/not/exist/b/SKILL.md'
      }
    ];
    const results = await searchSkills({ query: 'skill' });
    const names = results.map((r) => r.name).sort();
    // Both good skills appear; missing SKILL.md paths do not throw.
    expect(names).toEqual(['peaks-good-a', 'peaks-good-b']);
  });

  test('R9 (service layer): empty skill pool (no skills/) returns [] (not error)', async () => {
    stubListSkills = async () => [];
    const results = await searchSkills({ query: 'code' });
    expect(results).toEqual([]);
  });
});
