import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * SOP path model — two definition layers + per-project run-state.
 *
 * A SOP *definition* (manifest + SKILL.md) and its registry can live in two
 * layers:
 *   - GLOBAL (`~/.peaks/sops/`): your personal SOPs, reusable across every
 *     project on this machine.
 *   - PROJECT (`<project>/.peaks/sops/`): committed into the repo, so a teammate
 *     who clones it gets the SOP — and, with the gate hook installed, is enforced
 *     too. The project layer takes PRECEDENCE over global for the same id.
 *
 * A SOP's *run-state* (current phase, bypass history) always lives under the
 * project it runs in (`<project>/.peaks/sop-state/<id>/`), so the same SOP tracks
 * independent progress per project. Gate checks resolve their target paths
 * against the caller's `--project`, which is what makes a relative gate path
 * (`posts/current.md`) reusable across projects.
 *
 * `PEAKS_HOME` overrides the global root; tests inject a temp dir through it so
 * a unit test never reads or writes the real `~/.peaks`.
 */

export type SopScope = 'project' | 'global';

/** Global Peaks home (`~/.peaks`), overridable via PEAKS_HOME for test isolation. */
export function peaksHome(): string {
  const override = process.env.PEAKS_HOME;
  return override !== undefined && override.length > 0 ? resolve(override) : join(homedir(), '.peaks');
}

/** Global SOP definition directory: `~/.peaks/sops/<id>`. */
export function sopDir(id: string): string {
  return join(peaksHome(), 'sops', id);
}

/** Global SOP manifest: `~/.peaks/sops/<id>/sop.json`. */
export function sopManifestPath(id: string): string {
  return join(sopDir(id), 'sop.json');
}

/** Global SOP skill: `~/.peaks/sops/<id>/SKILL.md`. */
export function sopSkillPath(id: string): string {
  return join(sopDir(id), 'SKILL.md');
}

/** Global registry of all registered SOPs: `~/.peaks/sops/registry.json`. */
export function registryPath(): string {
  return join(peaksHome(), 'sops', 'registry.json');
}

/** Project SOP definition directory: `<project>/.peaks/sops/<id>` (committed, team-shared). */
export function projectSopDir(projectRoot: string, id: string): string {
  return join(projectRoot, '.peaks', 'sops', id);
}

/** Project SOP manifest: `<project>/.peaks/sops/<id>/sop.json`. */
export function projectSopManifestPath(projectRoot: string, id: string): string {
  return join(projectSopDir(projectRoot, id), 'sop.json');
}

/** Project SOP skill: `<project>/.peaks/sops/<id>/SKILL.md`. */
export function projectSopSkillPath(projectRoot: string, id: string): string {
  return join(projectSopDir(projectRoot, id), 'SKILL.md');
}

/** Project registry: `<project>/.peaks/sops/registry.json` (committed, team-shared). */
export function projectRegistryPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'sops', 'registry.json');
}

/** Definition directory for a scope. */
export function scopedSopDir(scope: SopScope, projectRoot: string | undefined, id: string): string {
  if (scope === 'project') {
    if (projectRoot === undefined) throw new Error('Project scope requires a project root');
    return projectSopDir(projectRoot, id);
  }
  return sopDir(id);
}

/** Manifest path for a scope. */
export function scopedSopManifestPath(scope: SopScope, projectRoot: string | undefined, id: string): string {
  return join(scopedSopDir(scope, projectRoot, id), 'sop.json');
}

/** Registry path for a scope. */
export function scopedRegistryPath(scope: SopScope, projectRoot: string | undefined): string {
  if (scope === 'project') {
    if (projectRoot === undefined) throw new Error('Project scope requires a project root');
    return projectRegistryPath(projectRoot);
  }
  return registryPath();
}

/**
 * Resolve where a SOP's manifest lives, project-first: the project layer wins
 * when present, otherwise global. Returns null when neither layer has it.
 */
export function resolveSopManifestPath(id: string, projectRoot?: string): { path: string; scope: SopScope } | null {
  if (projectRoot !== undefined) {
    const projectPath = projectSopManifestPath(projectRoot, id);
    if (existsSync(projectPath)) {
      return { path: projectPath, scope: 'project' };
    }
  }
  const globalPath = sopManifestPath(id);
  if (existsSync(globalPath)) {
    return { path: globalPath, scope: 'global' };
  }
  return null;
}

/**
 * Per-project run-state directory for a SOP: `<project>/.peaks/sop-state/<id>/`.
 * Holds `state.json` (current phase + history) and the bypass counter, so a
 * SOP's execution data stays isolated per project even though its definition is
 * global.
 */
export function sopStateDir(projectRoot: string, id: string): string {
  return join(projectRoot, '.peaks', 'sop-state', id);
}

/** Per-project run-state file for a SOP: `<project>/.peaks/sop-state/<id>/state.json`. */
export function sopStatePath(projectRoot: string, id: string): string {
  return join(sopStateDir(projectRoot, id), 'state.json');
}
