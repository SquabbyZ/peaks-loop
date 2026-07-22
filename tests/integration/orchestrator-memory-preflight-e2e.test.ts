/**
 * Task 6 — end-to-end integration test for the orchestrator memory-preflight slice.
 *
 * Slice: 2026-07-22-orchestrator-memory-preflight
 * Plan: docs/superpowers/plans/2026-07-22-orchestrator-memory-preflight-plan.md
 * Spec: docs/superpowers/specs/2026-07-22-orchestrator-memory-preflight-design.md
 *
 * Black-box integration test against Tasks 1-5. No mocks — exercises the real
 * MemoryPreflightService (Task 4) and real buildDispatchSystemPrompt (Task 5)
 * end-to-end, and the real headroom-client.js compressPrompt (which falls back
 * gracefully when the proxy is unavailable, so the assertion contract still
 * holds in CI).
 *
 * Diff vs. Task 4 unit test (tests/unit/services/context/memory-preflight-service.test.ts):
 *   - Task 4 mocks headroom-client.js so the assertions only see what the
 *     service decides to emit. Task 6 lets the real compressPrompt run, so
 *     assertions hold even if headroom returns a degraded (HEADROOM_UNAVAILABLE)
 *     result — the service preserves the original composed text in that case.
 *
 * Acceptance cases (brief):
 *   1. Sub-agent prompt embeds feedback/A memory items by default.
 *      Asserts: prompt contains `release-shared-chicken-egg`, contains
 *      `## Task`, AND `## Project memory relevant to this task` comes
 *      strictly BEFORE `## Task` in the rendered prompt.
 *   2. Silently omits when memory index is missing.
 *      Asserts: prompt contains the task body and does NOT contain the
 *      `## Project memory` header (byte-identical degradation contract).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildDispatchSystemPrompt } from '../../src/services/context/build-dispatch-system-prompt.js';
import { MemoryPreflightService } from '../../src/services/context/memory-preflight-service.js';

describe('Orchestrator memory preflight — e2e', () => {
  test('sub-agent prompt embeds feedback/A memory items by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const feedbackA = {
        name: 'release-shared-chicken-egg',
        kind: 'feedback',
        description: '<!-- peaks-feedback-promoted: layer=A --> peaks-loop@new pins peaks-loop-shared@old; bumps must lockstep',
        sourcePath: '/p/release-shared-chicken-egg.md',
        sourceArtifact: null,
        updatedAt: '2026-07-22',
      };
      // mkdirSync — writeFileSync does not create parents, and the brief's
      // first test writes .peaks/memory/index.json directly. Same gotcha
      // Task 3 had; controller-accepted amendment.
      const memDir = join(root, '.peaks', 'memory');
      mkdirSync(memDir, { recursive: true });
      writeFileSync(join(memDir, 'index.json'), JSON.stringify({
        hot: { feedback: [feedbackA] },
      }));
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const block = await service.fetchBlock('publish peaks-loop');
      const prompt = buildDispatchSystemPrompt({
        taskTitle: 'publish peaks-loop@4.0.1',
        taskBody: 'Tag and push.',
        memoryBlock: block,
      });
      expect(prompt).toContain('release-shared-chicken-egg');
      expect(prompt).toContain('## Task');
      // Ordering check — memory block must precede the task brief.
      expect(prompt.indexOf('## Project memory relevant to this task'))
        .toBeLessThan(prompt.indexOf('## Task'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('silently omits when memory index is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const block = await service.fetchBlock('publish');
      const prompt = buildDispatchSystemPrompt({
        taskTitle: 't',
        taskBody: 'body',
        memoryBlock: block,
      });
      expect(prompt).toContain('body');
      expect(prompt).not.toContain('## Project memory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});