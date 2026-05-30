import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';

/**
 * Out-of-band Peaks skill status renderer for the Claude Code statusLine.
 *
 * Claude Code invokes the configured statusLine command on every turn and pipes
 * a JSON session payload on stdin. This renderer reads the durable presence file
 * (.peaks/.active-skill.json) and prints a single line that Claude Code paints at
 * the bottom of the terminal. Because it is rendered by the harness — not emitted
 * as LLM tokens — the signal cannot be forgotten by the model, cannot be confused
 * with normal output, and survives context compaction.
 *
 * This module is intentionally READ-ONLY. Unlike getSkillPresence in
 * skill-presence-service.ts, it never deletes or rewrites the presence file:
 * the statusLine runs on every turn and must have zero side effects.
 */

const PRESENCE_FILE = '.peaks/.active-skill.json';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type StatusLineStdin = {
  workspace?: { current_dir?: string; project_dir?: string };
  cwd?: string;
  session_id?: string;
};

export type StatusLineState = 'active' | 'idle' | 'stale' | 'invalid-presence';

export type StatusLinePresence = {
  skill: string;
  mode?: string;
  gate?: string;
  setAt?: string;
  claudeSessionId?: string;
};

export type StatusLineModel = {
  state: StatusLineState;
  projectRoot: string | null;
  presence: StatusLinePresence | null;
  ageMs: number | null;
};

function resolveCwdFromStdin(stdin: StatusLineStdin | null): string {
  const fromWorkspace = stdin?.workspace?.current_dir ?? stdin?.workspace?.project_dir;
  if (typeof fromWorkspace === 'string' && fromWorkspace.length > 0) {
    return resolve(fromWorkspace);
  }
  if (typeof stdin?.cwd === 'string' && stdin.cwd.length > 0) {
    return resolve(stdin.cwd);
  }
  return process.cwd();
}

export function parseStatusLineStdin(raw: string): StatusLineStdin | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed as StatusLineStdin;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the presence file without any side effects. Returns null when the file is
 * absent (idle) and a sentinel object for malformed content (invalid-presence).
 */
function readPresenceReadOnly(projectRoot: string): { presence: StatusLinePresence | null; invalid: boolean } {
  const presencePath = resolve(projectRoot, PRESENCE_FILE);
  if (!existsSync(presencePath)) {
    return { presence: null, invalid: false };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(presencePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { presence: null, invalid: true };
    }
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.skill !== 'string' || candidate.skill.length === 0) {
      return { presence: null, invalid: true };
    }
    return {
      presence: {
        skill: candidate.skill,
        ...(typeof candidate.mode === 'string' ? { mode: candidate.mode } : {}),
        ...(typeof candidate.gate === 'string' ? { gate: candidate.gate } : {}),
        ...(typeof candidate.setAt === 'string' ? { setAt: candidate.setAt } : {}),
        ...(typeof candidate.claudeSessionId === 'string' ? { claudeSessionId: candidate.claudeSessionId } : {})
      },
      invalid: false
    };
  } catch {
    return { presence: null, invalid: true };
  }
}

export function buildStatusLineModel(stdin: StatusLineStdin | null, nowMs: number): StatusLineModel {
  const cwd = resolveCwdFromStdin(stdin);
  const projectRoot = findProjectRoot(cwd);

  if (projectRoot === null) {
    return { state: 'idle', projectRoot: null, presence: null, ageMs: null };
  }

  const { presence, invalid } = readPresenceReadOnly(projectRoot);
  if (invalid) {
    return { state: 'invalid-presence', projectRoot, presence: null, ageMs: null };
  }
  if (presence === null) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null };
  }

  // Session binding: when the presence was stamped with a Claude session id and
  // the live session (from stdin) is a different one, the recorded skill belongs
  // to a previous session — render idle instead of a stale "active" skill. When
  // either id is absent (legacy presence, or harness that omits session_id) we
  // fall back to the time-based behavior below for backward compatibility.
  const liveSessionId = typeof stdin?.session_id === 'string' && stdin.session_id.length > 0 ? stdin.session_id : null;
  if (presence.claudeSessionId && liveSessionId && presence.claudeSessionId !== liveSessionId) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null };
  }

  const setAtMs = presence.setAt ? Date.parse(presence.setAt) : Number.NaN;
  const ageMs = Number.isNaN(setAtMs) ? null : nowMs - setAtMs;
  const state: StatusLineState = ageMs !== null && ageMs > STALE_THRESHOLD_MS ? 'stale' : 'active';

  return { state, projectRoot, presence, ageMs };
}
