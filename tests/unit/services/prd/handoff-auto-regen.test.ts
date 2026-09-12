// tests/unit/services/prd/handoff-auto-regen.test.ts
//
// Guards the frontmatter `autoRegenPrdHandoff` writes (slice S1 of
// rid-2026-09-12-defect-remediation).
//
// The defect this file exists for: the frontmatter was built as a
// hand-concatenated array of `key: value` strings, and `sessionId`
// appeared TWICE. Duplicate YAML keys are not a cosmetic wart — the
// repo's own `yaml` (2.9.0) parser rejects the document outright with
// "Map keys must be unique", and `readHandoff` (behind
// `peaks prd handoff show|verify`) parses that frontmatter through
// exactly that parser. `AUDIT_REQUIRES_HANDOFF` only does a SUBSTRING
// check, so the broken handoff sailed past the prereq gate and blew up
// one step later, on the next YAML-aware reader.
//
// The `yaml.parse` assertion below is the one that fails against the
// duplicate-key version of this module; the occurrence-count assertion
// pins the cause rather than the symptom.
//
// Dimensions covered:
//   - render:      the emitted frontmatter parses as YAML and its keys
//                  are unique
//   - behavior:    created / skipped-exists / failed outcomes
//   - integration: a real temp `.peaks` tree, read through the real
//                  request-artifact service
//   - a11y:        omitted — the helper returns an envelope, it prints
//                  nothing

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { autoRegenPrdHandoff } from '../../../../src/services/prd/handoff-auto-regen.js';
import { readHandoff, verifyHandoff } from '../../../../src/services/prd/handoff-service.js';
import { getPrerequisitesFor } from '../../../../src/services/artifacts/artifact-prerequisites.js';

declareDimensions(
  'tests/unit/services/prd/handoff-auto-regen.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'returns a result envelope; prints nothing' }],
);

const SESSION_ID = '2026-09-12-session-e37ef0';
const REQUEST_ID = '2026-09-12-defect-remediation';
const BODY = '# Request\n\nBody text that gets sha256-locked into the handoff.\n';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-handoff-regen-'));
  tempRoots.push(root);
  return root;
}

