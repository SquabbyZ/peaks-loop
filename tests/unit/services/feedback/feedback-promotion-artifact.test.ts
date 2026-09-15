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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  HARD_FLOOR_CATEGORIES,
  isHardFloorCategory,
  shouldPauseAtGate,
  type HardFloorCategory
} from '~/src/services/code/mode-gate';
import {
  listPromotionExempt,
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

/**
 * A memory with arbitrary extra frontmatter and/or a not-to-promote declaration.
 * `extraFrontmatter` lines are emitted verbatim so a case can choose the indent
 * (top-level vs under `metadata:`).
 */
function writeDeclaredMemory(
  root: string,
  name: string,
  opts: {
    extraFrontmatter?: string[];
    declaration?: { code: string; reason?: string | null };
    layer?: 'A' | 'B' | 'C';
  } = {}
): string {
  mkdirSync(join(root, MEMORY_DIR), { recursive: true });
  const marker = opts.layer === undefined ? '' : `<!-- peaks-feedback-promoted: layer=${opts.layer} -->\n\n`;
  const lines = [
    '---',
    `name: ${name}`,
    'description: fixture rule',
    'metadata:',
    '  type: feedback',
    ...(opts.extraFrontmatter ?? []),
    ...(opts.declaration === undefined
      ? []
      : [
          `notToPromote: ${opts.declaration.code}`,
          ...(opts.declaration.reason === null || opts.declaration.reason === undefined
            ? []
            : [`notToPromoteReason: "${opts.declaration.reason}"`])
        ]),
    '---'
  ];
  const path = join(root, MEMORY_DIR, `${name}.md`);
  writeFileSync(path, `${lines.join('\n')}\n${marker}Rule body.\n`, 'utf8');
  return path;
}

describe('promotion artifact table (behavior)', () => {
  it('names a different artifact per layer', () => {
    const a = promotionArtifactChecks('rule-x', 'A');
    const b = promotionArtifactChecks('rule-x', 'B');
    const c = promotionArtifactChecks('rule-x', 'C');

    expect(a.map((x) => x.path)).toEqual([`.peaks/sops/${sopIdForFeedback('rule-x')}/sop.json`, '.peaks/sops/registry.json']);
    expect(a.map((x) => x.evidence)).toEqual(['sop-manifest', 'sop-registry-entry']);
    // Layers B and C are shared files that already exist, so existence alone
    // would pass for the wrong reason — they must register the rule, and
    // "register" is a shape the file has to parse into (a name in the bytes is
    // not a registration).
    expect(b).toEqual([{ path: '.peaks/.claude-settings-template.json', evidence: 'hook-registration', id: 'rule-x' }]);
    expect(c).toEqual([{ path: 'src/services/code/mode-gate.ts', evidence: 'hard-floor-category', id: 'rule-x' }]);
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
      // A manifest that IS well-formed, so this case isolates the registry half.
      writeFileSync(join(root, '.peaks', 'sops', id, 'sop.json'), JSON.stringify({ id, gates: [] }), 'utf8');
      writeFileSync(join(root, '.peaks', 'sops', 'registry.json'), JSON.stringify({ version: 1, sops: [] }), 'utf8');

      const missing = missingArtifacts(promotionArtifactChecks('rule-x', 'A'), root);
      expect(missing).toEqual([`.peaks/sops/registry.json (registry has no SOP entry with id "${id}")`]);
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

// rid 2026-09-14-gate-h-promotion (classify slice): the gate knew only
// "has artifact" / "has no artifact", so a memory that prescribes no action could
// never pass. The declaration gives it a way to say so — bounded, corroborated,
// reported, and unable to bury a broken promotion.
describe('the not-to-promote declaration (behavior + integration)', () => {
  it('CONTROL — a merely unpromoted memory still fails, and only the declaration changes that', () => {
    const root = project('decl-control');
    try {
      writeDeclaredMemory(root, 'bare-rule');
      expect(listUnpromotedFeedback({ projectRoot: root }).map((u) => u.name)).toEqual(['bare-rule']);
      expect(listPromotionExempt({ projectRoot: root })).toEqual([]);

      // Same tree, same gate: add the declaration (and the frontmatter claim it
      // restates) and the memory leaves the failure set — visibly, not silently.
      writeDeclaredMemory(root, 'bare-rule', {
        extraFrontmatter: ['  scope: harness-level / non-actionable'],
        declaration: { code: 'non-actionable', reason: 'records an observation; prescribes no action' }
      });
      expect(listUnpromotedFeedback({ projectRoot: root })).toEqual([]);
      expect(listPromotionExempt({ projectRoot: root }).map((e) => `${e.name}:${e.code}`)).toEqual([
        'bare-rule:non-actionable'
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a declaration the memory itself does not corroborate', () => {
    const root = project('decl-uncorroborated');
    try {
      // `notToPromote: non-actionable` but no `non-actionable` anywhere in the
      // memory: a declaration may restate a claim, never invent one.
      writeDeclaredMemory(root, 'unbacked', {
        declaration: { code: 'non-actionable', reason: 'trust me' }
      });
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['unbacked']);
      expect(unpromoted[0]!.reason).toContain('not corroborated');
      expect(listPromotionExempt({ projectRoot: root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a code outside the closed vocabulary', () => {
    const root = project('decl-freeform');
    try {
      writeDeclaredMemory(root, 'custom-code', {
        extraFrontmatter: ['  scope: x / non-actionable'],
        declaration: { code: 'because-i-said-so', reason: 'free text is not a code' }
      });
      expect(listUnpromotedFeedback({ projectRoot: root })[0]!.reason).toContain('not a recognised code');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a declaration with no reason', () => {
    const root = project('decl-noreason');
    try {
      writeDeclaredMemory(root, 'silent-exemption', {
        extraFrontmatter: ['  scope: x / non-actionable'],
        declaration: { code: 'non-actionable', reason: null }
      });
      expect(listUnpromotedFeedback({ projectRoot: root })[0]!.reason).toContain('has no `notToPromoteReason`');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a declaration that coexists with a promotion marker (cannot bury a broken promotion)', () => {
    const root = project('decl-contradiction');
    try {
      writeDeclaredMemory(root, 'both-claims', {
        extraFrontmatter: ['  scope: x / non-actionable'],
        declaration: { code: 'non-actionable', reason: 'both at once' },
        layer: 'A'
      });
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['both-claims']);
      expect(unpromoted[0]!.reason).toContain('carries both a layer A promotion marker');
      expect(listPromotionExempt({ projectRoot: root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a closed-slice note corroborated by the artifact it cites', () => {
    const root = project('decl-slice-note');
    try {
      writeDeclaredMemory(root, 'design-note', {
        extraFrontmatter: ['  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md'],
        declaration: { code: 'closed-slice-note', reason: 'a design record from a closed slice' }
      });
      expect(listUnpromotedFeedback({ projectRoot: root })).toEqual([]);
      expect(listPromotionExempt({ projectRoot: root })[0]!.code).toBe('closed-slice-note');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to promote a memory that declares itself out of the gate', async () => {
    const root = project('decl-promote');
    try {
      const memoryPath = writeDeclaredMemory(root, 'declared', {
        extraFrontmatter: ['  scope: x / non-actionable'],
        declaration: { code: 'non-actionable', reason: 'not a rule' }
      });
      // Tool and gate must agree: the command may not print `effective: true` for
      // the very state the gate rejects.
      await expect(
        promoteFeedback({ feedbackPath: memoryPath, layer: 'A', promotedBy: 'test', sessionId: 'sid-test', projectRoot: root })
      ).rejects.toThrow(/contradict that declaration/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// rid 2026-09-14-gate-h-promotion (R2): every layer used to be checked with
// `text.includes(<rule>)` over the whole file. A substring test cannot tell
// "the rule is registered" from "a comment saying the rule is absent", so a
// tree that was a pure REFUSAL passed all three layers: an invalid-JSON
// registry, a settings template saying "do NOT add a matcher", a mode-gate line
// saying the rule is deliberately not a category — in each case the rule's name
// was still in the bytes. Each check now parses its evidence and asserts the
// SHAPE, and a file it cannot read or parse is a finding, not a permit.
describe('the artifact must be parsed, not merely mentioned (behavior + integration)', () => {
  it('AC4/AC2 — layer A: same substring, refusal vs registry entry', () => {
    const root = project('fool-a');
    try {
      const id = sopIdForFeedback('rule-x');
      writeMemory(root, 'rule-x', 'A');
      mkdirSync(join(root, '.peaks', 'sops', id), { recursive: true });
      writeFileSync(join(root, '.peaks', 'sops', id, 'sop.json'), JSON.stringify({ id, gates: [] }), 'utf8');
      const registryPath = join(root, '.peaks', 'sops', 'registry.json');

      // The refusal: the id is in the bytes and the file is not JSON.
      const refusal = `{\n  "sops": [\n    { "id": "${id}", "path": "sops/${id}/sop.json" },\n  ]\n  <<< not JSON >>>\n`;
      writeFileSync(registryPath, refusal, 'utf8');
      expect(refusal.includes(`"${id}"`)).toBe(true); // the substring the old check matched on
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'A'), root)).toHaveLength(1);

      // The genuine entry: the same substring, inside a file that parses.
      writeFileSync(
        registryPath,
        JSON.stringify({ version: 1, sops: [{ id, path: `sops/${id}/sop.json`, gates: [] }], gateCount: 0 }),
        'utf8'
      );
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'A'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC4/AC2 — layer B: naming the rule in prose is not registering a hook', () => {
    const root = project('fool-b');
    try {
      writeMemory(root, 'rule-x', 'B');
      const templatePath = join(root, '.peaks', '.claude-settings-template.json');

      const prose = { env: { NOTE: 'do NOT add a matcher for rule-x' }, hooks: { PreToolUse: [] } };
      writeFileSync(templatePath, JSON.stringify(prose, null, 2), 'utf8');
      expect(JSON.stringify(prose).includes('rule-x')).toBe(true); // the substring the old check matched on
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root)).toHaveLength(1);

      writeFileSync(
        templatePath,
        JSON.stringify(
          { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/enforce-rule-x.js' }] }] } },
          null,
          2
        ),
        'utf8'
      );
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC4/AC2 — layer C: a line saying the rule is NOT a category is not a category', () => {
    const root = project('fool-c');
    try {
      writeMemory(root, 'rule-x', 'C');
      const gateDir = join(root, 'src', 'services', 'code');
      mkdirSync(gateDir, { recursive: true });
      const gatePath = join(gateDir, 'mode-gate.ts');

      const refusal = [
        '// TODO: rule-x is DELIBERATELY NOT a hard-floor category.',
        'export type HardFloorCategory =',
        "  | 'irreversible-external-side-effect';",
        '',
        'export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [',
        "  'irreversible-external-side-effect'",
        '] as const;',
        ''
      ].join('\n');
      writeFileSync(gatePath, refusal, 'utf8');
      expect(refusal.includes('rule-x')).toBe(true); // the substring the old check matched on
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'C'), root)).toHaveLength(1);

      // A real registration: the rule is cited by the doc block of a member of
      // the vocabulary (this repo's layer-C convention).
      const genuine = [
        'export type HardFloorCategory =',
        "  | 'irreversible-external-side-effect';",
        '',
        'export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [',
        '  /**',
        '   * Per `.peaks/memory/rule-x.md` (user-given rule): always pauses.',
        '   */',
        "  'rule-x-rule'",
        '] as const;',
        ''
      ].join('\n');
      writeFileSync(gatePath, genuine, 'utf8');
      expect(genuine.includes('rule-x')).toBe(true);
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'C'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC3 — absent, unparseable, misshaped, empty or unreadable is a finding, never a permit', () => {
    const root = project('ac3-cases');
    try {
      writeMemory(root, 'rule-x', 'A');
      const id = sopIdForFeedback('rule-x');
      const manifestPath = join(root, '.peaks', 'sops', id, 'sop.json');
      mkdirSync(join(root, '.peaks', 'sops', id), { recursive: true });
      const manifestOnly = promotionArtifactChecks('rule-x', 'A').filter((c) => c.evidence === 'sop-manifest');
      const decision = (): string => {
        const missing = missingArtifacts(manifestOnly, root);
        return missing.length === 0 ? 'permitted' : missing[0]!;
      };

      // 1. the file is missing
      expect(decision()).toContain('(absent)');
      // 2. the file is present but is not valid JSON
      writeFileSync(manifestPath, `{ "id": "${id}", <<< not json >>> `, 'utf8');
      expect(decision()).toContain('not valid JSON');
      // 3. valid JSON whose shape is not the expected one
      writeFileSync(manifestPath, '[1, 2, 3]', 'utf8');
      expect(decision()).toContain('not a JSON object');
      // 4. it parses but is empty
      writeFileSync(manifestPath, '{}', 'utf8');
      expect(decision()).toContain('does not declare id');
      // 5. the path exists but cannot be read — a directory here raises the same
      //    error class as a permission denial, and must not read as "backed".
      rmSync(manifestPath, { force: true });
      mkdirSync(manifestPath, { recursive: true });
      expect(decision()).toContain('(unreadable)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC6 — the gate still bites: the control memories are still reported', () => {
    const root = project('ac6-control');
    try {
      writeMemory(root, 'control-unpromoted'); // no marker at all
      writeMemory(root, 'control-paper-only', 'A'); // marker, no artifact
      const unpromoted = listUnpromotedFeedback({ projectRoot: root });
      expect(unpromoted.map((u) => u.name)).toEqual(['control-paper-only', 'control-unpromoted']);
      expect(unpromoted[0]!.reason).toContain('marker claims layer A but the artifact is missing');
      expect(unpromoted[1]!.reason).toContain('no promotion marker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC5 — the repo\'s own layer-C promotion is still backed (calibration, not a fixture)', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    // The one real layer-C promotion cites its memory from the category's doc
    // block. Reporting it missing would be a false positive on a file already
    // known good — the calibration the reader needs before it is trusted.
    expect(missingArtifacts(promotionArtifactChecks('2026-06-28-full-auto-boundary', 'C'), repoRoot)).toEqual([]);
    // ...and the same file must NOT back a rule it merely mentions elsewhere.
    expect(missingArtifacts(promotionArtifactChecks('rule-x', 'C'), repoRoot)).toHaveLength(1);
  });
});

// rid 2026-09-14-gate-h-promotion (R8): the substring survived R2's repair in two
// places, both measured live. Layer C read a member's `doc` from the RAW source,
// so an adverse line dropped between two vocabulary members became the following
// member's doc and matched by NAME mention — the verdict flipped on where the
// comment sat. Layer B kept `matcher.includes(id)` / `command.includes(id)` over
// free text, so a hook command that SAID "do NOT add a matcher for rule-x"
// registered a rule. Both are now parsed, and both refusals are asserted here so
// they cannot come back.
describe('the verdict does not depend on where the refusal sits (behavior)', () => {
  /** The two declarations, with `line` spliced in at `at`. */
  function gateSource(at: 'union' | 'array' | 'member-doc' | 'other-member' | null, line: string): string {
    const union = [
      'export type HardFloorCategory =',
      ...(at === 'union' ? [`  ${line}`] : []),
      "  | 'irreversible-external-side-effect'",
      ...(at === 'other-member' ? ['  /**', `   * ${line}`, '   */'] : []),
      "  | 'authentication-credential';"
    ];
    const array = [
      'export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [',
      ...(at === 'member-doc' ? ['  /**', `   * ${line}`, '   */'] : []),
      "  'irreversible-external-side-effect',",
      ...(at === 'array' ? [`  ${line}`] : []),
      "  'authentication-credential'",
      '] as const;'
    ];
    return [...union, '', ...array, ''].join('\n');
  }

  it('AC2 — layer C: the adverse line is rejected in EVERY placement', () => {
    const root = project('r8-c-placements');
    try {
      writeMemory(root, 'rule-x', 'C');
      const gateDir = join(root, 'src', 'services', 'code');
      mkdirSync(gateDir, { recursive: true });
      const gatePath = join(gateDir, 'mode-gate.ts');
      const adverse = '// TODO: rule-x is DELIBERATELY NOT a hard-floor category.';

      const placements = {
        outside: `${adverse}\n${gateSource(null, '')}`,
        union: gateSource('union', adverse),
        array: gateSource('array', adverse),
        'member-doc': gateSource('member-doc', adverse),
        // the residual R2 disclosed: adverse prose governing a DIFFERENT member
        'other-member': gateSource('other-member', adverse)
      };

      for (const [placement, source] of Object.entries(placements)) {
        writeFileSync(gatePath, source, 'utf8');
        expect(
          missingArtifacts(promotionArtifactChecks('rule-x', 'C'), root),
          `placement "${placement}" must not read as a registration`
        ).toHaveLength(1);
      }

      // ...and the repo's own form — the memory cited by PATH from a member's doc
      // block — still registers.
      writeFileSync(gatePath, gateSource('member-doc', '* Per `.peaks/memory/rule-x.md`: always pauses.'), 'utf8');
      expect(missingArtifacts(promotionArtifactChecks('rule-x', 'C'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC3 — layer B: a hook command is argv, not prose', () => {
    const root = project('r8-b-argv');
    try {
      writeMemory(root, 'rule-x', 'B');
      const templatePath = join(root, '.peaks', '.claude-settings-template.json');
      const template = (group: unknown): string => JSON.stringify({ hooks: { PreToolUse: [group] } }, null, 2);

      const refusals: Record<string, unknown> = {
        // R2 passed this: the rule's name was in the field's BYTES.
        'echoed refusal': { matcher: 'Bash', hooks: [{ type: 'command', command: "echo 'do NOT add a matcher for rule-x'" }] },
        // A matcher selects TOOLS; this one's second segment is not a tool.
        'negating tool selector': { matcher: 'Bash|rule-x-is-not-a-matcher', hooks: [] },
        'bare negating word': { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo rule-x-is-not-a-hook' }] }
      };
      for (const [label, group] of Object.entries(refusals)) {
        writeFileSync(templatePath, template(group), 'utf8');
        expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root), label).toHaveLength(1);
      }

      // ...while a hook that RUNS something named after the rule still registers,
      // quoted or not.
      for (const command of ['node scripts/enforce-rule-x.js', 'node "C:/p/hooks/enforce-rule-x.js"']) {
        writeFileSync(templatePath, template({ matcher: 'Bash', hooks: [{ type: 'command', command }] }), 'utf8');
        expect(missingArtifacts(promotionArtifactChecks('rule-x', 'B'), root), command).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// rid 2026-09-14-gate-h-promotion (R10): the check read the `HardFloorCategory`
// union and `HARD_FLOOR_CATEGORIES` as one flattened member list, so a member of
// the union ALONE satisfied it. That is a gate verdict that is true while the
// thing it certifies is inert: `isHardFloorCategory` reads only the array, so
// `shouldPauseAtGate` returns `shouldPause: false` for the very category the gate
// just reported BACKED. Measured on the pre-change bytes:
//
//   union-only literal              -> gate BACKED | isHardFloorCategory false | shouldPause false
//   union-only doc citation         -> gate BACKED | isHardFloorCategory false | shouldPause false
//   array member cited by doc (repo)-> gate BACKED | isHardFloorCategory true  | shouldPause true
//
// Both halves are asserted below, in both directions: a verdict alone was not
// enough to establish the defect and is not enough to establish the repair.
describe('the check certifies what ENFORCES, not what is merely declared (behavior + integration)', () => {
  /** A `mode-gate.ts` whose UNION names `member` while its ARRAY does not. */
  function unionOnlyGate(member: string, doc?: string): string {
    return [
      'export type HardFloorCategory =',
      ...(doc === undefined ? [] : ['  /**', `   * ${doc}`, '   */']),
      `  | '${member}'`,
      "  | 'irreversible-external-side-effect';",
      '',
      'export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [',
      "  'irreversible-external-side-effect'",
      '] as const;',
      ''
    ].join('\n');
  }

  /** The same rule, registered the way the repo registers one: array + cited doc. */
  function arrayBackedGate(member: string): string {
    return [
      'export type HardFloorCategory =',
      "  | 'irreversible-external-side-effect';",
      '',
      'export const HARD_FLOOR_CATEGORIES: readonly HardFloorCategory[] = [',
      '  /**',
      `   * Per \`.peaks/memory/${member}.md\`: always pauses.`,
      '   */',
      `  '${member}',`,
      "  'irreversible-external-side-effect'",
      '] as const;',
      ''
    ].join('\n');
  }

  it('AC2 — a union-only member is rejected, and the half it certifies is inert', () => {
    const root = project('r10-union-only');
    try {
      writeMemory(root, 'rule-x', 'C');
      const gateDir = join(root, 'src', 'services', 'code');
      mkdirSync(gateDir, { recursive: true });
      const gatePath = join(gateDir, 'mode-gate.ts');
      const subject = 'rule-x';
      const asCategory = subject as HardFloorCategory;

      // (a) the rule name as a union-only literal. Pre-change this was BACKED.
      writeFileSync(gatePath, unionOnlyGate(subject), 'utf8');
      expect(missingArtifacts(promotionArtifactChecks(subject, 'C'), root)).toHaveLength(1);
      // The second half of the conjunction: what that verdict certified. Asking the
      // runtime the same file defines.
      expect(isHardFloorCategory(subject)).toBe(false);
      expect(shouldPauseAtGate({ mode: '24h', step: 'phase-2-prd-confirm', hardFloorCategory: asCategory }).shouldPause).toBe(
        false
      );

      // (b) a union-only member whose doc CITES the memory — the citation form of
      //     the same defect. Pre-change this was BACKED too.
      writeFileSync(gatePath, unionOnlyGate('rule-x-holder', 'Per `.peaks/memory/rule-x.md`: always pauses.'), 'utf8');
      expect(missingArtifacts(promotionArtifactChecks(subject, 'C'), root)).toHaveLength(1);

      // (c) the genuine form — array-backed, cited by its own doc block — passes.
      writeFileSync(gatePath, arrayBackedGate(subject), 'utf8');
      expect(missingArtifacts(promotionArtifactChecks(subject, 'C'), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC2 — the gate and `isHardFloorCategory` agree on every member (fixture-free calibration)', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

    // Every category the ARRAY enforces is backed by the gate...
    for (const category of HARD_FLOOR_CATEGORIES) {
      expect(missingArtifacts(promotionArtifactChecks(category, 'C'), repoRoot), `must back "${category}"`).toEqual([]);
      expect(isHardFloorCategory(category), `"${category}" is in the array and must enforce`).toBe(true);
    }
    // ...and a literal the array does not contain is rejected by BOTH halves, so
    // neither can drift into certifying the other's absence.
    for (const outsider of ['rule-x', 'multi-day-investments', 'irreversible-external-side-effects']) {
      expect(missingArtifacts(promotionArtifactChecks(outsider, 'C'), repoRoot), outsider).toHaveLength(1);
      expect(isHardFloorCategory(outsider), outsider).toBe(false);
    }
  });

  it('AC3 — the message names the declaration the predicate reads', () => {
    const root = project('r10-message');
    try {
      writeMemory(root, 'rule-x', 'C');
      const gateDir = join(root, 'src', 'services', 'code');
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(join(gateDir, 'mode-gate.ts'), unionOnlyGate('rule-x'), 'utf8');

      const [failure] = missingArtifacts(promotionArtifactChecks('rule-x', 'C'), root);
      // The check has always SAID this. R10 is the change that made it true.
      expect(failure).toContain('must be a member of HARD_FLOOR_CATEGORIES');
      expect(HARD_FLOOR_CATEGORIES as readonly string[]).not.toContain('rule-x');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
