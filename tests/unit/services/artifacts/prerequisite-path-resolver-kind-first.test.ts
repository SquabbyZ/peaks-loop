// tests/unit/services/artifacts/prerequisite-path-resolver-kind-first.test.ts
//
// Guards rid `2026-10-28-resolver-kind-first-numbered`.
//
// The defect: for `audit/` and `rd/`, the request writer numbers the file AFTER
// the kind (`security-003-<rid>.md`, `code-review-003-<rid>.md`). The resolver's
// fallback scan tested `NUMBERED_PREFIX_RE` against the whole filename, and that
// pattern is anchored at the START of the name — so it saw `003-<rid>.md` (the
// `qa/test-cases/` shape) and never `security-003-<rid>.md`. The evidence was on
// disk and the transition refused with "Security review evidence missing".
//
// WHY THE FIXTURE IS A TEMP DIRECTORY. The live session tree holds bare-named
// copies (`audit/security-<rid>.md`) written as a workaround for this very
// defect, and the exact-path lookup runs FIRST. A test that read the live tree
// would pass for the wrong reason — on the copy, not on the kind-first form.
// Every case below writes its own tree, and the positive case writes ONLY the
// kind-first file.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { resolvePrerequisiteAbsolutePathWithFallback } from '../../../../src/services/artifacts/prerequisite-path-resolver.js';
import type { ArtifactPrerequisite } from '../../../../src/services/artifacts/artifact-prerequisites.js';

const SESSION_ID = '2026-10-28-session-2ffed0';
const RID = '2026-10-28-22-10-tag-push-base';
const OTHER_RID = '2026-10-28-22-10-another-slice';

const tempRoots: string[] = [];

function newSessionRoot(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-resolver-kind-first-'));
  tempRoots.push(projectRoot);
  const sessionRoot = join(projectRoot, '.peaks', '_runtime', SESSION_ID);
  mkdirSync(sessionRoot, { recursive: true });
  return sessionRoot;
}

function writeUnder(sessionRoot: string, relativePath: string, body = '# evidence\n'): void {
  const absolute = join(sessionRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

function securityPrereq(): ArtifactPrerequisite {
  return { relativePath: 'audit/security-<rid>.md', description: 'security audit' };
}

/** The basename the resolver matched, or null. `join()` yields backslashes on
 *  Windows, so compare on the separator-stripped tail rather than a prefix. */
function matchedName(found: string | null): string | null {
  return found === null ? null : (found.replace(/\\/g, '/').split('/').pop() ?? null);
}

async function resolve(sessionRoot: string, prereq: ArtifactPrerequisite, rid: string) {
  return matchedName(
    await resolvePrerequisiteAbsolutePathWithFallback(sessionRoot, null, prereq, rid)
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('(behavior) — the resolver reads the kind-first numbered form', () => {
  it('when only `security-003-<rid>.md` is on disk, should resolve it', async () => {
    // given: the kind-first form the request writer produces, and NOTHING else
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, `audit/security-003-${RID}.md`);

    // when: the bare rid path is resolved
    const found = await resolve(sessionRoot, securityPrereq(), RID);

    // then: the numbered-after-the-kind file is the evidence
    expect(found).toBe(`security-003-${RID}.md`);
  });

  it('when a kind-first name carries a different slug, should NOT claim it', async () => {
    // given: `security-backup-<rid>.md` — the kind plus a word before the rid
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, `audit/security-backup-${RID}.md`);

    // when: the bare rid path is resolved
    const found = await resolve(sessionRoot, securityPrereq(), RID);

    // then: a look-alike is not evidence, so the prereq stays unresolved
    expect(found).toBeNull();
  });

  it('when a kind-first numbered file belongs to another rid, should NOT claim it', async () => {
    // given: a valid kind-first shape for a DIFFERENT slice in the same directory
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, `audit/security-003-${OTHER_RID}.md`);

    // when: this slice's bare rid path is resolved
    const found = await resolve(sessionRoot, securityPrereq(), RID);

    // then: the other slice's evidence does not answer for this one
    expect(found).toBeNull();
  });
});

describe('(integration) — the pre-existing tiers keep their verdicts', () => {
  it('when the exact bare path is on disk, should still resolve it first', async () => {
    // given: both the exact path and a kind-first numbered sibling
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, `audit/security-${RID}.md`);
    writeUnder(sessionRoot, `audit/security-003-${RID}.md`);

    // when: the prereq is resolved
    const found = await resolve(sessionRoot, securityPrereq(), RID);

    // then: the exact path still wins — the legacy tiers are unchanged
    expect(found).toBe(`security-${RID}.md`);
  });

  it('when the number-first form is on disk, should still resolve it', async () => {
    // given: the `qa/test-cases/` shape, number FIRST, which already worked
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, `qa/test-cases/003-${RID}.md`);

    // when: the bare rid path is resolved
    const found = await resolve(
      sessionRoot,
      { relativePath: 'qa/test-cases/<rid>.md', description: 'test cases' },
      RID
    );

    // then: the number-first fallback is untouched by the kind-first addition
    expect(found).toBe(`003-${RID}.md`);
  });

  it('when only a legacy tier path is on disk, should still resolve it', async () => {
    // given: an artifact at its pre-rid legacy location, and no canonical file
    const sessionRoot = newSessionRoot();
    writeUnder(sessionRoot, 'rd/karpathy-review.md');

    // when: a prereq declaring that legacy tier is resolved
    const found = await resolve(
      sessionRoot,
      {
        relativePath: `rd/karpathy-review-<rid>.md`,
        legacyRelativePath: 'rd/karpathy-review.md',
        description: 'karpathy review'
      },
      RID
    );

    // then: the legacy tiers answer exactly as before
    expect(found).toBe('karpathy-review.md');
  });
});

declareDimensions(
  'tests/unit/services/artifacts/prerequisite-path-resolver-kind-first.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the resolver returns one path (or null); it renders no output of its own'
    },
    {
      dim: 'a11y',
      reason: 'no user-visible text or exit code is produced here; the transition gate prints it'
    }
  ]
);