function seedRequestArtifact(projectRoot: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${REQUEST_ID}.md`), BODY, 'utf8');
}

function handoffPathOf(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md');
}

/** The `---`-delimited frontmatter, verbatim, without the delimiters. */
function frontmatterOf(handoff: string): string {
  const lines = handoff.split('\n');
  expect(lines[0]).toBe('---');
  const close = lines.indexOf('---', 1);
  expect(close).toBeGreaterThan(1);
  return lines.slice(1, close).join('\n');
}

describe('autoRegenPrdHandoff frontmatter', () => {
  it('should emit frontmatter that the repo’s own YAML parser accepts', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    const result = await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    expect(result.status).toBe('created');

    const frontmatter = frontmatterOf(readFileSync(handoffPathOf(projectRoot), 'utf8'));

    // Before the fix this threw: "Map keys must be unique".
    expect(() => parseYaml(frontmatter)).not.toThrow();

    const parsed = parseYaml(frontmatter) as Record<string, unknown>;
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.requestId).toBe(REQUEST_ID);
    expect(parsed.schemaVersion).toBe(2);
    expect(typeof parsed.sha256).toBe('string');
  });

  it('should write each frontmatter key exactly once', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    const frontmatter = frontmatterOf(readFileSync(handoffPathOf(projectRoot), 'utf8'));
    const keys = frontmatter
      .split('\n')
      .filter((line) => /^[A-Za-z][A-Za-z0-9_]*:/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')));

    expect(keys.filter((key) => key === 'sessionId')).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should keep the prereq substring contract (`schemaVersion: 2` and `sha256:`)', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    const handoff = readFileSync(handoffPathOf(projectRoot), 'utf8');
    expect(handoff).toContain('schemaVersion: 2');
    expect(handoff).toContain('sha256:');
    // The request body is the handoff body, unmodified.
    expect(handoff).toContain(BODY);
  });

  it('should not overwrite an existing handoff', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);
    const handoffPath = handoffPathOf(projectRoot);
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    writeFileSync(handoffPath, 'canonical\n', 'utf8');

    const result = await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    expect(result.status).toBe('skipped-exists');
    expect(readFileSync(handoffPath, 'utf8')).toBe('canonical\n');
  });

  it('should fail (not throw) when the request artifact is missing', async () => {
    const projectRoot = makeProjectRoot();
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests'), { recursive: true });

    const result = await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    expect(result.status).toBe('failed');
    expect(existsSync(handoffPathOf(projectRoot))).toBe(false);
  });

  it('should refuse a non-prd role without touching the disk', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    const result = await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'qa',
    });

    expect(result).toEqual({ status: 'failed', reason: 'role must be prd' });
    expect(existsSync(handoffPathOf(projectRoot))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// N1 — the handoff the auto-regen writes must survive the repo's OWN verifier.
//
// The duplicate-key defect above was fixed by writing valid YAML. Valid YAML
// was not sufficient: `schemaVersion: 2` is written UNQUOTED, which YAML parses
// as the NUMBER 2, while `isHandoffFrontmatter` demanded
// `typeof v.schemaVersion === 'string'`. So `readHandoff` threw on the file
// this module had just written, and `peaks prd handoff verify` exited 1 with
// `reason: "file-missing"` — for a file sitting right there.
//
// The two consumers disagreed about the same bytes: `AUDIT_REQUIRES_HANDOFF`
// checks for the SUBSTRING `schemaVersion: 2` and passed, while the real parser
// refused. Neither side was wrong to be tested — the reader had to learn to
// accept both legal YAML spellings of version 2.
//
// Quoting the writer instead would NOT have been a fix: it deletes the very
// substring the prereq pins, trading a broken read for a broken gate. The test
// below reads the prereq from the REAL registry rather than hardcoding the
// markers, so it fails if the gate's contract ever changes underneath it.
// ---------------------------------------------------------------------------
describe('autoRegenPrdHandoff — the output passes the repo’s own handoff verifier (N1)', () => {
  it('should write a handoff that `verifyHandoff` accepts', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    const result = await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });
    expect(result.status).toBe('created');

    // Before the fix: `{ ok: false, reason: 'file-missing' }` — a file that
    // exists, reported as absent, from a bare `catch`.
    const probe = await verifyHandoff(handoffPathOf(projectRoot));
    expect(probe).toEqual({ ok: true, actualHash: expect.any(String), expectedHash: expect.any(String) });
  });

  it('should let `readHandoff` parse the frontmatter and normalize schemaVersion to `2`', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    // Before the fix this threw "handoff: frontmatter shape validation failed".
    const handoff = await readHandoff(handoffPathOf(projectRoot));
    expect(handoff.frontmatter.schemaVersion).toBe('2');
    expect(handoff.frontmatter.requestId).toBe(REQUEST_ID);
    expect(handoff.frontmatter.sessionId).toBe(SESSION_ID);
    expect(handoff.body).toBe(BODY);
  });

  it('should accept BOTH legal YAML spellings of schemaVersion 2', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);
    const handoffPath = handoffPathOf(projectRoot);
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });

    const frontmatter = (schemaVersion: string): string =>
      [
        '---',
        `requestId: ${REQUEST_ID}`,
        `sessionId: ${SESSION_ID}`,
        `schemaVersion: ${schemaVersion}`,
        'sha256: 0',
        // Not all digits: an all-numeric scalar would parse as a YAML integer,
        // which is a different (and correct) rejection.
        `handoffHash: ${'a'.repeat(64)}`,
        'writtenAt: 2026-09-12T00:00:00.000Z',
        'goals: []',
        'acceptanceCriteria: []',
        'preservedBehavior: []',
        'handoffPath: prd/handoff.md',
        '---',
        '',
        'body',
      ].join('\n');

    for (const spelling of ['2', '"2"', "'2'"]) {
      writeFileSync(handoffPath, frontmatter(spelling), 'utf8');
      const handoff = await readHandoff(handoffPath);
      expect(handoff.frontmatter.schemaVersion).toBe('2');
    }

    // A version that is neither is still refused — the tolerance is for the
    // two spellings of 2, not for "any scalar".
    writeFileSync(handoffPath, frontmatter('3'), 'utf8');
    await expect(readHandoff(handoffPath)).rejects.toThrow(/frontmatter shape validation failed/);
  });

  it('should still report file-missing for a file that is genuinely absent', async () => {
    const projectRoot = makeProjectRoot();
    // The reason field must keep meaning what it says: distinguishing the two
    // failure classes must not blur the one that is real.
    expect(await verifyHandoff(handoffPathOf(projectRoot))).toEqual({
      ok: false,
      reason: 'file-missing',
    });
  });

  it('should report frontmatter-malformed (not file-missing) when the file exists but cannot be parsed', async () => {
    const projectRoot = makeProjectRoot();
    const handoffPath = handoffPathOf(projectRoot);
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd'), { recursive: true });
    writeFileSync(handoffPath, 'no frontmatter fence here\n', 'utf8');

    const probe = await verifyHandoff(handoffPath);
    expect(probe.ok).toBe(false);
    // Before the fix this said `file-missing`, sending an operator to look for
    // a file that was on disk the whole time.
    expect(probe.reason).toBe('frontmatter-malformed');
  });

  it('should keep satisfying the REAL `AUDIT_REQUIRES_HANDOFF` prereq markers', async () => {
    const projectRoot = makeProjectRoot();
    seedRequestArtifact(projectRoot);

    await autoRegenPrdHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID,
      role: 'prd',
    });

    const prereq = getPrerequisitesFor('rd', 'qa-handoff', 'bugfix').find(
      (candidate) => candidate.relativePath === 'prd/handoff.md'
    );
    expect(prereq?.mustContain).toBeDefined();

    const handoff = readFileSync(handoffPathOf(projectRoot), 'utf8');
    const lowered = handoff.toLowerCase();
    for (const marker of prereq?.mustContain ?? []) {
      // The whole point of N1's fix shape: the reader got tolerant, the WRITER
      // was left alone, so the substring gate still opens.
      expect(lowered).toContain(marker.toLowerCase());
    }
  });
});
