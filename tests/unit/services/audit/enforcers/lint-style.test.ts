/**
 * Unit tests for P2-a Themes A + B enforcers (lint-style.ts).
 *
 * Themes:
 *   A — Section structure (5 enforcers)
 *   B — Frontmatter shape (3 enforcers)
 *
 * Each enforcer is a pure pattern scan on a SkillFile. Tests
 * exercise both the positive (rule satisfied → no hit) and the
 * negative (rule violated → hit reported) cases.
 */
import { describe, it, expect } from 'vitest';
import {
  lintSectionShape,
  lintSectionOrder,
  lintFrontmatterShape,
  lintReferenceLoadStrategy,
  type SkillFile,
} from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(body: string, name = 'peaks-test'): SkillFile {
  return {
    name,
    path: `skills/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-style — Theme A section structure', () => {
  it('passes when a skill has all 5 required section headings', () => {
    const skill = makeSkill(`# peaks-test

## Two-axis naming convention
> change-id / session-id orthogonal axes.

## Hard contracts for browser/IO surface
Read this before any browser work.

## Mandatory per-request artifact
.peaks/<changeId>/request/0001.md

## Default runbook
See references/runbook.md

## RD gate index
- Gate A: skill
- Gate B: spec-locked
`);
    expect(lintSectionShape(skill)).toEqual([]);
  });

  it('reports a hit for every missing section heading', () => {
    const skill = makeSkill(`# peaks-test

This skill has no recognized section headings at all.
`);
    const hits = lintSectionShape(skill);
    // 5 themes A enforcers × 1 hit each
    expect(hits).toHaveLength(5);
    const ids = hits.map((h) => h.catalogId).sort();
    expect(ids).toEqual([
      'rl-section-default-runbook-001',
      'rl-section-gate-index-001',
      'rl-section-hard-contracts-001',
      'rl-section-mandatory-artifact-001',
      'rl-section-naming-axiom-001',
    ]);
  });
});

describe('lint-style — Theme A wireframe (section order)', () => {
  it('passes when sections are in canonical order', () => {
    const skill = makeSkill(`# peaks-test

## Two-axis naming convention
change-id / session-id.

## Hard contracts for browser/IO surface
read this first.

## Mandatory per-request artifact
.peaks/...

## Default runbook
see references/runbook.md
`);
    expect(lintSectionOrder(skill)).toEqual([]);
  });

  it('reports a hit when Default runbook comes before Hard contracts (wrong wireframe order)', () => {
    const skill = makeSkill(`# peaks-test

## Two-axis naming convention
top of file.

## Default runbook
appears too early!

## Hard contracts for browser/IO surface
should come first.
`);
    const hits = lintSectionOrder(skill);
    // The "Hard contracts" line is later than "Default runbook",
    // so the wireframe enforcer fires on the later occurrence.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-section-order-wireframe-001');
  });
});

describe('lint-style — Theme B frontmatter shape', () => {
  it('passes when frontmatter has name, description, and applicableTaskLevels', () => {
    const skill = makeSkill(`---
name: peaks-test
description: |
  Test skill for P2-a lint-style enforcers.
applicableTaskLevels: [L1a, L1b]
---

# peaks-test

body
`);
    expect(lintFrontmatterShape(skill)).toEqual([]);
  });

  it('reports a hit when the frontmatter is missing the name line', () => {
    const skill = makeSkill(`---
description: missing the name field
applicableTaskLevels: [L1a]
---
body
`);
    const hits = lintFrontmatterShape(skill);
    expect(hits.some((h) => h.catalogId === 'rl-frontmatter-skills-md-001')).toBe(true);
  });

  it('reports a hit when applicableTaskLevels is missing', () => {
    const skill = makeSkill(`---
name: peaks-test
description: frontmatter is parseable but no task-levels annotation
---
body
`);
    const hits = lintFrontmatterShape(skill);
    expect(hits.some((h) => h.catalogId === 'rl-frontmatter-applicable-task-levels-001')).toBe(true);
  });
});

describe('lint-style — Theme B reference loadStrategy', () => {
  it('reports a hit when a reference does not declare loadStrategy', () => {
    // We use the peaks-solo/references/runbook.md file, which
    // intentionally does not declare a loadStrategy in the
    // upstream skill-slim convention — this is itself a real
    // P2-a finding (the enforcer is the truth).
    const refs = ['runbook.md'];
    const root = 'skills/peaks-solo/references';
    const hits = lintReferenceLoadStrategy(root, refs);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-frontmatter-references-load-strategy-001');
  });

  it('passes when every reference declares a loadStrategy (uses an inline temp file)', () => {
    // Write a temp file with a loadStrategy line and verify
    // the helper returns no hits.
    const tmpDir = `${process.cwd()}/.peaks/_runtime/2026-06-11-session-edbe91/lint-tmp`;
    const fs = require('node:fs');
    fs.mkdirSync(tmpDir, { recursive: true });
    const refFile = `${tmpDir}/ref-with-strategy.md`;
    fs.writeFileSync(refFile, '---\nloadStrategy: always\n---\n# body\n');
    try {
      const hits = lintReferenceLoadStrategy(tmpDir, ['ref-with-strategy.md']);
      expect(hits).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
