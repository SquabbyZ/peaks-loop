// tests/unit/services/prd/handoff-writer-gate-convergence.test.ts
//
// Slice `2026-09-14-handoff-writer-gate-divergence`.
//
// The handoff capsule has TWO producers (`handoff-service.writeHandoff`,
// reached by `peaks prd handoff init`, and `handoff-auto-regen`) and FOUR
// consumers (`AUDIT_REQUIRES_HANDOFF`, the security + perf audit loaders, and
// `handoff-service`'s own reader/verifier). The producers disagreed about the
// same contract: `serializeHandoff` rendered the frontmatter through
// `yaml.stringify`, emitting `schemaVersion: "2"` + a bare `handoffHash:`,
// which the gate and both loaders all reject. `peaks prd handoff init`
// reported success and the very next gate reported the file missing.
//
// The fix is one shared serializer (`handoff-frontmatter.ts`), not a loosened
// gate: the two audit loaders match anchored regexes on an UNQUOTED
// `schemaVersion` and on a real `sha256:` FIELD, and no gate change can make
// them read `schemaVersion: "2"`. Loosening the gate would have produced a
// capsule the gate accepts and the audits still cannot read.
//
// Dimensions covered:
//   - render:      the emitted frontmatter shape (pinned plain scalars,
//                  quoting of everything else, key uniqueness, YAML-legal)
//   - behavior:    verify/read outcomes for the good and the broken capsule
//   - integration: a real temp `.peaks` tree, the REAL prereq registry, and
//                  BOTH real audit loaders
//   - a11y:        the failure-reason vocabulary a human reads on exit 1
//
// The AC5 control at the bottom is the point of the file: a capsule that is
// deliberately wrong must still be refused. "More inputs are accepted" is not
// evidence of a fix on its own.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  initHandoff,
  readHandoff,
  verifyHandoff,
  writeHandoff,
} from '../../../../src/services/prd/handoff-service.js';
import { autoRegenPrdHandoff } from '../../../../src/services/prd/handoff-auto-regen.js';
import { generateEvidence } from '../../../../src/services/evidence/evidence-generator.js';
import { getPrerequisitesFor } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { readAndVerifyHandoff as readSecurityHandoff } from '../../../../src/services/audit-independent/security-audit-service.js';
import { readAndVerifyHandoff as readPerfHandoff } from '../../../../src/services/audit-independent/perf-audit-service.js';

declareDimensions(
  'tests/unit/services/prd/handoff-writer-gate-convergence.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const SESSION_ID = '2026-09-14-session-probe';
const REQUEST_ID = '2026-09-14-probe';
const BODY = '# Request\n\nBody text that gets sha256-locked into the handoff.\n';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-handoff-convergence-'));
  tempRoots.push(root);
  return root;
}

function handoffPathOf(root: string): string {
  return join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md');
}

/** The `---`-delimited frontmatter, verbatim, without the delimiters. */
function frontmatterOf(handoff: string): string {
  const lines = handoff.split('\n');
  expect(lines[0]).toBe('---');
  const close = lines.indexOf('---', 1);
  expect(close).toBeGreaterThan(1);
  return lines.slice(1, close).join('\n');
}

/** The markers the REAL rd:qa-handoff gate pins on `prd/handoff.md`. Read
 *  from the registry rather than hardcoded, so this file fails if the gate's
 *  contract moves underneath it. */
function gateMarkers(): readonly string[] {
  const prereq = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
    (candidate) => candidate.relativePath === 'prd/handoff.md',
  );
  expect(prereq?.mustContain).toBeDefined();
  const markers = prereq?.mustContain ?? [];
  // Guarded here, once, because BOTH gate cases below assert inside a
  // `for…of` over this list: a loop over an empty collection asserts nothing,
  // so a `mustContain: []` regression would make them pass vacuously.
  expect(markers.length).toBeGreaterThan(0);
  return markers;
}

/** Write a capsule with `peaks prd handoff init`'s own writer. */
async function writeViaInit(root: string): Promise<string> {
  const handoff = initHandoff({
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    body: BODY,
    writtenAt: '2026-09-14T00:00:00.000Z',
    goals: ['G1', 'G2'],
    acceptanceCriteria: ['AC1'],
    preservedBehavior: [],
  });
  const written = await writeHandoff(handoff, root);
  return written.path;
}

/**
 * Write a capsule through the THIRD producer, `peaks evidence generate`. It was
 * still emitting the pre-fix shape (`handoffHash: sha256:<hex>`, no `^sha256:`
 * line, hash over `frontmatter + body`) after this slice unified the other two,
 * so the gate accepted a file both audit loaders refused.
 */
