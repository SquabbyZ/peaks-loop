// tests/unit/services/feedback/feedback-promotion-artifact.test.ts
//
// rid 2026-09-14-gate-h-promotion: Gate H used to honor a promotion marker
// alone, which made it self-certifying — it read only what the command it
// tells you to run had written. Every layer-A marker in this repo pointed at
// `sops/<name>.md`, a file that did not exist and that no engine reads.
//
// Dimensions (per tests/unit/_setup/4dim-template.ts):
//   - behavior:    per-layer artifact table; marker-without-artifact is not promoted
//   - integration: real fs boundary (.peaks/memory + .peaks/sops fixtures)
//   - render:      envelope fields stay truthful (generatedFiles / effective)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  listUnpromotedFeedback,
  missingArtifacts,
  promoteFeedback,
  promotionArtifactChecks,
  sopIdForFeedback
} from '~/src/services/feedback/feedback-promotion-service';

declareDimensions(
  'tests/unit/services/feedback/feedback-promotion-artifact.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'no user-facing render surface; the gate output is machine-readable JSON asserted under render' }],
);

const MEMORY_DIR = join('.peaks', 'memory');

function project(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `peaks-${prefix}-`));
}

/** A feedback memory whose body claims `layer` via the HTML comment marker. */
function writeMemory(root: string, name: string, layer?: 'A' | 'B' | 'C'): string {
  mkdirSync(join(root, MEMORY_DIR), { recursive: true });
  const marker = layer === undefined ? '' : `<!-- peaks-feedback-promoted: layer=${layer} -->\n\n`;
  const path = join(root, MEMORY_DIR, `${name}.md`);
  writeFileSync(
    path,
    `---\nname: ${name}\ndescription: fixture rule\nmetadata:\n  type: feedback\n---\n${marker}Rule body.\n`,
    'utf8'
  );
  return path;
}

/** The layer-A artifact, written by hand — used to isolate "artifact present". */
function writeLayerAArtifact(root: string, name: string): void {
  const id = sopIdForFeedback(name);
  const dir = join(root, '.peaks', 'sops', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'sop.json'),
    JSON.stringify({ id, name, phases: ['apply'], gates: [] }, null, 2),
    'utf8'
  );
  writeFileSync(
    join(root, '.peaks', 'sops', 'registry.json'),
    JSON.stringify({ version: 1, sops: [{ id, path: `sops/${id}/sop.json`, gates: [] }], gateCount: 0 }, null, 2),
    'utf8'
  );
}

