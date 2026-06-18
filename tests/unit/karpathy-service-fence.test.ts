/**
 * Slice 2.6.1.B — karpathy-service anti-pattern tightening
 *
 * Verifies the L7 LOW mitigation: anti-pattern markers (TODO, "should be
 * fine", "maybe", etc.) inside fenced markdown code blocks are NOT
 * flagged as violations. Code-block content is illustrative, not the
 * review's prose, and should not erode trust in the structural scanner.
 *
 * AC-1 a TODO inside ```ts ... ``` is not flagged
 * AC-2 anti-pattern prose outside any code fence is still flagged
 * AC-3 an unclosed code fence at EOF does not crash the scanner
 * AC-4 fences nested in different positions skip and re-enable correctly
 */

import { describe, expect, it } from 'vitest';
import { scanKarpathy } from '../../src/services/scan/karpathy-service.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withReview(content: string): Promise<{ projectRoot: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'karpathy-fence-'));
  await mkdir(join(root, 'rd'), { recursive: true });
  await writeFile(join(root, 'rd/karpathy-review.md'), content);
  return {
    projectRoot: root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

const BASE_REVIEW = `# Karpathy review

## 1. Think Before Coding
Done.

## 2. Simplicity First
Done.

## 3. Surgical Changes
Done.

## 4. Goal-Driven Execution
Done.
`;

describe('Slice 2.6.1.B — karpathy-service code-fence skip', () => {
  it('AC-1 does not flag TODO / weak-criteria inside a fenced code block', async () => {
    const { projectRoot, cleanup } = await withReview(
      BASE_REVIEW +
        '\n```ts\n// TODO: this should be fine later\nconst x = maybe_some_future_value;\n```\n'
    );
    try {
      const r = await scanKarpathy({ projectRoot });
      const flagged = r.violations.map((v) => v.line);
      expect(flagged).not.toContain(13); // the TODO line
      expect(flagged).not.toContain(14); // the const line
    } finally {
      await cleanup();
    }
  });

  it('AC-2 still flags anti-pattern prose outside any code fence', async () => {
    const { projectRoot, cleanup } = await withReview(
      BASE_REVIEW + '\n## 5. Post-review note\nWe should be fine, probably. Maybe.\n'
    );
    try {
      const r = await scanKarpathy({ projectRoot });
      const lines = r.violations.map((v) => v.line);
      // BASE_REVIEW ends at L13 ('Done.' for §4) + trailing empty L14,
      // then '## 5. Post-review note' at L15 and the weak-criteria line at L16.
      expect(lines).toContain(16);
    } finally {
      await cleanup();
    }
  });

  it('AC-3 unclosed code fence at EOF does not crash the scanner', async () => {
    const { projectRoot, cleanup } = await withReview(
      BASE_REVIEW + '\n```ts\n// TODO: unfinished snippet, no closing fence\n'
    );
    try {
      const r = await scanKarpathy({ projectRoot });
      expect(r).toBeDefined();
      expect(r.gateAction).toBeDefined();
      // BASE_REVIEW ends at L13 + trailing empty L14,
      // then ``` at L15, TODO at L16. L16 is inside the unclosed fence.
      const lines = r.violations.map((v) => v.line);
      expect(lines).not.toContain(16);
    } finally {
      await cleanup();
    }
  });

  it('AC-4 fence state correctly toggles on/off mid-file', async () => {
    const { projectRoot, cleanup } = await withReview(
      BASE_REVIEW +
        '\n## prose with weak criteria: probably ok\n' +
        '\n```ts\n// TODO: ignored because inside fence\n```\n' +
        '\n## more prose with weak criteria: maybe ship\n'
    );
    try {
      const r = await scanKarpathy({ projectRoot });
      const flagged = r.violations.map((v) => v.line);
      // BASE_REVIEW ends at L13 + trailing empty L14.
      // L15: '## prose with weak criteria: probably ok' — OUTSIDE fence, flagged.
      // L16: empty
      // L17: ```ts (opens fence)
      // L18: '// TODO: ignored because inside fence' — INSIDE fence, not flagged.
      // L19: ``` (closes fence)
      // L20: empty
      // L21: '## more prose with weak criteria: maybe ship' — OUTSIDE fence, flagged.
      expect(flagged).toContain(15);
      expect(flagged).not.toContain(18);
      expect(flagged).toContain(21);
    } finally {
      await cleanup();
    }
  });
});