async function writeViaEvidenceGenerate(root: string, sessionId: string): Promise<string> {
  await generateEvidence({
    projectRoot: root,
    rid: REQUEST_ID,
    title: 'producer convergence probe',
    files: [],
    lineCounts: {},
    sessionId,
  });
  return handoffPathOf(root);
}

/** Write a capsule through the OTHER producer. Needs its own session dir —
 *  the auto-regen never overwrites an existing handoff. */
async function writeViaAutoRegen(root: string, sessionId: string): Promise<string> {
  const dir = join(root, '.peaks', '_runtime', sessionId, 'prd', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${REQUEST_ID}.md`), BODY, 'utf8');
  const result = await autoRegenPrdHandoff({
    projectRoot: root,
    sessionId,
    requestId: REQUEST_ID,
    role: 'prd',
  });
  expect(result.status).toBe('created');
  if (result.status !== 'created') throw new Error('unreachable');
  return result.path;
}

describe('(render) the canonical frontmatter shape', () => {
  it('should emit schemaVersion and sha256 as PLAIN scalars, and handoffHash as a YAML string', async () => {
    const root = makeProjectRoot();
    const raw = readFileSync(await writeViaInit(root), 'utf8');
    const frontmatter = frontmatterOf(raw);

    // The two scalars the gate matches as substrings and the loaders match as
    // anchored regexes. Both break the moment either is quoted.
    expect(frontmatter).toMatch(/^schemaVersion: 2$/m);
    expect(frontmatter).toMatch(/^sha256: [a-f0-9]{64}$/m);

    // handoffHash is the READER's field. It is parsed through YAML, so it has
    // to survive as a string even if a sha256 happened to be all digits.
    expect(typeof (parseYaml(frontmatter) as Record<string, unknown>).handoffHash).toBe('string');
  });

  it('should emit each frontmatter key exactly once, and parse as YAML', async () => {
    const root = makeProjectRoot();
    const frontmatter = frontmatterOf(readFileSync(await writeViaInit(root), 'utf8'));

    expect(() => parseYaml(frontmatter)).not.toThrow();
    const keys = frontmatter
      .split('\n')
      .filter((line) => /^[A-Za-z][A-Za-z0-9_]*:/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')));
    // Pinned as a SET, not merely counted: `new Set(keys).size === keys.length`
    // is satisfied by `keys = []`, so it could not fail on an empty or
    // truncated frontmatter. Comparing the sorted keys against the expected
    // list keeps the uniqueness claim (a duplicated key line would repeat an
    // entry) and supplies the non-emptiness the count never had.
    expect([...keys].sort()).toEqual([
      'acceptanceCriteria',
      'goals',
      'handoffHash',
      'handoffPath',
      'preservedBehavior',
      'requestId',
      'schemaVersion',
      'sessionId',
      'sha256',
      'writtenAt',
    ]);
  });

  it('should round-trip a Windows handoffPath without corrupting the backslashes', async () => {
    const root = makeProjectRoot();
    // `handoffPath` is a project-relative path, so on win32 it contains
    // backslashes — and a backslash is an escape character inside a YAML
    // double-quoted scalar. Quoting it is only safe because the escape is
    // emitted correctly.
    const handoff = await readHandoff(await writeViaInit(root));
    expect(handoff.frontmatter.handoffPath).toBe(
      join('.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'),
    );
  });
});

describe('(integration) every producer satisfies all four consumers', () => {
  const cases = [
    { name: 'peaks prd handoff init', make: writeViaInit },
    {
      name: 'handoff auto-regen',
      make: (root: string) => writeViaAutoRegen(root, `${SESSION_ID}-regen`),
    },
    {
      name: 'peaks evidence generate',
      make: (root: string) => writeViaEvidenceGenerate(root, SESSION_ID),
    },
  ] as const;

  for (const { name, make } of cases) {
    it(`should let the capsule written by ${name} pass the REAL rd:qa-handoff gate`, async () => {
      const root = makeProjectRoot();
      const raw = readFileSync(await make(root), 'utf8');
      for (const marker of gateMarkers()) {
        expect(raw).toContain(marker);
      }
    });

    it(`should let the capsule written by ${name} be parsed by BOTH audit loaders`, async () => {
      const root = makeProjectRoot();
      const path = await make(root);
      // `null` is the loaders' only failure signal — covering missing file,
      // missing sha256 field, and sha256 mismatch alike.
      expect(readSecurityHandoff(path, root)).not.toBeNull();
      expect(readPerfHandoff(path, root)).not.toBeNull();
    });

    it(`should let the capsule written by ${name} pass \`prd handoff verify\``, async () => {
      const root = makeProjectRoot();
      expect(await verifyHandoff(await make(root))).toEqual({
        ok: true,
        actualHash: expect.any(String),
        expectedHash: expect.any(String),
      });
    });
  }
});

