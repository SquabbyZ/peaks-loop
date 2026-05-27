import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type SkillPresenceMode = 'full-auto' | 'assisted' | 'swarm' | 'strict';

export const VALID_SKILL_PRESENCE_MODES: ReadonlyArray<SkillPresenceMode> = [
  'full-auto',
  'assisted',
  'swarm',
  'strict'
];

export function isSkillPresenceMode(value: string): value is SkillPresenceMode {
  return (VALID_SKILL_PRESENCE_MODES as ReadonlyArray<string>).includes(value);
}

export type SkillPresence = {
  skill: string;
  mode?: SkillPresenceMode;
  gate?: string;
  setAt: string;
};

const PRESENCE_FILE = '.peaks/.active-skill.json';

function resolvePresencePath(): string {
  return resolve(process.cwd(), PRESENCE_FILE);
}

export function exportSkillPresence(): string {
  return resolvePresencePath();
}

export function setSkillPresence(skill: string, mode?: string, gate?: string): SkillPresence {
  const validatedMode = mode && isSkillPresenceMode(mode) ? mode : undefined;

  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    setAt: new Date().toISOString()
  };

  const presencePath = resolvePresencePath();
  const presenceDir = dirname(presencePath);
  if (!existsSync(presenceDir)) {
    mkdirSync(presenceDir, { recursive: true });
  }

  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');
  return presence;
}

export function getSkillPresence(): SkillPresence | null {
  const presencePath = resolvePresencePath();
  if (!existsSync(presencePath)) {
    return null;
  }

  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }
    return parsed as SkillPresence;
  } catch {
    return null;
  }
}

export function clearSkillPresence(): boolean {
  const presencePath = resolvePresencePath();
  if (!existsSync(presencePath)) {
    return false;
  }

  try {
    unlinkSync(presencePath);
    return true;
  } catch {
    return false;
  }
}
