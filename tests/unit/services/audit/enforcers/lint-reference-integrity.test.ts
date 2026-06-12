/**
 * Unit tests for P2-a Theme E — reference integrity enforcers.
 *
 * Four enforcers scan a skill body for inline shell patterns
 * (mkdir, cd, cp/mv/ln) that violate the project's "no shell
 * outside the project" rule, and one enforcer checks that
 * `references/<file>.md` links resolve on disk.
 */
import { describe, it, expect } from 'vitest';
import {
  lintRefPathResolves,
  lintNoBrokenMkdir,
  lintNoPwdSymlinkJumps,
  lintNoRelativeArchivePaths,
} from '../../../../../src/services/audit/enforcers/lint-reference-integrity.js';
import type { SkillFile } from '../../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(body: string): SkillFile {
  return {
    name: 'peaks-test',
    path: 'skills/peaks-test/SKILL.md',
    body,
    lines: body.split(/\r?\n/),
  };
}

describe('lint-reference-integrity — Theme E', () => {
  it('passes when no references/ link is missing', () => {
    // Use the project itself as the fixture.
    const skillsRoot = 'skills';
    const hits = lintRefPathResolves(skillsRoot, 'peaks-solo', ['runbook.md']);
    expect(hits).toEqual([]);
  });

  it('reports a hit for a missing reference path', () => {
    const skillsRoot = 'skills';
    const hits = lintRefPathResolves(skillsRoot, 'peaks-solo', ['this-reference-does-not-exist.md']);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-ref-path-resolves-001');
  });

  it('passes when no `mkdir -p /abs/path` shell snippet is present', () => {
    const skill = makeSkill(`# peaks-test

This body has no problematic mkdir patterns.
Use \`peaks workspace init\` to create directories.
`);
    expect(lintNoBrokenMkdir(skill)).toEqual([]);
  });

  it('reports a hit for a `mkdir -p /abs/path` pattern', () => {
    const skill = makeSkill(`# peaks-test

Run the following:

  mkdir -p /tmp/some-bad-place
`);
    const hits = lintNoBrokenMkdir(skill);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-ref-no-broken-mkdir-001');
  });

  it('reports a hit for a `cd ..` shell pattern', () => {
    const skill = makeSkill(`# peaks-test

  cd ../
  ls
`);
    const hits = lintNoPwdSymlinkJumps(skill);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-ref-no-pwd-symlink-jumps-001');
  });

  it('reports a hit for a `cp /tmp/...` shell pattern', () => {
    const skill = makeSkill(`# peaks-test

  cp /tmp/foo ./
`);
    const hits = lintNoRelativeArchivePaths(skill);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.catalogId).toBe('rl-ref-no-relative-archive-paths-001');
  });
});
