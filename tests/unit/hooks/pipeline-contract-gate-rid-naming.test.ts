// tests/unit/hooks/pipeline-contract-gate-rid-naming.test.ts
//
// The pre-commit leg must enumerate the id the STATE MACHINE holds, not a
// four-digit-prefixed one. Measured at HEAD 802862b9 on this very session: its
// `rd/requests/` holds nothing but bare date-shaped names, `getNextNumber` read the
// leading year as a file number, and a freshly written request landed as
// `2027-<rid>.md` — an artifact whose filename id was `2027-<rid>` while every other
// reader, and the state machine, knew the request as `<rid>`.
//
// WHY THIS IS A SIBLING FILE AND NOT A CASE IN `pipeline-contract-gate.test.ts`.
// That file sits at 534 raw lines against the 500-line root-`tests/` cap, and the
// per-file size gate refuses growth in a file already over its cap. A case that
// cannot be added is not a case that can be skipped, so it lands here, in the same
// directory, over the same two modules and the same seam.
//
// WHAT ONLY THIS FILE CAN SHOW. The writer is the REAL `request init` action, not a
// hand-written fixture: the defect is a disagreement between the CLI's writer and the
// leg's reader, and a fixture would let this pass against a filename the CLI does not
// produce. The directory is the shape the trap fires in — nothing but date-shaped
// names — because the same scenario in a directory of `001-` … `008-` answers
// correctly and proves nothing.
//
// Dimensions covered:
//   - integration: the real CLI writer, the session binding, and the leg's own
//                  enumeration over a real tmp project tree
//   - render:      OMITTED — nothing is printed; the subject is the id set the leg
//                  decides over, which the sibling file renders end to end
//   - behavior:    OMITTED — no branch of the verdict is exercised; the refusal and
//                  the exemption are pinned in pipeline-contract-gate.test.ts
//   - a11y:        OMITTED — no line is read by a human here; the leg's output is
//                  the sibling file's subject
//
// Run with: pnpm exec vitest run tests/unit/hooks/pipeline-contract-gate-rid-naming.test.ts

import { Command } from 'commander';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { registerRequestCommands } from '../../../src/cli/commands/request-commands.js';

declareDimensions(
  'tests/unit/hooks/pipeline-contract-gate-rid-naming.test.ts',
  ['integration'],
  [
    {
      dim: 'render',
      reason: 'the sibling file renders the leg end to end; this one asserts the id set'
    },
    {
      dim: 'behavior',
      reason: 'the verdict branches are pinned in tests/unit/hooks/pipeline-contract-gate.test.ts'
    },
    {
      dim: 'a11y',
      reason: 'no human reads a line here; the leg output is the sibling file subject'
    }
  ]
);

type Carriers = {
  carriers: Map<string, { rank: number; path: string }>;
  failures: string[];
};

const verdictModule = (await import(
  new URL('../../../.husky/pipeline/contract-verdict.mjs', import.meta.url).href
)) as {
  collectRids: (sessionDir: string, deriveId: (name: string) => string | null) => Carriers;
};
const legModule = (await import(
  new URL('../../../.husky/peaks-gate-pipeline.mjs', import.meta.url).href
)) as {
  loadPeaks: () => Promise<{ requestIdFromFileName: (name: string) => string | null }>;
};

/** Exactly the seam the leg uses: the composition `loadPeaks` builds, not a copy. */
const { requestIdFromFileName: deriveId } = await legModule.loadPeaks();

const SESSION = '2026-10-16-rid-naming';
const NEW_RID = '2026-10-16-artifact-carrier-traps';

/** The shape this session's own `rd/requests` holds: nothing but date-shaped names. */
const DATE_SHAPED = [
  '2026-10-15-macos-ledger-reaper',
  '2026-10-15-best-practice-real-context7',
  '2026-10-16-readme-en-sync'
];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A bound session whose `rd/requests` holds only bare date-shaped rids. */
function makeSession(): { root: string; requestsDir: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-rid-naming-')));
  roots.push(root);
  write(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({
      sessionId: SESSION,
      createdAt: '2026-01-01T00:00:00.000Z',
      projectRoot: root
    })
  );
  const requestsDir = join(root, '.peaks', '_runtime', SESSION, 'rd', 'requests');
  for (const rid of DATE_SHAPED) {
    write(
      join(requestsDir, `${rid}.md`),
      `# RD Request ${rid}\n\n- session: ${SESSION}\n- type: feature\n- state: draft\n`
    );
  }
  return { root, requestsDir };
}

/** The REAL writer: `peaks request init`, in-process, into the session above. */
async function initRequest(root: string, rid: string): Promise<void> {
  const { io } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerRequestCommands(program, io);
  await program.parseAsync(
    [
      'request',
      'init',
      '--role',
      'rd',
      '--id',
      rid,
      '--project',
      root,
      '--session-id',
      SESSION,
      '--apply',
      '--json'
    ],
    { from: 'user' }
  );
}

describe('Scenario: the leg enumerates the id the state machine holds', () => {
  it('when a fresh request lands in a date-shaped directory, should not enumerate a year-prefixed id', async () => {
    // given: a session holding only bare date-shaped rids
    const { root } = makeSession();

    // when: the real writer numbers a fresh request and the leg enumerates the dir
    await initRequest(root, NEW_RID);
    const found = verdictModule.collectRids(join(root, '.peaks', '_runtime', SESSION), deriveId);
    const ids = [...found.carriers.keys()];

    // then: the id set is exactly the four rids the state machine knows. Before the
    //       prefix family was shared this read `2027-...`, an id nothing else held.
    expect(found.failures).toEqual([]);
    expect(ids).toEqual([...DATE_SHAPED, NEW_RID].sort());
    // A bare date-shaped rid legitimately OPENS with four digits, so the boundary
    // is not the digit count — it is the writer's prefix, which the pre-fix reader
    // built out of the year and left on the id.
    expect(ids.some((id) => id.startsWith('2027-'))).toBe(false);
  });

  it('when the writer names a file, should spell the prefix the reader strips', async () => {
    // given: the same session, and the artifact the writer just produced
    const { root, requestsDir } = makeSession();

    // when: the filename it chose is read back through the leg's own reader
    await initRequest(root, NEW_RID);
    const written =
      readdirSync(requestsDir)
        .sort()
        .find((name) => name.endsWith(`${NEW_RID}.md`)) ?? '';

    // then: the prefix is in the family the reader strips, so the id survives —
    //       the round trip the pre-commit artifact contract depends on
    expect(written).toBe(`001-${NEW_RID}.md`);
    expect(deriveId(written)).toBe(NEW_RID);
    // and the sibling files, which carry no prefix at all, are untouched
    expect(deriveId('2026-10-15-macos-ledger-reaper.md')).toBe('2026-10-15-macos-ledger-reaper');
  });
});
