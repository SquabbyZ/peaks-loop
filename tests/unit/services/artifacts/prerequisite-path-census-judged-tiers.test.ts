// tests/unit/services/artifacts/prerequisite-path-census-judged-tiers.test.ts
//
// WHY THIS FILE EXISTS. The path census must cover every source of a missing
// path, and the judged-declaration refusals name the security artifact at one
// of `securityArtifactTiers`. The census used to enumerate only the prereq
// table, so a tier added to the judged-declaration module under a directory
// the table never names would be invisible to the census. These tests pin
// that the census reads those tiers from their defining module, and that a
// tier under a new directory is picked up.
//
// WHY THE THIRD TEST MOCKS THE MODULE. The first two tests pin the census's
// OUTPUT VALUES, so a copy of the four tiers written inline instead of an
// import would satisfy both of them. The third test is what pins the SOURCE:
// it mocks the defining module and asserts the census's DEFAULT path follows
// the mock. Under an import it passes; under a copy it fails.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { allPrerequisitePaths } from '~/src/services/artifacts/prerequisite-path-census.js';

const DEFINING_MODULE = '~/src/services/audit-independent/judged-declaration-check.js';

describe('Scenario: census reads the judged-declaration tiers from their defining module', () => {
  it('when the census is read with its defaults, should include every security tier at the rid placeholder', () => {
    // given: the census with no injected tiers
    // when: it is read
    // then: it names the four security-artifact tiers, with the rid placeholder
    const paths = allPrerequisitePaths();
    expect(paths).toContain('audit/security-<rid>.md');
    expect(paths).toContain('audit/security.md');
    expect(paths).toContain('rd/security-review-<rid>.md');
    expect(paths).toContain('rd/security-review.md');
  });

  it('when a judged tier lives under a directory no table row names, should include that tier in the census', () => {
    // given: a judged-declaration tier under a new directory
    // when: the census is read through that seam
    // then: the new tier is reported, under the same placeholder as the others
    const novelTier = (rid: string): readonly string[] => [`audit/novel-dir/security-${rid}.md`];
    const paths = allPrerequisitePaths(novelTier);
    expect(paths).toContain('audit/novel-dir/security-<rid>.md');
  });

  it('when the defining module is mocked, should follow the mock through the default path', async () => {
    // given: the defining module mocked to publish a tier list the census has never seen
    // when: the census is read with NO argument, so its DEFAULT tier source is under test
    // then: the census serves the mocked tier — it READS the defining module, not a copy
    vi.resetModules();
    vi.doMock(DEFINING_MODULE, async () => {
      const actual = await vi.importActual<Record<string, unknown>>(DEFINING_MODULE);
      return {
        ...actual,
        securityArtifactTiers: (rid: string): readonly string[] => [
          `audit/mocked-dir/security-${rid}.md`
        ]
      };
    });
    const { allPrerequisitePaths: mockedCensus } =
      await import('~/src/services/artifacts/prerequisite-path-census.js');
    const paths = mockedCensus();
    expect(paths).toContain('audit/mocked-dir/security-<rid>.md');
  });
});

afterEach(() => {
  vi.doUnmock(DEFINING_MODULE);
  vi.resetModules();
});
