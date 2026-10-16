// tests/unit/services/artifacts/judged-declaration-refusal-names-unmet.test.ts
//
// A refusal must name the requirement that is UNMET, not the path that is merely
// absent. Measured at HEAD 802862b9: a security-audit artifact that satisfied every
// published content marker and carried no `## Judged content` declaration was
// reported by `rd:qa-handoff` as `1 required artifact(s) missing` with the action
// line `Produce .peaks/_runtime/<sid>/audit/security-<rid>.md: Judged declaration
// declaration-missing at audit/security-<rid>.md`. The file was there. A producer
// that did exactly what the refusal said — produce that artifact — changed nothing,
// and the round trip ended one refusal later than it needed to.
//
// WHAT IS PINNED, and what is deliberately NOT. The `missing[]` entry is the gate's
// public payload: `data.missing[0].path` still names the ARTIFACT (so the
// path-keyed assertions in `audit-artifact-rid-scoping.test.ts` keep reading it),
// and the refusal CODE is untouched — `PREREQUISITES_MISSING` here, and
// `declaration-missing` inside the description, because both are published
// constants other readers match on. Only the two sentences that asserted absence
// change: the summary, and the per-entry verb.
//
// THE FIXTURE WRITES EVERY OTHER `rd:qa-handoff` ROW, for the reason the sibling
// fixture gives: an assertion on `missing[0]` is only about the declaration if the
// declaration is the FIRST unmet requirement. A partial set would put some other
// row's path at index 0 and this file would pass while proving nothing.
//
// Dimensions covered:
//   - a11y:        the four sentences a producer reads on a refusal
//   - render:      the `missing[]` envelope shape
//   - integration: a real CLI action over a real session tree
//   - behavior:    OMITTED — the declaration check's own accept/refuse branches are
//                  pinned in tests/unit/services/audit-independent/judged-declaration.test.ts
//
// Run with: pnpm exec vitest run tests/unit/services/artifacts/judged-declaration-refusal-names-unmet.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import {
  JUDGED_FIXTURE_PATH,
  judgedDeclarationSection,
  writeJudgedFixtureSource
} from './_judged-declaration-fixture.js';
import { registerRequestCommands } from '../../../../src/cli/commands/request-commands.js';

declareDimensions(
  'tests/unit/services/artifacts/judged-declaration-refusal-names-unmet.test.ts',
  ['a11y', 'render', 'integration'],
  [
    {
      dim: 'behavior',
      reason:
        'the declaration check itself is pinned in tests/unit/services/audit-independent/judged-declaration.test.ts; this file is about the sentences the gate adds around its refusal'
    }
  ]
);

const SESSION_ID = '2026-10-16-declaration-refusal';
const RID = '2026-10-16-declaration-probe';
const SECURITY_PATH = `audit/security-${RID}.md`;

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

type MissingEntry = { path: string; description: string };

type Envelope = {
  ok: boolean;
  code?: string;
  message?: string;
  data: { missing?: MissingEntry[]; warnings?: Array<{ path: string }> };
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, relative: string, body: string): void {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/**
 * Every `rd:qa-handoff` row of the BUGFIX table, on disk, with ONE substitution:
 * the security audit satisfies `AUDIT_SECURITY` and carries no `## Judged content`
 * block. The two back-compat rows (third-party review, mutation report) are left
 * absent on purpose — absent there is a warning, not a `missing` entry, and the
 * warnings list is asserted separately.
 */
function seedEverythingButTheDeclaration(): string {
  const root = realRoot();
  write(
    root,
    `rd/requests/${RID}.md`,
    `# RD Request ${RID}\n\n- session: ${SESSION_ID}\n- type: bugfix\n- state: implemented\n`
  );
  write(root, 'prd/handoff.md', '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n');
  write(
    root,
    `rd/bug-analysis-${RID}.md`,
    '# Bug analysis\n\n## Root cause\n\nThe prefix family was not shared.\n\n## Fix approach\n\nShare it.\n'
  );
  write(root, `rd/code-review-${RID}.md`, '## Findings\n\nCRITICAL: none.\n');
  write(
    root,
    `rd/karpathy-review-${RID}.md`,
    [
      '## Karpathy-Gate',
      '',
      '## Think Before Coding',
      '## Simplicity First',
      '## Surgical Changes',
      '## Goal-Driven Execution',
      ''
    ].join('\n')
  );
  write(root, `qa/test-cases/${RID}.md`, "## Test cases\n\nit('x', () => {});\n");
  write(root, 'qa/.initiated', '');
  write(root, `audit/perf-${RID}.md`, `# Performance audit — ${RID}\n\n## Baseline\n\nnone\n`);
  // The substitution: markers satisfied, declaration absent.
  write(root, SECURITY_PATH, `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n`);
  return root;
}

function realRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-declaration-refusal-'));
  roots.push(root);
  return root;
}

