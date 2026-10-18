/**
 * tests/unit/hooks/pipeline-verify-type-derivation.test.ts
 *
 * rid `2026-10-16-type-tables-are-authoritative`. The COMMIT-TIME carrier's arms
 * for the request TYPE — the gap the checker's own suite could not close.
 *
 * THE DEFECT THESE ARMS EXIST FOR. `verifyPipeline` took the request type as an
 * option and fell back to `feature` when it was absent. The commit leg got it
 * right, because it reads the rid's own `- type:` line and passes the result;
 * `peaks workflow verify-pipeline` passed it only when a human typed `--type`, and
 * `slice-check` never passed it. So on ONE docs tree the two readers disagreed:
 * the CLI answered `complete: false` with three RD-evidence violations (measured
 * on `2026-10-16-readme-en-sync`), and the leg answered the contract satisfied.
 *
 * WHY THESE ARMS SPAWN THE REAL LEG rather than calling `verifyPipeline`. The
 * defect lived in the COMPOSITION — enumerate, resolve the type, ask the checker,
 * decide — and a unit arm that passes `requestType` explicitly is exactly the arm
 * that could not see it. This file drives `.husky/peaks-gate-pipeline.mjs` the way
 * `.husky/pre-commit` does.
 *
 * WHY IT IS A SIBLING AND NOT AN ARM IN `pipeline-contract-gate.test.ts`. A
 * measured budget, not taste: that file is 534 lines against the 500-line tests
 * cap, so it is already 34 lines over, and the staged-size leg refuses ANY growth
 * in an over-cap file a change set touches. Adding these arms there reddens
 * `tests/unit/lint/staged-size-leg.test.ts` before the commit that would carry
 * them. Its `writeCompleteRid` fixture also carries a QA artifact, so it was green
 * before this slice and cannot discriminate — these fixtures deliberately have no
 * QA phase at all.
 *
 * Dimensions: `render` is omitted — nothing here renders; the leg's own printed
 * lines are asserted under `a11y`, and its exit code is the behaviour.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { CARRIER_ROLES } from '../../../src/services/workflow/request-type-resolution.js';
import { extractMetadata } from '../../../src/services/artifacts/request-artifact-metadata.js';
import {
  DEFAULT_REQUEST_TYPE,
  isRequestType
} from '../../../src/services/artifacts/artifact-prerequisites.js';

/** The leg's own carrier list and type reader, loaded the way its arms load them —
 *  as a `.mjs` with no type information, so the shapes are declared here. */
const { CARRIER_DIRS, resolveRidType } = (await import(
  new URL('../../../.husky/pipeline/contract-verdict.mjs', import.meta.url).href
)) as {
  CARRIER_DIRS: readonly string[];
  resolveRidType: (
    path: string,
    isRequestType: (value: string) => boolean
  ) => { type: string | undefined; note: string | null };
};

declareDimensions(
  'tests/unit/hooks/pipeline-verify-type-derivation.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the leg renders nothing of its own: its verdict is an exit code and printed lines'
    }
  ]
);

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HOOK = join(ROOT, '.husky', 'peaks-gate-pipeline.mjs');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SESSION = 'sess-type-derivation';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * A throwaway project root with a REAL session binding, so the leg's own scope
 * resolution runs rather than being stubbed.
 */
function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-type-derivation-')));
  roots.push(root);
  write(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SESSION, createdAt: '2026-01-01T00:00:00.000Z', projectRoot: root })
  );
  return root;
}

/**
 * A request with a PRD, an RD artifact at `qa-handoff`, and NO QA phase — the
 * shape a docs/chore slice has, and the shape that used to be refused.
 *
 * `type: null` omits the `- type:` line, which is the leg's own fail-closed
 * posture and the control below.
 */
function writeRequest(
  root: string,
  name: string,
  type: string | null,
  state: string,
  role = 'rd'
): void {
  const typeLine = type === null ? '' : `- type: ${type}\n`;
  write(
    join(root, '.peaks', '_runtime', SESSION, role, 'requests', name),
    `# ${role.toUpperCase()} Request ${name}\n\n- session: ${SESSION}\n${typeLine}- state: ${state}\n`
  );
}

/**
 * Spawn the leg exactly as `.husky/pre-commit` does. `CLAUDE_CODE_SESSION_ID` and
 * `PEAKS_OUTER_SESSION_ID` are deleted so the arms resolve the fixture's own
 * binding on every host — this is a session-bound harness, and this host exports
 * the first of those while CI does not.
 */
function legsEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PEAKS_SKIP_PIPELINE_VERIFY;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.PEAKS_OUTER_SESSION_ID;
  return env;
}

