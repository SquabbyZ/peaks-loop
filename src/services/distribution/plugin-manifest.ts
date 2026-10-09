// src/services/distribution/plugin-manifest.ts
//
// The plugin/distribution manifest as a GENERATED artefact (spec §4.1). One
// source, two renders: the whitelist artifact is what the read-only claim is
// made of, and this file is what the distribution channel is told.
//
// WHY IT IS GENERATED. The hand-authored `.claude-plugin/marketplace.json` had
// rotted in the only two fields anybody could check and nobody did: it declared
// version `2.0.3` while the package was `4.1.2`, and 12 skills while the tree
// held 22. Root cause is not carelessness — it is that the current distribution
// channel is `npm i -g`, so nothing ever read the plugin manifest and no failure
// could be observed from it. A file whose author is a human and whose reader is
// nobody will drift; the fix is to remove the human from the loop, not to be
// more careful.
//
// CHANGE THE SOURCE, NOT THIS FILE. Everything below is derived, and
// `tests/unit/services/distribution/plugin-manifest.test.ts` fails the moment
// the committed artefact differs from a fresh render. A hand edit is therefore
// not merely overwritten, it is RED. To change the manifest, change
// `package.json` (a plugin-level field) or the skill's own `SKILL.md`
// (a skill entry) and re-run `pnpm plugin:manifest`.
//
// DETERMINISM. No timestamp, no `Date`, no unordered iteration: skills come back
// from `loadSkillRegistry`, which sorts by name, and every plugin-level field is
// copied from `package.json` in a fixed order. Two consecutive runs are
// byte-identical, which is what makes the CI equality assertion mean something.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { repoRoot } from 'peaks-loop-shared/paths';

import { loadSkillRegistry, type SkillMetadata } from '../skills/skill-registry.js';

/** Where the generator writes, relative to the package root. */
export const PLUGIN_MANIFEST_RELATIVE_PATH = '.claude-plugin/marketplace.json';

/**
 * The server key peaks registers itself under. It is OUR key, not a harness's —
 * the adapter profiles that name it (`IdeMcpInstallProfile.serverName`) and the
 * tool-name templates that match it (`IdeAdapter.mcp`) must agree with this one,
 * which is why it is declared once.
 */
export const MCP_SERVER_KEY = 'peaks';

/** The subset of `package.json` this render reads. */
interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly repository?: { readonly url?: string } | string;
  readonly license?: string;
  readonly keywords?: readonly string[];
}

/** One plugin entry's skill list item — the shape `peaks skill:visibility` reads. */
interface PluginSkillEntry {
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly userInvocable?: boolean;
}

interface GeneratedPluginManifest {
  readonly metadata: { readonly pluginRoot: string; readonly version: string };
  readonly plugins: readonly {
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly author: { readonly name: string };
    readonly homepage: string;
    readonly repository: string;
    readonly license: string;
    readonly keywords: readonly string[];
    /**
     * Declared, and deliberately not brought live: the plugin channel is not
     * published by this slice (PRD non-goal), so this is the statement of what
     * the channel WOULD run, kept true by generation rather than by memory.
     *
     * The command is the CLI's own name and subcommand, with no path in it: a
     * manifest is built on one machine and read on another, so an absolute
     * interpreter path resolved here would be the build host's. The RUNTIME
     * registration is a different artefact with a different consumer and does
     * resolve the pair — see `mcp-install.ts::resolveMcpServerArgv`.
     */
    readonly mcpServers: Record<
      string,
      { readonly command: string; readonly args: readonly string[] }
    >;
    readonly skills: readonly PluginSkillEntry[];
  }[];
}

/** `package.json`, parsed. A missing version is a refusal, not a default. */
export function loadPackageManifest(root: string = repoRoot): PackageManifest {
  const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }
  return parsed;
}

/** A repository URL as a manifest reads it: npm's `.git` suffix is not part of the link. */
function repositoryUrl(manifest: PackageManifest): string {
  const raw =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return (raw ?? '').replace(/\.git$/, '');
}

/** POSIX-separated, so the artifact is byte-identical whichever OS generated it. */
function posix(value: string): string {
  return value.split('\\').join('/');
}

/**
 * The skill entries, in the registry's order.
 *
 * `visibility: internal` is the skill's own declaration that it is an internal
 * role rather than a front door, and it is the ONE source for `userInvocable` —
 * the field is emitted only when it is `false`, which is the contract
 * `skill:visibility` reads ("internal: userInvocable false; public: omitted").
 */
export function skillEntriesOf(skills: readonly SkillMetadata[]): readonly PluginSkillEntry[] {
  return skills
    .filter((skill) => skill.name.startsWith('peaks-'))
    .map((skill) => ({
      name: skill.name,
      path: `./${posix(relative(repoRoot, dirname(skill.skillPath)))}`,
      description: skill.description,
      ...(skill.visibility === 'internal' ? { userInvocable: false } : {})
    }));
}

/**
 * Render the manifest. `skills` is passed in rather than loaded here so the one
 * caller that must fail loudly on an unreadable SKILL.md can do so once.
 */
export function generatePluginManifest(
  manifest: PackageManifest,
  skills: readonly SkillMetadata[]
): GeneratedPluginManifest {
  return {
    metadata: { pluginRoot: '.', version: manifest.version },
    plugins: [
      {
        name: manifest.name,
        description: manifest.description ?? '',
        version: manifest.version,
        author: { name: manifest.author ?? '' },
        homepage: manifest.homepage ?? '',
        repository: repositoryUrl(manifest),
        license: manifest.license ?? '',
        keywords: [...(manifest.keywords ?? [])],
        mcpServers: {
          [MCP_SERVER_KEY]: { command: MCP_SERVER_KEY, args: ['mcp', 'serve'] }
        },
        skills: skillEntriesOf(skills)
      }
    ]
  };
}

/** Pretty JSON, newline-terminated — the same serialization contract as the whitelist. */
export function serializePluginManifest(manifest: GeneratedPluginManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Absolute path of the committed artifact for a package root. */
export function pluginManifestPath(root: string = repoRoot): string {
  return join(root, PLUGIN_MANIFEST_RELATIVE_PATH);
}

/**
 * The whole render for a package root: read the two sources, refuse a skill tree
 * that did not fully parse, and serialize.
 *
 * The `failures` refusal is the load-bearing part. `loadSkillRegistry` reports an
 * unreadable `SKILL.md` in a `failures` array instead of throwing, so a render
 * that ignored it would DROP a skill from the manifest and still be
 * byte-stable — a green CI over a manifest that had silently lost entries. A
 * drift assertion cannot be stronger than its input, so the input is required to
 * be complete.
 */
export async function renderPluginManifest(root: string = repoRoot): Promise<string> {
  const skills = await loadSkillRegistry(join(root, 'skills'));
  if (skills.failures.length > 0) {
    const named = skills.failures.map((failure) => failure.skillPath).join(', ');
    throw new Error(`Refusing to render the plugin manifest: unreadable skill(s): ${named}`);
  }
  return serializePluginManifest(generatePluginManifest(loadPackageManifest(root), skills.skills));
}
