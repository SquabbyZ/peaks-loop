// tests/unit/services/distribution/plugin-manifest.test.ts
//
// The generated distribution manifest (PRD rid-037 AC-1, AC-2, AC-3, AC-8).
//
//   AC-1  the committed `.claude-plugin/marketplace.json` IS a render, so a hand
//         edit cannot survive a re-render. The assertion is equality with a
//         FRESH render, and the file carries the control that makes equality
//         mean something: a render from a different version must NOT equal the
//         committed bytes, or the equality would hold for a generator that read
//         nothing.
//   AC-2  `version` is the package's, and the skill count is the tree's —
//         counted here by WALKING the tree, not by asking the registry the
//         generator itself asks (R3: a count that changes with the repo must be
//         compared against the repo, and a self-referential count is not a
//         comparison).
//   AC-3  two renders are byte-identical: no timestamp, no unordered iteration.
//   AC-8  the declared `mcpServers` entry names the CLI's own subcommand, and
//         carries no machine path.
//
// Dimensions covered: render, behavior, integration, a11y.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from 'peaks-loop-shared/paths';

import {
  MCP_SERVER_KEY,
  generatePluginManifest,
  loadPackageManifest,
  pluginManifestPath,
  renderPluginManifest,
  serializePluginManifest
} from '~/src/services/distribution/plugin-manifest';
import { loadSkillRegistry } from '~/src/services/skills/skill-registry';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/distribution/plugin-manifest.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const MANIFEST_PATH = pluginManifestPath();

/** The committed artifact, as text and as a parsed object. */
function committed(): string {
  return readFileSync(MANIFEST_PATH, 'utf8');
}

interface ParsedManifest {
  metadata: { pluginRoot: string; version: string };
  plugins: Array<{
    name: string;
    version: string;
    mcpServers: Record<string, { command: string; args: string[] }>;
    skills: Array<{ name: string; path: string; userInvocable?: boolean }>;
  }>;
}

function committedManifest(): ParsedManifest {
  return JSON.parse(committed()) as ParsedManifest;
}

/**
 * Every `SKILL.md` under the skills tree, found by WALKING — the independent
 * count AC-2 asks for. Deliberately not `loadSkillRegistry`: a count compared
 * against the same source that produced it agrees with itself in every state.
 */
function walkSkillDirs(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name.startsWith('peaks-')) found.push(child);
      if (entry.name === 'bee') visit(child);
    }
  };
  visit(join(root, 'skills'));
  return found;
}

describe('Scenario: render - the artifact is a render, not a file someone edits', () => {
  it('when the committed manifest is compared to a fresh render, should be unchanged', async () => {
    // given: the artifact committed in `.claude-plugin/`
    // when:  it is compared against a fresh render from the same two sources
    // then:  they are byte-identical, so `git diff` after a build stays empty and
    //        a hand edit is red rather than silently overwritten
    expect(committed()).toBe(await renderPluginManifest());
  });

  it('when the manifest is serialized, should end with exactly one newline and re-parse', async () => {
    // given: a fresh render
    // when:  its text is inspected
    // then:  it is pretty JSON, newline-terminated, and round-trips
    const text = await renderPluginManifest();
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(committedManifest());
  });

  it('when the version source changes, should produce different bytes', async () => {
    // given: the same skills rendered against a different package version — the
    //        control that the equality above is not satisfied by a constant
    // when:  the render runs
    // then:  the bytes differ, so the no-drift assertion CAN fail
    const skills = await loadSkillRegistry(join(repoRoot, 'skills'));
    const bumped = serializePluginManifest(
      generatePluginManifest({ ...loadPackageManifest(), version: '0.0.0-control' }, skills.skills)
    );
    expect(bumped).not.toBe(committed());
    expect(bumped).toContain('0.0.0-control');
  });
});

