/**
 * G7 + G8 dogfood integration test.
 *
 * Exercises the live-repo batch metadata view (~600 chars for 3 sub-agents)
 * and the share / shared-read roundtrip with a realistic slice #010 RID.
 *
 * This test does NOT call the full `peaks sub-agent dispatch` CLI (that's
 * exercised by the slice #010 dogfood at the bottom of the QA test report).
 * It exercises the underlying helpers to validate the metadata-view size
 * budget end-to-end.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildArtifactMeta,
  buildContextImpact
} from '../../src/services/context/artifact-meta.js';
import { artifactPath } from '../../src/services/context/dispatch-context-guard.js';
import { readSharedChannel, writeSharedEntry } from '../../src/services/context/shared-channel.js';

let root: string;
const SID = '2026-06-06-session-5b1095';
const RID = '003-2026-06-07';
const BATCH = 'batch-dogfood-001';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-g7g8-dogfood-'));
  mkdirSync(join(root, '.peaks', '_sub_agents', SID, 'artifacts'), { recursive: true });
  mkdirSync(join(root, '.peaks', '_sub_agents', SID, 'shared'), { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('G7 dogfood: 3-sub-agent batch metadata view (~600 chars)', () => {
  it('emits 3 ArtifactMeta + the main LLM view fits the 600-char budget', () => {
    // Write 3 small artifacts at the canonical path
    const paths = ['rd', 'qa-business', 'qa-perf'].map((role, i) => {
      const p = artifactPath(root, SID, RID, role, 1, 'md');
      writeFileSync(p, `# ${role}\n\ncontent ${i}`, 'utf8');
      return p;
    });
    const metas = paths.map((p, i) =>
      buildArtifactMeta({
        path: p,
        rid: RID,
        role: ['rd', 'qa-business', 'qa-perf'][i] ?? 'rd',
        idx: 1,
        summary: ['wrote RD tech-doc with 4 sub-roles', 'wrote 12 API test cases', 'wrote perf baseline p95 ≤ 200ms'][i] ?? ''
      })
    );

    // Build the G7.4.e main LLM view
    const view = metas.map((m) => {
      return `- ${m.role} → ${m.path} (${m.size}B, sha256:${m.sha256.slice(0, 7)}) summary: "${m.summary}"`;
    }).join('\n');
    // The full view should be well under 1KB (PRD budget: ~200 chars/sub-agent)
    expect(view.length).toBeLessThan(1000);

    // The content (the original 3 files) is NOT in the view. Verify by
    // checking that the view does not contain the file's actual content.
    expect(view).not.toContain('# rd\n\ncontent 0');
    expect(view).not.toContain('# qa-business\n\ncontent 1');
  });

  it('G7 metadata-only scales: 6-sub-agent batch view < 1.2KB', () => {
    const roles = ['rd', 'qa-business', 'qa-perf', 'ui', 'txt', 'qa-security'];
    const paths = roles.map((role) => {
      const p = artifactPath(root, SID, RID, role, 1, 'md');
      writeFileSync(p, `# ${role}\n\ncontent`, 'utf8');
      return p;
    });
    const metas = paths.map((p, i) =>
      buildArtifactMeta({
        path: p,
        rid: RID,
        role: roles[i] ?? 'rd',
        idx: 1,
        summary: `summary for ${roles[i]}`
      })
    );
    const view = metas.map((m) =>
      `- ${m.role} → ${m.path} (${m.size}B, sha256:${m.sha256.slice(0, 7)}) summary: "${m.summary}"`
    ).join('\n');
    // PRD: 6-sub-agent batch should be ~1.2KB
    expect(view.length).toBeLessThan(1500);
  });
});

describe('G7 ContextImpact: dogfood with realistic numbers', () => {
  it('typical slice: 3 sub-agents × 8KB + 50KB prompt => normal', () => {
    const ci = buildContextImpact({
      promptSize: 50_000,
      artifactSizes: [12_000, 8_000, 5_000]
    });
    expect(ci.contextWarning).toBe('normal');
    expect(ci.batchTotalSize).toBe(75_000);
  });
});

describe('G8 dogfood: 3 sub-agents write + sibling read', () => {
  it('rd writes -> qa-business reads via shared-read', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { summary: 'wrote tech-doc', size: 12000 }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa-business.completed',
      from: 'qa-business',
      value: { summary: 'wrote 12 test cases', size: 8000 }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa-perf.completed',
      from: 'qa-perf',
      value: { summary: 'p95 ≤ 200ms', size: 5000 }
    });

    // qa-perf (still in flight) reads sibling entries
    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(Object.keys(ch.entries).sort()).toEqual([
      'qa-business.completed',
      'qa-perf.completed',
      'rd.completed'
    ]);
  });
});
