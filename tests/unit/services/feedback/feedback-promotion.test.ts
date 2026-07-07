/**
 * v2.15.0 slice 002 — AC-3: feedback promotion + Gate H tests.
 *
 * Covers:
 *   - `parseFeedbackMemory` (frontmatter parsing, comment marker,
 *     sidecar fallback)
 *   - `listUnpromotedFeedback` (memory scan, return shape)
 *   - `promoteFeedback` (writes marker + sidecar + envelope)
 *   - `generatePromotionStub` (layer A/B/C stub shape)
 *   - Gate H integration with `verifyPipeline`
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  generatePromotionStub,
  isPromotionLayer,
  listUnpromotedFeedback,
  parseFeedbackMemory,
  promoteFeedback,
  PROMOTION_LAYER_DETAILS,
  PROMOTION_LAYERS
} from '../../../../src/services/feedback/feedback-promotion-service.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-feedback-promotion-'));
}

function writeMemory(root: string, name: string, content: string): string {
  const dir = join(root, '.peaks', 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, content, 'utf8');
  return path;
}

function feedbackMemory(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: feedback test\nmetadata:\n  type: feedback\n---\n\n${body}\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseFeedbackMemory — AC-3', () => {
  test('parses a feedback memory and returns name + frontmatter + body', () => {
    const root = createTempDir();
    try {
      const path = writeMemory(root, '2026-06-28-test-rule', feedbackMemory('2026-06-28-test-rule', 'rule body here'));
      const parsed = parseFeedbackMemory(path);
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('2026-06-28-test-rule');
      expect(parsed!.frontmatter.kind).toBe('feedback');
      expect(parsed!.body).toContain('rule body here');
      expect(parsed!.promotion).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns null for non-feedback memories', () => {
    const root = createTempDir();
    try {
      const nonFeedback = `---\nname: project-x\ndescription: project memory\nmetadata:\n  type: project\n---\nbody`;
      const path = writeMemory(root, 'project-x', nonFeedback);
      expect(parseFeedbackMemory(path)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns null for malformed frontmatter', () => {
    const root = createTempDir();
    try {
      const path = writeMemory(root, 'malformed', 'not a memory file at all');
      expect(parseFeedbackMemory(path)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('detects comment-based promotion marker', () => {
    const root = createTempDir();
    try {
      const body = `<!-- peaks-feedback-promoted: layer=A -->\n\nrule body`;
      const path = writeMemory(root, 'promoted-comment', feedbackMemory('promoted-comment', body));
      const parsed = parseFeedbackMemory(path);
      expect(parsed?.promotion).not.toBeNull();
      expect(parsed?.promotion?.layer).toBe('A');
      expect(parsed?.promotion?.source).toBe('comment');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('detects sidecar-based promotion marker', () => {
    const root = createTempDir();
    try {
      const dir = join(root, '.peaks', 'memory');
      mkdirSync(dir, { recursive: true });
      const mdPath = join(dir, 'promoted-sidecar.md');
      writeFileSync(mdPath, feedbackMemory('promoted-sidecar', 'rule body'), 'utf8');
      const sidecarPath = join(dir, 'promoted-sidecar.promotion.json');
      writeFileSync(sidecarPath, JSON.stringify({ layer: 'C' }), 'utf8');
      const parsed = parseFeedbackMemory(mdPath);
      expect(parsed?.promotion).not.toBeNull();
      expect(parsed?.promotion?.layer).toBe('C');
      expect(parsed?.promotion?.source).toBe('sidecar');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts top-level `type: feedback` form (legacy)', () => {
    const root = createTempDir();
    try {
      const legacy = `---\nname: legacy-form\ndescription: legacy\ntype: feedback\n---\nbody`;
      const path = writeMemory(root, 'legacy-form', legacy);
      const parsed = parseFeedbackMemory(path);
      expect(parsed).not.toBeNull();
      expect(parsed!.frontmatter.kind).toBe('feedback');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('listUnpromotedFeedback — AC-3', () => {
  test('returns empty list when memory dir is missing', () => {
    const root = createTempDir();
    try {
      const result = listUnpromotedFeedback({ projectRoot: root });
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns feedback memories without promotion marker', () => {
    const root = createTempDir();
    try {
      writeMemory(root, 'a-unpromoted', feedbackMemory('a-unpromoted', 'body a'));
      writeMemory(root, 'b-promoted', `<!-- peaks-feedback-promoted: layer=B -->\n\n${feedbackMemory('b-promoted', 'body b').split('\n---\n').pop()}`);
      writeMemory(root, 'c-project', `---\nname: c-project\ndescription: project\nmetadata:\n  type: project\n---\nbody c`);
      const result = listUnpromotedFeedback({ projectRoot: root });
      const names = result.map((r) => r.name);
      expect(names).toContain('a-unpromoted');
      expect(names).not.toContain('b-promoted');
      expect(names).not.toContain('c-project');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('unpromoted entry carries name + path + reason', () => {
    const root = createTempDir();
    try {
      writeMemory(root, 'orphan', feedbackMemory('orphan', 'body'));
      const result = listUnpromotedFeedback({ projectRoot: root });
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('orphan');
      expect(result[0]!.path).toContain('orphan.md');
      expect(result[0]!.reason).toContain('promotion');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // v2.18.4 — feedback-promotion-service honours `closedAt:` and skips
  // archived memories from the unpromoted list. Closed memories declare
  // their own "Do not re-introduce this memory as a live blocker"; counting
  // them as unpromoted would force operators to either promote or delete a
  // deliberately archived record.
  test('skips feedback memories with a non-empty `closedAt:` frontmatter field', () => {
    const root = createTempDir();
    try {
      // 1. Open (unpromoted) — should be reported.
      writeMemory(root, 'open-orphan', feedbackMemory('open-orphan', 'live rule body'));
      // 2. Open + already promoted — should be skipped.
      writeMemory(root, 'open-promoted', `<!-- peaks-feedback-promoted: layer=A -->\n\n${feedbackMemory('open-promoted', 'live rule body').split('\n---\n').pop()}`);
      // 3. Closed + unpromoted — should be SKIPPED (the new behaviour).
      const closedBody = 'archived rule body';
      writeMemory(
        root,
        'archived-orphan',
        `---\nname: archived-orphan\ndescription: archived memory\nmetadata:\n  type: feedback\n  closedAt: 2026-06-02T00:00:00.000Z\n  closedBy: e611daf\n---\n${closedBody}`
      );
      // 4. Closed + already promoted — should be SKIPPED (closed wins).
      writeMemory(
        root,
        'archived-promoted',
        `---\nname: archived-promoted\ndescription: archived memory, but already promoted\nmetadata:\n  type: feedback\n  closedAt: 2026-06-02T00:00:00.000Z\n---\n<!-- peaks-feedback-promoted: layer=B -->\narchived but promoted`
      );
      // 5. `closedAt: ""` (empty value) — must NOT be treated as closed.
      writeMemory(
        root,
        'empty-closed',
        `---\nname: empty-closed\ndescription: feedback memory with empty closedAt\nmetadata:\n  type: feedback\n  closedAt: ""\n---\nbody`
      );

      const result = listUnpromotedFeedback({ projectRoot: root });
      const names = result.map((r) => r.name);
      expect(names).toContain('open-orphan');
      expect(names).toContain('empty-closed');
      expect(names).not.toContain('open-promoted');
      expect(names).not.toContain('archived-orphan');
      expect(names).not.toContain('archived-promoted');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('promoteFeedback — AC-3', () => {
  test('writes comment marker + sidecar + envelope', () => {
    const root = createTempDir();
    try {
      const path = writeMemory(root, 'promote-target', feedbackMemory('promote-target', 'rule body'));
      const envelope = promoteFeedback({
        feedbackPath: path,
        layer: 'A',
        promotedBy: 'test-suite',
        sessionId: 'session-test',
        projectRoot: root,
        dryRun: false
      });
      expect(envelope.layer).toBe('A');
      expect(envelope.layerDetail).toBe('peaks-sop gate');
      expect(envelope.name).toBe('promote-target');
      // Marker embedded.
      const updated = readFileSync(path, 'utf8');
      expect(updated).toContain('peaks-feedback-promoted: layer=A');
      // Sidecar exists.
      const sidecarPath = path.replace(/\.md$/, '.promotion.json');
      expect(existsSync(sidecarPath)).toBe(true);
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      expect(sidecar.layer).toBe('A');
      // Envelope exists at .peaks/_runtime/<sid>/rd/.
      const envelopePath = join(root, '.peaks', '_runtime', 'session-test', 'rd', 'feedback-promote-promote-target.json');
      expect(existsSync(envelopePath)).toBe(true);
      const env = JSON.parse(readFileSync(envelopePath, 'utf8'));
      expect(env.layer).toBe('A');
      expect(env.promotedBy).toBe('test-suite');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('dry-run does NOT write marker / sidecar / envelope', () => {
    const root = createTempDir();
    try {
      const path = writeMemory(root, 'dryrun-target', feedbackMemory('dryrun-target', 'body'));
      const originalContent = readFileSync(path, 'utf8');
      const envelope = promoteFeedback({
        feedbackPath: path,
        layer: 'B',
        promotedBy: 'test-suite',
        sessionId: 'session-dryrun',
        projectRoot: root,
        dryRun: true
      });
      expect(envelope.layer).toBe('B');
      // File unchanged.
      expect(readFileSync(path, 'utf8')).toBe(originalContent);
      // No sidecar.
      expect(existsSync(path.replace(/\.md$/, '.promotion.json'))).toBe(false);
      // No envelope.
      const envelopePath = join(root, '.peaks', '_runtime', 'session-dryrun', 'rd', 'feedback-promote-dryrun-target.json');
      expect(existsSync(envelopePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('layer A stub targets sops file', () => {
    const root = createTempDir();
    try {
      const path = writeMemory(root, 'a-target', feedbackMemory('a-target', 'first line\nsecond line'));
      const stub = generatePromotionStub({ layer: 'A', feedbackName: 'a-target', feedbackBody: 'body' });
      expect(stub.targetFiles).toContain('sops/a-target.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('layer C stub targets mode-gate.ts + a new test file', () => {
    const stub = generatePromotionStub({ layer: 'C', feedbackName: 'rule-x', feedbackBody: 'body' });
    expect(stub.targetFiles).toContain('src/services/code/mode-gate.ts');
    expect(stub.targetFiles.some((f) => f.includes('hard-floor'))).toBe(true);
  });
});

describe('PROMOTION_LAYER_DETAILS — 3 layers', () => {
  test('all 3 layers are declared', () => {
    expect(PROMOTION_LAYERS).toEqual(['A', 'B', 'C']);
    expect(PROMOTION_LAYER_DETAILS).toHaveLength(3);
    for (const detail of PROMOTION_LAYER_DETAILS) {
      expect(detail.label.length).toBeGreaterThan(0);
      expect(detail.description.length).toBeGreaterThan(0);
    }
  });

  test('isPromotionLayer type guard', () => {
    expect(isPromotionLayer('A')).toBe(true);
    expect(isPromotionLayer('B')).toBe(true);
    expect(isPromotionLayer('C')).toBe(true);
    expect(isPromotionLayer('D')).toBe(false);
    expect(isPromotionLayer('')).toBe(false);
  });
});

describe('verifyPipeline Gate H — AC-3 integration', () => {
  test('Gate H passes when no feedback memories exist', async () => {
    const root = createTempDir();
    try {
      // Create a fake RD request so the pipeline runs.
      const rdDir = join(root, '.peaks', '_runtime', 'change', 'v2-15-0-test', 'rd');
      mkdirSync(rdDir, { recursive: true });
      const rdFile = join(rdDir, 'requests', '001-test.md');
      mkdirSync(dirname(rdFile), { recursive: true });
      writeFileSync(rdFile, '---\nrid: 001-test\n---\n\n- state: qa-handoff\n', 'utf8');
      // No qa — Gate H does not depend on qa existence; it scans
      // `.peaks/memory/` regardless. We expect gateH === 'pass'
      // and the gate detail to say 0 unpromoted feedback.
      const result = await verifyPipeline({
        projectRoot: root,
        rid: '001-test',
        sessionId: 'v2-15-0-test',
        requestType: 'feature'
      });
      expect(result.feedbackPhase?.gates).toHaveLength(1);
      expect(result.feedbackPhase?.gates[0]!.passed).toBe(true);
      expect(result.gateH).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('Gate H fails when an unpromoted feedback memory exists', async () => {
    const root = createTempDir();
    try {
      // Create a fake RD request.
      const rdDir = join(root, '.peaks', '_runtime', 'change', 'v2-15-0-test', 'rd');
      mkdirSync(rdDir, { recursive: true });
      const rdFile = join(rdDir, 'requests', '001-test.md');
      mkdirSync(dirname(rdFile), { recursive: true });
      writeFileSync(rdFile, '---\nrid: 001-test\n---\n\n- state: qa-handoff\n', 'utf8');
      // Add an unpromoted feedback memory.
      writeMemory(root, 'unpromoted-rule', feedbackMemory('unpromoted-rule', 'body'));
      const result = await verifyPipeline({
        projectRoot: root,
        rid: '001-test',
        sessionId: 'v2-15-0-test',
        requestType: 'feature'
      });
      expect(result.gateH).toBe('fail');
      expect(result.feedbackPhase?.gates[0]!.passed).toBe(false);
      expect(result.feedbackPhase?.gates[0]!.detail).toContain('unpromoted-rule');
      expect(result.violations.some((v) => v.includes('Gate H feedback-promotion FAILED'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('Gate H passes when feedback memory IS promoted (comment marker)', async () => {
    const root = createTempDir();
    try {
      const rdDir = join(root, '.peaks', '_runtime', 'change', 'v2-15-0-test', 'rd');
      mkdirSync(rdDir, { recursive: true });
      const rdFile = join(rdDir, 'requests', '001-test.md');
      mkdirSync(dirname(rdFile), { recursive: true });
      writeFileSync(rdFile, '---\nrid: 001-test\n---\n\n- state: qa-handoff\n', 'utf8');
      // Promote via comment marker.
      writeMemory(root, 'promoted-rule', `<!-- peaks-feedback-promoted: layer=C -->\n\n${feedbackMemory('promoted-rule', 'body')}`);
      const result = await verifyPipeline({
        projectRoot: root,
        rid: '001-test',
        sessionId: 'v2-15-0-test',
        requestType: 'feature'
      });
      expect(result.gateH).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
