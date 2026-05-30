import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';

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
  sessionId?: string;
  claudeSessionId?: string;
  setAt: string;
  lastHeartbeat?: string;
};

/**
 * The current Claude Code session id, exposed to Bash tool calls via the
 * CLAUDE_CODE_SESSION_ID environment variable. Stamping it onto the presence
 * file lets the read-only status line tell whether the recorded skill belongs
 * to the live session (show it) or a previous one (render idle).
 */
function getCurrentClaudeSessionId(): string | undefined {
  const value = process.env.CLAUDE_CODE_SESSION_ID;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const PRESENCE_FILE = '.peaks/.active-skill.json';
const SESSION_FILE = '.peaks/.session.json';

function resolveProjectRoot(override?: string): string {
  if (override) return resolve(override);
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

function resolvePresencePath(projectRootOverride?: string): string {
  return resolve(resolveProjectRoot(projectRootOverride), PRESENCE_FILE);
}

function getCurrentSessionId(projectRootOverride?: string): string | null {
  const sessionPath = resolve(resolveProjectRoot(projectRootOverride), SESSION_FILE);
  if (!existsSync(sessionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(sessionPath, 'utf8'));
    return typeof data.sessionId === 'string' && data.sessionId.length > 0
      ? data.sessionId
      : null;
  } catch {
    return null;
  }
}

export function exportSkillPresence(projectRootOverride?: string): string {
  return resolvePresencePath(projectRootOverride);
}

export function setSkillPresence(skill: string, mode?: string, gate?: string, projectRootOverride?: string): SkillPresence {
  const validatedMode = mode && isSkillPresenceMode(mode) ? mode : undefined;
  const sessionId = getCurrentSessionId(projectRootOverride);
  const claudeSessionId = getCurrentClaudeSessionId();

  const now = new Date().toISOString();
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(claudeSessionId ? { claudeSessionId } : {}),
    setAt: now,
    lastHeartbeat: now
  };

  const presencePath = resolvePresencePath(projectRootOverride);
  const presenceDir = dirname(presencePath);
  if (!existsSync(presenceDir)) {
    mkdirSync(presenceDir, { recursive: true });
  }

  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');
  return presence;
}

export function getSkillPresence(projectRootOverride?: string): SkillPresence | null {
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) {
    return null;
  }

  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }

    if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      const currentSessionId = getCurrentSessionId(projectRootOverride);
      if (currentSessionId && parsed.sessionId !== currentSessionId) {
        unlinkSync(presencePath);
        return null;
      }
    }

    return parsed as SkillPresence;
  } catch {
    return null;
  }
}

export function touchSkillHeartbeat(projectRootOverride?: string): SkillPresence | null {
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) {
    return null;
  }

  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }

    if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      const currentSessionId = getCurrentSessionId(projectRootOverride);
      if (currentSessionId && parsed.sessionId !== currentSessionId) {
        unlinkSync(presencePath);
        return null;
      }
    }

    parsed.lastHeartbeat = new Date().toISOString();
    writeFileSync(presencePath, JSON.stringify(parsed, null, 2), 'utf8');
    return parsed as SkillPresence;
  } catch {
    return null;
  }
}

export function clearSkillPresence(projectRootOverride?: string): boolean {
  const presencePath = resolvePresencePath(projectRootOverride);
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