async function transition(root: string, json: boolean): Promise<CapturedIo> {
  const argv = [
    'request',
    'transition',
    RID,
    '--role',
    'rd',
    '--state',
    'qa-handoff',
    '--project',
    root,
    '--session-id',
    SESSION_ID
  ];
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerRequestCommands(program, io);
  try {
    await program.parseAsync(json ? [...argv, '--json'] : argv, { from: 'user' });
  } catch {
    // `exitOverride` re-throws what `process.exitCode` already carries.
  }
  return captured;
}

function envelopeOf(captured: CapturedIo): Envelope {
  return JSON.parse(captured.text().trim()) as Envelope;
}

describe('Scenario: render — the refusal still names the artifact, and the code is not renamed', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('when the audit carries no declaration, should keep the artifact path on missing[0] and the published code', async () => {
    // given: a session satisfying every other rd:qa-handoff row
    const root = seedEverythingButTheDeclaration();

    // when: the handoff is attempted
    const envelope = envelopeOf(await transition(root, true));

    // then: it is refused under the published code, and the payload still keys on
    //       the path the path-keyed readers of this same field match on
    expect(process.exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PREREQUISITES_MISSING');
    expect(envelope.data.missing?.[0]?.path).toBe(SECURITY_PATH);
    // and the two back-compat rows stay warnings rather than missing entries
    expect(envelope.data.warnings?.map((w) => w.path)).toContain('mut/mut-report.json');
  });
});