describe('(behavior) the reader still accepts what is already on disk', () => {
  it('should keep reading a hand-written capsule with a BARE schemaVersion and a prefixed hash', async () => {
    const root = makeProjectRoot();
    const path = handoffPathOf(root);
    mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    // The shape ONE capsule in this repo was hand-corrected into
    // (`2026-09-13-session-21878f`): a BARE `schemaVersion: 2` and a `sha256:`
    // PREFIX inside the handoffHash value rather than a separate `sha256:`
    // field. `2026-09-06-session-a87ca4` carries the same two traits but is
    // CRLF-terminated and an older shape, so `readHandoff` refuses it; this
    // fixture is deliberately the readable variant. Fixing the writer must
    // not make it unreadable.
    writeFileSync(
      path,
      [
        '---',
        `requestId: ${REQUEST_ID}`,
        `sessionId: ${SESSION_ID}`,
        'schemaVersion: 2',
        `handoffHash: sha256:${'a'.repeat(64)}`,
        'writtenAt: 2026-09-14T00:00:00.000Z',
        'goals: []',
        'acceptanceCriteria: []',
        'preservedBehavior: []',
        'handoffPath: prd/handoff.md',
        '---',
        BODY,
      ].join('\n'),
      'utf8',
    );

    const handoff = await readHandoff(path);
    expect(handoff.frontmatter.schemaVersion).toBe('2');
    expect(handoff.body).toBe(BODY);
  });
});

describe('(a11y) the failure reasons a human reads on exit 1', () => {
  it('should keep `file-missing` for a file that is genuinely absent', async () => {
    const root = makeProjectRoot();
    expect(await verifyHandoff(handoffPathOf(root))).toEqual({
      ok: false,
      reason: 'file-missing',
    });
  });

  it('should report `hash-mismatch` — not `file-missing` — for a capsule whose body was changed', async () => {
    const root = makeProjectRoot();
    const path = await writeViaInit(root);
    writeFileSync(path, readFileSync(path, 'utf8') + '\ntampered\n', 'utf8');

    const probe = await verifyHandoff(path);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe('hash-mismatch');
  });
});

// ---------------------------------------------------------------------------
// AC5 — the clean control group.
//
// Every assertion above says "this input is now accepted"; on its own that is
// satisfied by a gate that accepts everything. These capsules are deliberately
// wrong in exactly the ways the fix could have papered over.
// ---------------------------------------------------------------------------
describe('(integration) AC5 control — a deliberately broken capsule is still refused', () => {
  /** Take the real output and re-quote `schemaVersion` + drop the `sha256`
   *  FIELD, which is precisely what the pre-fix writer produced. */
  function breakLikeTheOldWriter(raw: string): string {
    return raw
      .replace(/^schemaVersion: 2$/m, 'schemaVersion: "2"')
      .replace(/^sha256: [a-f0-9]{64}$/m, '');
  }

  it('should refuse the pre-fix writer shape at the gate', async () => {
    const root = makeProjectRoot();
    const broken = breakLikeTheOldWriter(readFileSync(await writeViaInit(root), 'utf8'));

    // The gate must still say no. If this starts passing, the fix regressed
    // into "accept whatever the writer happens to emit".
    for (const marker of gateMarkers()) {
      expect(broken).not.toContain(marker);
    }
  });

  it('should refuse the pre-fix writer shape at BOTH audit loaders', async () => {
    const root = makeProjectRoot();
    const path = await writeViaInit(root);
    const brokenPath = join(root, 'broken.md');
    writeFileSync(brokenPath, breakLikeTheOldWriter(readFileSync(path, 'utf8')), 'utf8');

    // This is the half a loosened gate could never have fixed: anchored
    // regexes, not substrings.
    expect(readSecurityHandoff(brokenPath, root)).toBeNull();
    expect(readPerfHandoff(brokenPath, root)).toBeNull();
  });

  it('should refuse a capsule whose handoffHash does not match its body', async () => {
    const root = makeProjectRoot();
    const path = await writeViaInit(root);
    const brokenPath = join(root, 'wrong-hash.md');
    writeFileSync(
      brokenPath,
      readFileSync(path, 'utf8').replace(/^sha256: [a-f0-9]{64}$/m, `sha256: ${'b'.repeat(64)}`),
      'utf8',
    );

    // The loaders recompute the body hash; the gate does not. They must agree
    // that this capsule is unusable.
    expect(readSecurityHandoff(brokenPath, root)).toBeNull();
    expect(readPerfHandoff(brokenPath, root)).toBeNull();
  });
});