describe('Scenario: behavior - the two sources decide every generated field', () => {
  it('when the generator runs twice, should produce identical bytes', async () => {
    // given: no timestamp, no `Date`, no unordered iteration
    // when:  two independent renders are serialized
    // then:  the bytes match
    expect(await renderPluginManifest()).toBe(await renderPluginManifest());
  });

  it('when the manifest declares a version, should be the package version', () => {
    // given: the package and the manifest
    // when:  both are read
    // then:  the version is the package's, in both places the manifest states it
    const pkg = loadPackageManifest();
    const manifest = committedManifest();
    expect(manifest.metadata.version).toBe(pkg.version);
    expect(manifest.plugins[0]?.version).toBe(pkg.version);
  });

  it('when the manifest lists skills, should list every peaks-* skill directory', () => {
    // given: the skills tree, walked independently
    // when:  its count is compared with the manifest's
    // then:  they agree, and the count is non-empty so the comparison is not vacuous
    const dirs = walkSkillDirs(repoRoot);
    const listed = committedManifest().plugins[0]?.skills ?? [];
    expect(dirs.length).toBeGreaterThan(0);
    expect(listed).toHaveLength(dirs.length);
    expect([...listed].map((skill) => skill.name).sort()).toEqual(
      dirs.map((dir) => dir.split(/[\\/]/).at(-1) ?? '').sort()
    );
  });

  it('when a skill declares itself internal, should carry that as userInvocable false', async () => {
    // given: the registry, whose `visibility` comes from each SKILL.md
    // when:  the manifest entries are read
    // then:  internal is `false` and public is omitted — the contract
    //        `peaks skill:visibility` reads
    const registry = await loadSkillRegistry(join(repoRoot, 'skills'));
    const internal = registry.skills.filter((skill) => skill.visibility === 'internal');
    const listed = committedManifest().plugins[0]?.skills ?? [];
    expect(internal.length).toBeGreaterThan(0);
    for (const skill of listed) {
      const declared = internal.some((candidate) => candidate.name === skill.name);
      expect(skill.userInvocable, `${skill.name} userInvocable`).toBe(declared ? false : undefined);
    }
  });

  it('when the manifest is read, should list skills in a stable order', async () => {
    // given: entries emitted in the registry's sort order
    // when:  the names are read back
    // then:  they are in ascending order, which is what makes two renders match
    const names = (committedManifest().plugins[0]?.skills ?? []).map((skill) => skill.name);
    expect([...names].sort()).toEqual(names);
  });
});

describe('Scenario: integration - the declared MCP entry and the paths it names', () => {
  it('when the manifest declares mcpServers, should name the CLI subcommand', () => {
    // given: the plugin entry
    // when:  its `mcpServers` block is read
    // then:  it names the CLI's own `mcp serve`, so nothing is versioned twice —
    //        there is no separately distributed server to keep aligned
    const servers = committedManifest().plugins[0]?.mcpServers ?? {};
    expect(servers[MCP_SERVER_KEY]).toEqual({ command: MCP_SERVER_KEY, args: ['mcp', 'serve'] });
  });

  it('when a manifest path is declared, should be a directory that holds a SKILL.md', () => {
    // given: the generated entries
    // when:  each declared path is resolved against the repo
    // then:  it is a real skill directory — a render cannot name a directory that
    //        does not exist, because it derived the path from the file it read
    for (const skill of committedManifest().plugins[0]?.skills ?? []) {
      expect(() => readFileSync(join(repoRoot, skill.path, 'SKILL.md'), 'utf8')).not.toThrow();
    }
  });
});

describe('Scenario: a11y - a render that cannot be trusted refuses instead of dropping', () => {
  it('when a SKILL.md is unreadable, should refuse and name the file', async () => {
    // given: a fixture tree whose one skill has no frontmatter
    // when:  the render runs
    // then:  it throws naming the file, rather than silently emitting a manifest
    //        that has lost a skill and is still byte-stable
    const root = mkdtempSync(join(tmpdir(), 'peaks-plugin-manifest-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
      mkdirSync(join(root, 'skills', 'peaks-broken'), { recursive: true });
      writeFileSync(join(root, 'skills', 'peaks-broken', 'SKILL.md'), '# no frontmatter\n');
      await expect(renderPluginManifest(root)).rejects.toThrow(/peaks-broken/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