describe('Scenario: a11y — the refusal names the unmet declaration, not an absent path', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('when the artifact exists but the declaration does not, should say so on the entry and in the summary', async () => {
    // given: the same session
    const root = seedEverythingButTheDeclaration();

    // when: the refusal is asked for a machine-readable envelope
    const envelope = envelopeOf(await transition(root, true));

    // then: the description names the declaration by its own literal heading and
    //       states that the artifact is present
    const description = envelope.data.missing?.[0]?.description ?? '';
    expect(description).toContain('## Judged content');
    expect(description).toContain('declaration-missing');
    expect(description).toContain('the artifact is present');
  });

  it('when the refusal is read as text, should not assert that an artifact is missing', async () => {
    // given: the same session, read on the human arm
    const root = seedEverythingButTheDeclaration();

    // when: the transition is attempted without --json
    const printed = (await transition(root, false)).stderrText();

    // then: the summary claims no absent artifact — it names an unmet requirement
    expect(printed).not.toMatch(/required artifact\(s\) missing/);
    expect(printed).toContain('unmet requirement');
    // and the per-entry line carries a verb true of BOTH an absent and an
    // unsatisfied path. `Produce` was true of only the first, and a producer that
    // obeyed it produced a file that was already there.
    expect(printed).toContain(`- Satisfy ${SECURITY_PATH}:`);
    expect(printed).not.toContain('- Produce ');
    // the declaration is still named, so the verb change did not cost the content
    expect(printed).toContain('## Judged content');
    // and the closing line no longer claims existence is the whole requirement
    expect(printed).toContain('Once every unmet requirement above is met');
  });

  it('when every row is satisfied AND the declaration is present, should drop that refusal — the control', async () => {
    // given: the same session, plus the declaration block the audit CLI writes —
    //        the grammar, the file and the hash all coming from the shared fixture
    //        rather than re-derived here
    const root = seedEverythingButTheDeclaration();
    writeJudgedFixtureSource(root);
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n${judgedDeclarationSection()}`
    );

    // when: the handoff is attempted again
    const envelope = envelopeOf(await transition(root, true));

    // then: NO requirement is unmet, and the assertion is keyed on the PATH rather
    //       than on a phrase: a phrase-keyed control would pass while the check
    //       refused for a code whose sentence does not carry that phrase, which is
    //       exactly what the `declared-path-*` class below produces
    expect(envelope.data.missing ?? []).toEqual([]);
    expect((envelope.data.missing ?? []).some((entry) => entry.path === SECURITY_PATH)).toBe(false);
  });
});

describe('Scenario: behavior — the sentence follows the CODE, not just the refusal', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  /** A session whose declaration is present, parses, and whose declared file moved. */
  function seedDeclarationThatNoLongerHolds(): string {
    const root = seedEverythingButTheDeclaration();
    writeJudgedFixtureSource(root);
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n${judgedDeclarationSection()}`
    );
    // The declared file is rewritten after the declaration is stamped, which is the
    // repair-after-audit shape `declared-path-modified` exists to refuse.
    writeFileSync(join(root, ...JUDGED_FIXTURE_PATH.split('/')), 'export const fixture = 2;\n');
    return root;
  }

  it('when the declaration parsed and a declared path moved, should say so instead of asking for the block again', async () => {
    // given: a valid declaration over a file that no longer matches its hash
    const root = seedDeclarationThatNoLongerHolds();

    // when: the handoff is attempted
    const envelope = envelopeOf(await transition(root, true));
    const entry = envelope.data.missing?.[0];

    // then: the refusal is the tree mismatch, and the sentence says the declaration
    //       IS there and parses — one sentence for every code told a producer to
    //       satisfy a declaration the check had already read
    expect(entry?.path).toBe(SECURITY_PATH);
    const description = entry?.description ?? '';
    expect(description).toContain('declared-path-modified');
    expect(description).toContain('the tree compared against it');
    expect(description).not.toContain('## Judged content');
  });

  it('when the heading is there but no fenced block follows it, should name the block — not the tree', async () => {
    // given: the heading alone, which is the other arm of the block class and the
    //        shape a carrier that only named `## Judged content` would invite
    const root = seedEverythingButTheDeclaration();
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n\n## Judged content\n\nnone\n`
    );

    // when: the handoff is attempted
    const description =
      envelopeOf(await transition(root, true)).data.missing?.[0]?.description ?? '';

    // then: the code says the block is not one the check can accept, and the
    //       sentence names the block rather than a path that is already there
    expect(description).toContain('declaration-unfenced');
    expect(description).toContain('## Judged content');
    expect(description).toContain('not one this check can accept');
  });

  it('when a declared path cannot be read, should name a hash it does not have rather than prescribe a re-run', async () => {
    // given: a valid declaration over a path that is PRESENT and unreadable — a
    //        directory standing at the declared name. `readFileSync` answers EISDIR
    //        for it here and on POSIX; EACCES, EPERM and a locked Windows share
    //        reach the SAME branch, because `sha256OfFile` maps every code but
    //        ENOENT to `unreadable`. None of those is forceable portably in a unit
    //        test, so this is the forcing function for the arm.
    const root = seedEverythingButTheDeclaration();
    writeJudgedFixtureSource(root);
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n${judgedDeclarationSection()}`
    );
    const declared = join(root, ...JUDGED_FIXTURE_PATH.split('/'));
    rmSync(declared);
    mkdirSync(declared);

    // when: the handoff is attempted
    const envelope = envelopeOf(await transition(root, true));
    const entry = envelope.data.missing?.[0];
    const description = entry?.description ?? '';

    // then: the sentence names the state this check actually established — a hash it
    //       does NOT have — and prescribes the remedy that works. "Re-run the
    //       producer" does not: the producer hashes the same path and refuses with
    //       the identical code, so the old third-group sentence sent its reader in a
    //       circle.
    expect(entry?.path).toBe(SECURITY_PATH);
    expect(description).toContain('declared-path-unreadable');
    expect(description).toContain('present and unreadable');
    expect(description).toContain('hash is unknown');
    expect(description).not.toContain('re-run the producer');
    // and the control: the arm a re-run DOES resolve still carries that advice
    expect(description).not.toContain('no longer matches the tree');
  });

  it('when a declared root could not be listed, should not claim a tree it never read', async () => {
    // given: a valid declaration, a declared file whose hash MATCHES byte-for-byte,
    //        and a project root that is not a git repository — so `listTreeFiles`'s
    //        `execFileSync('git', …)` throws and `root-listing-failed` fires
    const root = mkdtempSync(join(tmpdir(), 'peaks-rl-refusal-'));
    roots.push(root);
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    const source = 'export const judged = 1;\n';
    writeFileSync(join(root, 'src', 'a.ts'), source, 'utf8');
    const { createHash } = await import('node:crypto');
    const declaration = {
      schemaVersion: 1,
      judgedAt: '2026-09-13T00:00:00.000Z',
      handoffHash: 'deadbeef',
      files: [{ path: 'src/a.ts', sha256: createHash('sha256').update(source).digest('hex') }],
      roots: [{ path: 'src', why: 'package source' }]
    };
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n\n## Judged content\n\n\`\`\`json\n${JSON.stringify(declaration)}\n\`\`\`\n`
    );

    // when: the declaration is checked directly — the gate needs a whole session,
    //       and the code under test is the sentence, not the walk to it
    const { describeJudgedRefusal, verifyJudgedDeclaration } =
      await import('../../../../src/services/audit-independent/judged-declaration-check.js');
    const refusals = verifyJudgedDeclaration({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: RID
    }).refusals;
    const refusal = refusals[0];

    // then: the code fires, and the sentence names what actually happened — a root
    //       that could not be LISTED — instead of asserting a tree comparison that
    //       was never made. The declared hash still matches; nothing moved.
    expect(refusal?.code).toBe('root-listing-failed');
    const description = describeJudgedRefusal(refusal!);
    expect(description).toContain('could not be listed');
    expect(description).not.toContain('no longer matches the tree');
    // and the remedy it names is the one that works: the producer declares no roots
    // at all, so a fresh declaration cannot take this branch again
    expect(description).toContain('re-run the producer');
  });

  it('when a root was listed and a path under it is undeclared, should say the two disagree, not that a claim moved', async () => {
    // given: a REAL git repository whose declared root holds one file the
    //        declaration names and one it does not — so the listing SUCCEEDS and
    //        `undeclared-path-under-root` fires, with the declared hash byte-identical
    const root = mkdtempSync(join(tmpdir(), 'peaks-undeclared-refusal-'));
    roots.push(root);
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    const declaredBody = 'export const declared = 1;\n';
    writeFileSync(join(root, 'src', 'a.ts'), declaredBody, 'utf8');
    writeFileSync(join(root, 'src', 'b.ts'), 'export const undeclared = 2;\n', 'utf8');
    execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
    const { createHash } = await import('node:crypto');
    const payload = {
      schemaVersion: 1,
      judgedAt: '2026-09-13T00:00:00.000Z',
      handoffHash: 'deadbeef',
      files: [
        { path: 'src/a.ts', sha256: createHash('sha256').update(declaredBody).digest('hex') }
      ],
      roots: [{ path: 'src', why: 'package source' }]
    };
    write(
      root,
      SECURITY_PATH,
      `# Security audit — \`${RID}\`\n\n## Verdict\n\nwarn\n\n## Judged content\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`
    );

    // when: the declaration is checked
    const { describeJudgedRefusal, verifyJudgedDeclaration } =
      await import('../../../../src/services/audit-independent/judged-declaration-check.js');
    const refusal = verifyJudgedDeclaration({
      projectRoot: root,
      sessionId: SESSION_ID,
      requestId: RID
    }).refusals[0];

    // then: this code DID complete its observation, and its sentence says the two
    //       DISAGREE. The arm it used to sit in said "a claim inside it … no longer
    //       matches the tree" — but no claim inside the block was wrong; the block
    //       was incomplete, and the module's own LIMIT paragraph says a declaration
    //       is never a claim that its paths are all the paths.
    expect(refusal?.code).toBe('undeclared-path-under-root');
    const description = describeJudgedRefusal(refusal!);
    expect(description).toContain('the tree compared against it');
    expect(description).not.toContain('a claim inside it');
  });

  it('when a code this check does not know is described, should assert no observation — the fail-safe', async () => {
    // given: a code neither module emits — the shape a future edit would add
    const { describeJudgedRefusal } =
      await import('../../../../src/services/audit-independent/judged-declaration-check.js');

    // when: its sentence is composed
    const description = describeJudgedRefusal({
      code: 'declared-path-brand-new',
      artifact: SECURITY_PATH,
      path: 'src/a.ts'
    });

    // then: it claims only what is certain. The partition is exhaustive over the 17
    //       shipped codes, so this arm is unreachable today; it exists so a NEW code
    //       cannot inherit an observation it did not make — the failure this slice
    //       recorded four times, once per member.
    expect(description).not.toContain('no longer matches');
    expect(description).not.toContain('the tree compared against it');
    expect(description).toContain('unverified');
  });
});
