import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * SOP path model — "definition global, execution per-project".
 *
 * A SOP *definition* (manifest + SKILL.md) and the registry live under the
 * global Peaks home (`~/.peaks/sops/`) so one authored SOP is reusable across
 * every project. A SOP's *run-state* (current phase, bypass history) lives
 * under the project it runs in (`<project>/.peaks/sop-state/<id>.json`) so the
 * same global SOP tracks independent progress per project. Gate checks always
 * resolve their target paths against the caller's `--project` — that is what
 * makes a relative gate path (`posts/current.md`) reusable across projects.
 *
 * `PEAKS_HOME` overrides the global root; tests inject a temp dir through it so
 * a unit test never reads or writes the real `~/.peaks`.
 */

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
