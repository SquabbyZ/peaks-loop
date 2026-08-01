import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SkillJunctionReference = {
  readonly junctionPath: string;
  readonly target: string;
};

export function findManagedSkillJunctionReferences(input: {
  readonly worktreePath: string;
  readonly skillRoots: ReadonlyArray<string>;
}): ReadonlyArray<SkillJunctionReference> {
  const targetRoot = resolve(input.worktreePath);
  const refs: SkillJunctionReference[] = [];
  for (const skillRoot of input.skillRoots) {
    if (!existsSync(skillRoot)) continue;
    for (const name of readdirSync(skillRoot)) {
      if (!name.startsWith('peaks-') || name.endsWith('.peaks-managed')) continue;
      const junctionPath = resolve(skillRoot, name);
      const markerPath = `${junctionPath}.peaks-managed`;
      if (!existsSync(markerPath)) continue;
      try {
        if (!lstatSync(junctionPath).isSymbolicLink()) continue;
        const link = readlinkSync(junctionPath);
        const resolvedTarget = resolve(dirname(junctionPath), link);
        if (isInside(targetRoot, resolvedTarget)) refs.push({ junctionPath, target: resolvedTarget });
      } catch {
        const managedTarget = readFileSync(markerPath, 'utf8').trim();
        if (managedTarget.length > 0 && isInside(targetRoot, managedTarget)) {
          refs.push({ junctionPath, target: managedTarget });
        }
      }
    }
  }
  return refs;
}

function isInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolve(parent).toLowerCase();
  const normalizedCandidate = resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}\\`) || normalizedCandidate.startsWith(`${normalizedParent}/`);
}
