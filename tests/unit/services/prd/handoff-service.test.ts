/**
 * v2.11.0 Group B — D1 immutable handoff service tests.
 *
 * Pins:
 *   - sha256 round-trip (write → verify → ok)
 *   - verify mismatch (tamper body → ok:false reason:hash-mismatch)
 *   - initHandoff produces frontmatter with schemaVersion: '2' + populated handoffHash
 *   - default handoffPath follows `.peaks/_runtime/<sid>/prd/handoff.md` convention
 *   - readHandoff throws on malformed frontmatter / bad YAML
 *   - custom handoffPath override
 *   - verifyHandoff returns schema-version-mismatch when frontmatter says schemaVersion: '1'
 *   - verifyHandoff returns file-missing when path does not exist
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initHandoff,
  readHandoff,
  sha256OfBody,
  verifyHandoff,
  writeHandoff,
} from '../../../../src/services/prd/handoff-service.js';

const SID = '2026-06-26-session-handoff-test';
const RID = '001-v2-11-handoff-test';
const CID = 'v2-11-handoff-test';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-handoff-service-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('handoff-service — sha256 round-trip', () => {
  it('sha256OfBody returns the lowercase hex digest of the UTF-8 bytes', () => {
    const body = '# Hello\n\nWorld.\n';
    const expected = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(sha256OfBody(body)).toBe(expected);
    // Sanity: 64-char lowercase hex.
    expect(sha256OfBody(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writeHandoff + verifyHandoff round-trip yields ok:true', async () => {
    const body = '# PRD body\n\nGoals: G1, G2.\n';
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body,
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: ['G1', 'G2'],
      acceptanceCriteria: ['AC-1'],
      preservedBehavior: ['P1']
    });
    const written = await writeHandoff(handoff, root);
    expect(written.path).toBe(join(root, '.peaks', '_runtime', SID, 'prd', 'handoff.md'));
    expect(written.hash).toBe(sha256OfBody(body));
    expect(existsSync(written.path)).toBe(true);

    const probe = await verifyHandoff(written.path);
    expect(probe.ok).toBe(true);
    expect(probe.actualHash).toBe(sha256OfBody(body));
    expect(probe.expectedHash).toBe(probe.actualHash);
  });
});

describe('handoff-service — verify mismatch', () => {
  it('tampering the body after writeHandoff → ok:false reason:hash-mismatch', async () => {
    const body = '# Original\n\nBody.\n';
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body,
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: []
    });
    const written = await writeHandoff(handoff, root);
    // Tamper: rewrite the file with the same frontmatter but a different body.
    const original = readFileSync(written.path, 'utf8');
    const tampered = original.replace('# Original\n\nBody.\n', '# Tampered\n\nBody.\n');
    expect(tampered).not.toBe(original);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(written.path, tampered, 'utf8');

    const probe = await verifyHandoff(written.path);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe('hash-mismatch');
    expect(probe.actualHash).toBe(sha256OfBody('# Tampered\n\nBody.\n'));
    expect(probe.expectedHash).toBe(sha256OfBody('# Original\n\nBody.\n'));
  });

  it('verifyHandoff returns file-missing when the path does not exist', async () => {
    const probe = await verifyHandoff(join(root, 'does-not-exist.md'));
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe('file-missing');
  });

  it('verifyHandoff returns schema-version-mismatch when schemaVersion is not "2"', async () => {
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body: 'body\n',
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: []
    });
    const written = await writeHandoff(handoff, root);
    // Read raw file, replace schemaVersion in frontmatter, write back.
    const raw = readFileSync(written.path, 'utf8');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(written.path, raw.replace('schemaVersion: "2"', 'schemaVersion: "1"'), 'utf8');

    const probe = await verifyHandoff(written.path);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe('schema-version-mismatch');
  });
});

describe('handoff-service — initHandoff shape', () => {
  it('frontmatter carries schemaVersion "2" and a populated handoffHash', () => {
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body: 'hello\n',
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: ['G1'],
      acceptanceCriteria: ['AC-1', 'AC-2'],
      preservedBehavior: ['P1', 'P12']
    });
    expect(handoff.frontmatter.schemaVersion).toBe('2');
    expect(handoff.frontmatter.requestId).toBe(RID);
    expect(handoff.frontmatter.sessionId).toBe(SID);
    // change-id removed in 2026-06-29-change-id-root-removal slice
    expect((handoff.frontmatter as unknown as Record<string, unknown>).changeId).toBeUndefined();
    expect(handoff.frontmatter.handoffHash).toBe(sha256OfBody('hello\n'));
    expect(handoff.frontmatter.writtenAt).toBe('2026-06-26T05:00:00.000Z');
    expect(handoff.frontmatter.goals).toEqual(['G1']);
    expect(handoff.frontmatter.acceptanceCriteria).toEqual(['AC-1', 'AC-2']);
    expect(handoff.frontmatter.preservedBehavior).toEqual(['P1', 'P12']);
    expect(handoff.frontmatter.handoffPath).toBe(
      join('.peaks', '_runtime', SID, 'prd', 'handoff.md')
    );
    expect(handoff.body).toBe('hello\n');
  });

  it('default handoffPath follows the .peaks/_runtime/<sid>/prd/handoff.md convention', () => {
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body: 'x',
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: []
    });
    expect(handoff.frontmatter.handoffPath).toBe(
      join('.peaks', '_runtime', SID, 'prd', 'handoff.md')
    );
  });

  it('custom handoffPath overrides the default', () => {
    const handoff = initHandoff({
      requestId: RID,
      sessionId: SID,
      body: 'x',
      writtenAt: '2026-06-26T05:00:00.000Z',
      goals: [],
      acceptanceCriteria: [],
      preservedBehavior: [],
      handoffPath: 'custom/path/handoff.md'
    });
    expect(handoff.frontmatter.handoffPath).toBe('custom/path/handoff.md');
  });

  it('readHandoff throws on malformed frontmatter (missing --- block)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(root, 'no-front');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'bad.md');
    await writeFile(path, 'this file has no frontmatter block at all', 'utf8');
    await expect(readHandoff(path)).rejects.toThrow(/frontmatter/);
  });

  it('readHandoff throws on malformed frontmatter YAML', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(root, 'bad-yaml');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'bad-yaml.md');
    await writeFile(
      path,
      '---\nthis: is: not: valid: yaml: [unbalanced\n---\nbody\n',
      'utf8'
    );
    await expect(readHandoff(path)).rejects.toThrow();
  });

  it('readHandoff throws when the frontmatter shape is invalid (missing required fields)', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(root, 'bad-shape');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'bad-shape.md');
    await writeFile(
      path,
      '---\nfoo: bar\n---\nbody\n',
      'utf8'
    );
    await expect(readHandoff(path)).rejects.toThrow(/shape/);
  });
});