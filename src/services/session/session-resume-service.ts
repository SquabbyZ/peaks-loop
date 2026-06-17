/**
 * `peaks session resume` — slice 011.
 *
 * Reads a checkpoint JSON (written by `peaks session checkpoint`) and
 * emits a structured markdown "resume context" block the skill can
 * prepend to its own prompt. The output is LLM-friendly: stable
 * headings, monospace paths, and bullet lists — easy for the model to
 * scan and reason about.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { readCheckpoint, type CheckpointSnapshot } from './session-checkpoint-service.js';

export interface ResumeOptions {
  /** Absolute path to a checkpoint JSON file. */
  checkpointPath: string;
  /** Optional "now" reference for relative-time rendering. */
  now?: () => Date;
}

export interface ResumeContext {
  /** Stable markdown block, suitable for prepending to a skill prompt. */
  markdown: string;
  snapshot: CheckpointSnapshot;
  sourcePath: string;
  checkpointAgeMs: number | null;
  relativeAgeLabel: string;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function formatRelativeAge(ms: number): string {
  if (ms < 0) return 'in the future';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}

function renderSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return `### ${title}\n\n_(none)_\n`;
  }
  return `### ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}\n`;
}

export function buildResumeContext(options: ResumeOptions): ResumeContext {
  const path = options.checkpointPath;
  if (!existsSync(path)) {
    throw new Error(`RESUME_NOT_FOUND: checkpoint file not found: ${path}`);
  }
  try {
    readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`RESUME_READ_FAILED: cannot read checkpoint: ${message}`);
  }
  const snapshot = readCheckpoint(path);
  const now = (options.now ?? (() => new Date()))();
  let ageMs: number | null = null;
  let relativeAgeLabel = 'unknown age';
  try {
    const created = new Date(snapshot.createdAt);
    if (!Number.isNaN(created.getTime())) {
      ageMs = now.getTime() - created.getTime();
      relativeAgeLabel = formatRelativeAge(ageMs);
    }
  } catch {
    // leave defaults
  }

  const lines: string[] = [];
  lines.push('## Resume context (from checkpoint)');
  lines.push('');
  lines.push(`- Source: \`${toPosix(path)}\``);
  lines.push(`- Checkpoint basename: \`${basename(path)}\``);
  lines.push(`- Session id: \`${snapshot.sessionId}\``);
  lines.push(`- Captured at: \`${snapshot.createdAt}\``);
  lines.push(`- Last session activity: \`${snapshot.lastActivity}\``);
  lines.push(`- Reason: \`${snapshot.reason}\``);
  lines.push(`- Relative age: **${relativeAgeLabel}**`);
  lines.push('');
  lines.push('### Current plan');
  lines.push('');
  lines.push(snapshot.currentPlan.trim().length > 0 ? snapshot.currentPlan : '_(none)_');
  lines.push('');
  lines.push(renderSection('Open questions', snapshot.openQuestions));
  lines.push(renderSection('Recent decisions', snapshot.recentDecisions));
  lines.push(renderSection('Recent artifact paths', snapshot.recentArtifactPaths));
  lines.push(renderSection('Todo state', snapshot.todoState));
  lines.push(renderSection('Active skills', snapshot.skillsActive));
  if (snapshot.gitStatus.trim().length > 0) {
    lines.push('### Git status');
    lines.push('');
    lines.push('```');
    lines.push(snapshot.gitStatus.trim());
    lines.push('```');
    lines.push('');
  }

  return {
    markdown: lines.join('\n'),
    snapshot,
    sourcePath: toPosix(path),
    checkpointAgeMs: ageMs,
    relativeAgeLabel
  };
}