function runLeg(cwd: string): { status: number | null; out: string } {
  const run = spawnSync('node', [TSX_CLI, HOOK], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: legsEnv()
  });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

describe(
  'Scenario: integration — the commit leg reads the rid type the checker derives',
  { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
  () => {
    it('when a docs rid has no QA phase, should pass the contract on its own declared type', () => {
      // given: a docs request that satisfies every row its table lists, and no QA
      //        artifact — the shape the CLI used to report incomplete
      // when:  the commit is attempted
      // then:  the leg passes, so the carrier and the checker agree on the type
      const root = makeRoot();
      writeRequest(root, '001-rid-docs-no-qa.md', 'docs', 'qa-handoff');
      const { status, out } = runLeg(root);

      expect(status, out).toBe(0);
      expect(out).toContain('artifact contract satisfied for 1 rid(s)');
      expect(out).not.toContain('QA phase skipped');
    });

    it('when the same docs rid declares no type, should refuse on the fail-closed default', () => {
      // given: the control that makes the arm above discriminate — the same tree,
      //        one line removed. Without a declared type there is nothing to
      //        derive, so the heaviest table applies and the QA phase is demanded
      // when:  the commit is attempted
      // then:  the refusal is the QA arm of the FEATURE table, which is what the
      //        CLI answered for a *typed* docs rid before this slice
      const root = makeRoot();
      writeRequest(root, '001-rid-docs-untyped.md', null, 'qa-handoff');
      const { status, out } = runLeg(root);

      expect(status).toBe(1);
      expect(out).toContain('QA phase skipped: peaks-qa was never invoked for this request');
      expect(out).not.toContain('artifact contract satisfied');
    });

    it('when a feature rid has no QA phase, should still refuse on the same two violations', () => {
      // given: a type whose table DOES carry a QA phase — the arm that proves the
      //        derivation narrowed nothing for the types that owe one
      // when:  the commit is attempted
      // then:  both QA violations, verbatim, whatever the type resolution does
      const root = makeRoot();
      writeRequest(root, '001-rid-feature-no-qa.md', 'feature', 'qa-handoff');
      const { status, out } = runLeg(root);

      expect(status).toBe(1);
      expect(out).toContain('QA phase skipped: peaks-qa was never invoked for this request');
      expect(out).toContain(
        'CRITICAL: peaks-rd was invoked but peaks-qa was NOT — QA functional/performance/security testing is mandatory after all RD work'
      );
    });

    it('when the leg enumerates carrier dirs, should read the same roles in the same order', () => {
      // given: two literals that must agree — the resolver's CARRIER_ROLES and the
      //        leg's CARRIER_DIRS. They cannot be one literal without src/ reading
      //        `.husky/`, which this tree forbids, so the equality is armed here
      //        rather than asserted in a comment on either side
      // when:  both are read
      // then:  same roles, same order — a reorder on either side reddens
      expect(CARRIER_ROLES.map((role) => `${role}/requests`)).toEqual([...CARRIER_DIRS]);
    });

    it('when the CLI is asked with no --type, should derive the type the leg derives', () => {
      // given: the second half of the same defect, and the one the carrier arms
      //        cannot see — the CLI's own `--type` option carried a `feature`
      //        DEFAULT, so `options.type` was always set and the checker never
      //        derived anything however the service was written
      // when:  the real CLI verifies a docs rid with no flag at all
      // then:  the envelope names the rid's own type and the pipeline completes,
      //        which is what `peaks workflow verify-pipeline --rid <rid>` prints
      const root = makeRoot();
      writeRequest(root, '001-rid-docs-no-qa.md', 'docs', 'qa-handoff');
      const run = spawnSync(
        'node',
        [
          join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          join(ROOT, 'src', 'cli', 'index.ts'),
          'workflow',
          'verify-pipeline',
          '--rid',
          'rid-docs-no-qa',
          '--project',
          root,
          '--json'
        ],
        { cwd: root, encoding: 'utf8', windowsHide: true, env: legsEnv() }
      );
      const envelope = JSON.parse((run.stdout ?? '').slice((run.stdout ?? '').indexOf('{'))) as {
        ok: boolean;
        data?: { requestType?: string; complete?: boolean };
      };

      expect(run.status, run.stderr ?? '').toBe(0);
      expect(envelope.ok).toBe(true);
      expect(envelope.data?.requestType).toBe('docs');
      expect(envelope.data?.complete).toBe(true);
    });

    it('when a skip-state is planted for a feature rid, should not satisfy the contract', () => {
      // given: a feature rid whose RD and QA phases both RAN and left no evidence
      //        behind — the shape a skip is most tempting for, and the one the
      //        measurement that found this used
      const root = makeRoot();
      writeRequest(root, '001-rid-feature-no-evidence.md', 'feature', 'qa-handoff');
      writeRequest(root, '001-rid-feature-no-evidence.md', 'feature', 'verdict-issued', 'qa');
      const before = runLeg(root);
      expect(before.status, before.out).toBe(1);
      expect(before.out).toContain('short of the contract');

      // when:  a skip-state appears. `applySkip`'s three rules never authorized it
      //        — the type is not skippable — and `isWorkflowSkipState` checks field
      //        PRESENCE only, so the file satisfies the shape and none of the rules
      write(
        join(root, '.peaks', '_runtime', SESSION, 'workflow-state', 'rid-feature-no-evidence.json'),
        `${JSON.stringify(
          {
            rid: 'rid-feature-no-evidence',
            skippedGates: ['RD', 'QA'],
            skipReason: 'planted by an arm, never by the writer',
            skipAppliedAt: '2026-01-01T00:00:00.000Z',
            skipAppliedBy: 'planted',
            callerKind: 'human'
          },
          null,
          2
        )}\n`
      );

      // then:  the refusals stand, byte for byte. The READ re-asserts the rule the
      //        WRITE enforced: only a request type the allowlist permits may skip.
      //        Before that, this file took the leg from exit 1 to exit 0.
      const after = runLeg(root);
      expect(after.status, after.out).toBe(1);
      expect(after.out).toContain('short of the contract');
      expect(after.out).not.toContain('artifact contract satisfied');
    });

    it('when a chore rid has no QA phase, should pass like the docs one', () => {
      // given: the other type the minimal table covers, and the type slice E of
      //        this sweep is planned to use
      // when:  the commit is attempted
      // then:  it passes, so a chore slice can reach a commit
      const root = makeRoot();
      writeRequest(root, '001-rid-chore-no-qa.md', 'chore', 'qa-handoff');
      const { status, out } = runLeg(root);

      expect(status, out).toBe(0);
      expect(out).toContain('artifact contract satisfied for 1 rid(s)');
    });
  }
);

/**
 * The parity corpus: every shape the two readers could disagree on, in one table.
 * `expected` is the answer BOTH must give — the src reader's rule, which the
 * commit leg reimplements because it has to load under bare `node`.
 */
const TYPE_CASES: ReadonlyArray<{ name: string; body: string; expected: string }> = [
  { name: 'a plain `- type: docs` line', body: '- type: docs\n', expected: 'docs' },
  { name: 'no type line at all', body: '', expected: DEFAULT_REQUEST_TYPE },
  {
    name: 'two lines, docs then feature',
    body: '- type: docs\n- type: feature\n',
    expected: 'feature'
  },
  {
    name: 'two lines, feature then docs',
    body: '- type: feature\n- type: docs\n',
    expected: 'docs'
  },
  {
    name: 'a usable line shadowed by an unusable one',
    body: '- type: docs\n- type: nonsense\n',
    expected: 'docs'
  },
  { name: 'a type line indented two spaces', body: '  - type: docs\n', expected: 'docs' },
  {
    name: 'an asterisk bullet instead of a hyphen',
    body: '* type: docs\n',
    expected: DEFAULT_REQUEST_TYPE
  },
  {
    name: 'trailing prose after the value',
    body: '- type: docs — because the change is documentation\n',
    expected: DEFAULT_REQUEST_TYPE
  },
  {
    name: 'a placeholder value',
    body: '- type: feature | bugfix | docs\n',
    expected: DEFAULT_REQUEST_TYPE
  }
];

describe('Scenario: behavior — the two type readers answer one rule', () => {
  for (const item of TYPE_CASES) {
    it(`when a carrier has ${item.name}, should answer ${item.expected} in both readers`, () => {
      // given: one carrier body, handed to the src reader and to the commit leg —
      //        the same text, so a disagreement can only be the rule
      // when:  each reader derives the request type from it
      // then:  both answer the same effective type, and both agree on whether the
      //        type was DECLARED rather than substituted
      const root = makeRoot();
      const path = join(root, 'carrier.md');
      const markdown = `# RD Request rid-x\n\n- session: ${SESSION}\n${item.body}`;
      write(path, markdown);

      const src = extractMetadata(markdown);
      const leg = resolveRidType(path, isRequestType);
      const legType = leg.type ?? DEFAULT_REQUEST_TYPE;

      expect(src.requestType, 'src reader').toBe(item.expected);
      expect(legType, 'commit leg').toBe(item.expected);
      expect(legType, 'the two readers agree').toBe(src.requestType);
      expect(src.requestTypeSource === 'declared', 'provenance agrees').toBe(
        leg.type !== undefined
      );
    });
  }
});
