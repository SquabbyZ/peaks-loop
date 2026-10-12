// tests/unit/services/feedback/feedback-promotion-layer-b-locations.test.ts
//
// Layer B's backing check used to read ONE file — the generated
// `.peaks/.claude-settings-template.json` snapshot — and the template that
// produces that snapshot stopped emitting this repository's own two hooks, so
// the next refresh made the check report two genuinely enforced rules as
// unpromoted. The check now accepts either location.
//
// Dimensions (per tests/unit/_setup/4dim-template.ts):
//   - behavior:    a check backed by either location, and by neither
//   - integration: real fs boundary (.peaks/memory + the two settings files)
//   - render:      the reported reason names every location that was searched

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  listUnpromotedFeedback,
  missingArtifacts,
  promotionArtifactChecks
} from '~/src/services/feedback/feedback-promotion-service';

/** The generated snapshot `peaks workspace init` writes. */
const SNAPSHOT = join('.peaks', '.claude-settings-template.json');
/** This repository's tracked settings file. */
const TRACKED = join('.claude', 'settings.json');

declareDimensions(
  'tests/unit/services/feedback/feedback-promotion-layer-b-locations.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason:
        'no user-facing render surface; the gate output is machine-readable JSON asserted under render'
    }
  ]
);

/** A settings body registering `id` the way this repo registers one: argv, not prose. */
function registers(id: string): unknown {
  return {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: `node scripts/enforce-${id}.js` }] }
      ]
    }
  };
}

/** A settings body whose only mention of `id` is a sentence about it. */
function mentionsOnly(id: string): unknown {
  return { env: { NOTE: `do NOT add a matcher for ${id}` }, hooks: { PreToolUse: [] } };
}

/** A project root holding exactly the settings files named. */
function projectWith(prefix: string, files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), `peaks-${prefix}-`));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(body, null, 2), 'utf8');
  }
  return root;
}

/** A feedback memory claiming layer B via the HTML comment marker. */
function writeMemory(root: string, name: string): void {
  mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', 'memory', `${name}.md`),
    `---\nname: ${name}\ndescription: fixture rule\nmetadata:\n  type: feedback\n---\n<!-- peaks-feedback-promoted: layer=B -->\n\nRule body.\n`,
    'utf8'
  );
}

describe('the layer-B check names two legitimate locations (behavior)', () => {
  it('keeps one check, and spells the tracked file as its alternative', () => {
    const checks = promotionArtifactChecks('rule-x', 'B');
    expect(checks).toHaveLength(1);
    expect(checks[0]!.path).toBe('.peaks/.claude-settings-template.json');
    expect(checks[0]!.alternatives).toEqual(['.claude/settings.json']);
  });

  it('is backed by the snapshot alone — the consumer shape', () => {
    const root = projectWith('b-consumer', { [SNAPSHOT]: registers('rule-x') });
    try {
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is backed by the tracked file alone — this repository's shape", () => {
    const root = projectWith('b-repo', {
      [SNAPSHOT]: registers('someone-elses-rule'),
      [TRACKED]: registers('rule-x')
    });
    try {
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is still reported when NEITHER location carries it', () => {
    const root = projectWith('b-neither', { [SNAPSHOT]: mentionsOnly('rule-x') });
    try {
      const missing = missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root);
      expect(missing).toHaveLength(1);
      // Both places were looked in, and the report says so.
      expect(missing[0]).toContain('.peaks/.claude-settings-template.json');
      expect(missing[0]).toContain('.claude/settings.json (absent)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is not backed by a location that merely mentions the rule', () => {
    const root = projectWith('b-prose', {
      [SNAPSHOT]: mentionsOnly('rule-x'),
      [TRACKED]: mentionsOnly('rule-x')
    });
    try {
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the promotion gate reads both locations (integration)', () => {
  it('a refreshed snapshot does not un-promote a rule the tracked file registers', () => {
    // The regression: the snapshot lost the hook, the tracked file kept it.
    const root = projectWith('b-regression', {
      [SNAPSHOT]: registers('someone-elses-rule'),
      [TRACKED]: registers('enforced-rule')
    });
    try {
      writeMemory(root, 'enforced-rule');
      expect(listUnpromotedFeedback({ projectRoot: root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CONTROL — the same tree with no tracked file IS reported', () => {
    const root = projectWith('b-control', { [SNAPSHOT]: registers('someone-elses-rule') });
    try {
      writeMemory(root, 'enforced-rule');
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['enforced-rule']);
      expect(unpromoted[0]!.reason).toContain('marker claims layer B but the artifact is missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CONTROL — a memory with no marker at all is still reported', () => {
    const root = projectWith('b-no-marker', { [TRACKED]: registers('enforced-rule') });
    try {
      mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
      writeFileSync(
        join(root, '.peaks', 'memory', 'bare.md'),
        '---\nname: bare\ndescription: fixture\nmetadata:\n  type: feedback\n---\nRule body.\n',
        'utf8'
      );
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['bare']);
      expect(unpromoted[0]!.reason).toContain('no promotion marker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the reported reason is readable (render)', () => {
  it('names every location searched, so half a search is never reported', () => {
    const root = projectWith('b-render', { [SNAPSHOT]: mentionsOnly('rule-x') });
    try {
      const [reason] = missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root);
      expect(reason).toBe(
        '.peaks/.claude-settings-template.json (no hook registration runs anything named "rule-x" ' +
          '(a hook command must invoke a file named after the rule)); .claude/settings.json (absent)'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