describe('promotion artifact table (behavior)', () => {
  it('names a different artifact per layer', () => {
    const a = promotionArtifactChecks('rule-x', 'A');
    const b = promotionArtifactChecks('rule-x', 'B');
    const c = promotionArtifactChecks('rule-x', 'C');

    expect(a.map((x) => x.path)).toEqual([`.peaks/sops/${sopIdForFeedback('rule-x')}/sop.json`, '.peaks/sops/registry.json']);
    // Layers B and C are shared files that already exist, so existence alone
    // would pass for the wrong reason — they must register the rule.
    expect(b).toEqual([{ path: '.peaks/.claude-settings-template.json', mustContain: 'rule-x' }]);
    expect(c).toEqual([{ path: 'src/services/code/mode-gate.ts', mustContain: 'rule-x' }]);
  });

  it('reports every unsatisfied check, not just the first', () => {
    const root = project('empty');
    try {
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'A'), root)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires the shared registry to name the rule, not merely to exist', () => {
    const root = project('registry');
    try {
      const id = sopIdForFeedback('rule-x');
      mkdirSync(join(root, '.peaks', 'sops', id), { recursive: true });
      writeFileSync(join(root, '.peaks', 'sops', id, 'sop.json'), '{}', 'utf8');
      writeFileSync(join(root, '.peaks', 'sops', 'registry.json'), JSON.stringify({ version: 1, sops: [] }), 'utf8');

      const missing = missingArtifacts(promotionArtifactChecks('rule-x', 'A'), root);
      expect(missing).toEqual(['.peaks/sops/registry.json (does not reference "feedback-rule-x")']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Gate H input: marker without artifact is not a promotion (integration)', () => {
  it('AC1 — a marker alone does not pass', () => {
    const root = project('ac1');
    try {
      writeMemory(root, 'ac-pair', 'A');

      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['ac-pair']);
      // The reason must distinguish "never promoted" from "promoted on paper".
      expect(unpromoted[0]!.reason).toContain('marker claims layer A but the artifact is missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC2 — the same tree with the artifact present passes', () => {
    const root = project('ac2');
    try {
      writeMemory(root, 'ac-pair', 'A');
      writeLayerAArtifact(root, 'ac-pair');

      expect(listUnpromotedFeedback({ projectRoot: root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks comment-only markers too (most legacy promotions have no sidecar)', () => {
    const root = project('comment-only');
    try {
      writeMemory(root, 'legacy-a', 'A');
      expect(existsSync(join(root, MEMORY_DIR, 'legacy-a.promotion.json'))).toBe(false);

      expect(listUnpromotedFeedback({ projectRoot: root }).map((u) => u.name)).toEqual(['legacy-a']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still reports memories with no marker at all', () => {
    const root = project('no-marker');
    try {
      writeMemory(root, 'bare');
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['bare']);
      expect(unpromoted[0]!.reason).toContain('no promotion marker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the tool produces what the gate demands (integration + render)', () => {
  it('AC3/AC6 — a real promote yields an effective promotion and only true paths', async () => {
    const root = project('ac3');
    try {
      const memoryPath = writeMemory(root, 'promoted-rule');

      const envelope = await promoteFeedback({
        feedbackPath: memoryPath,
        layer: 'A',
        promotedBy: 'test',
        sessionId: 'sid-test',
        projectRoot: root
      });

      expect(envelope.effective).toBe(true);
      // AC6: every path the CLI prints as "Generated files:" must exist.
      expect(envelope.generatedFiles.length).toBeGreaterThan(0);
      for (const file of envelope.generatedFiles) {
        expect(existsSync(file), `generated file missing: ${file}`).toBe(true);
      }
      // The envelope must not advertise the stub's targets as generated files.
      expect(envelope.generatedFiles.some((f) => f.endsWith('sops/promoted-rule.md'))).toBe(false);

      // AC3: the artifact the gate checks was produced by the command itself.
      expect(missingArtifacts(promotionArtifactChecks('promoted-rule', 'A'), root)).toEqual([]);
      expect(listUnpromotedFeedback({ projectRoot: root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records the sidecar truthfully instead of naming unwritten paths', async () => {
    const root = project('sidecar');
    try {
      const memoryPath = writeMemory(root, 'promoted-rule');
      await promoteFeedback({
        feedbackPath: memoryPath,
        layer: 'A',
        promotedBy: 'test',
        sessionId: 'sid-test',
        projectRoot: root
      });

      const sidecar = JSON.parse(readFileSync(join(root, MEMORY_DIR, 'promoted-rule.promotion.json'), 'utf8')) as {
        requiredArtifacts: string[];
      };
      expect(sidecar.requiredArtifacts).toEqual([
        `.peaks/sops/${sopIdForFeedback('promoted-rule')}/sop.json`,
        '.peaks/sops/registry.json'
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a layer that the command cannot materialize as not effective', async () => {
    const root = project('layer-c');
    try {
      const memoryPath = writeMemory(root, 'c-rule');

      const envelope = await promoteFeedback({
        feedbackPath: memoryPath,
        layer: 'C',
        promotedBy: 'test',
        sessionId: 'sid-test',
        projectRoot: root
      });

      // Layer C lives in source code: recording the marker is honest, claiming
      // the promotion is effective is not.
      expect(envelope.effective).toBe(false);
      expect(envelope.requiredArtifacts).toEqual(['src/services/code/mode-gate.ts']);
      expect(listUnpromotedFeedback({ projectRoot: root }).map((u) => u.name)).toEqual(['c-rule']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
