/**
 * retrospective-index — load `.peaks/retrospective/index.json`, parse to
 * `RetrospectiveEntry[]`, return the index envelope.
 *
 * Slice 023 (R3). Pure read on the hot path: a single `fs.readFile` of
 * the index, no MD-tree fallback. The migration script (G9) is the only
 * writer; this loader is read-only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type RetrospectiveType = 'refactor' | 'feature' | 'bugfix' | 'config' | 'docs' | 'chore';
export type RetrospectiveOutcome = 'shipped' | 'blocked' | 'in-flight' | 'cancelled';

export interface RetrospectiveEntry {
  id: string;
  sessionId: string;
  sliceId?: string;
  type: RetrospectiveType;
  title: string;
  summary: string;
  outcome: RetrospectiveOutcome;
  keyDecisions: string[];
  lessonsLearned: number;
  artifactPaths: string[];
  updatedAt: string;
}

export interface RetrospectiveIndex {
  version: 1;
  updatedAt: string;
  entries: RetrospectiveEntry[];
}

export interface RetrospectiveIndexResult {
  projectRoot: string;
  indexPath: string;
  entries: RetrospectiveEntry[];
  totalCount: number;
  source: 'index.json' | null;
  warning: string | null;
}

const VALID_TYPES = new Set<RetrospectiveType>(['refactor', 'feature', 'bugfix', 'config', 'docs', 'chore']);
const VALID_OUTCOMES = new Set<RetrospectiveOutcome>(['shipped', 'blocked', 'in-flight', 'cancelled']);

export function loadRetrospectiveIndex(projectRoot: string): RetrospectiveIndexResult {
  const resolvedRoot = resolve(projectRoot);
  const indexPath = join(resolvedRoot, '.peaks', 'retrospective', 'index.json');
  if (!existsSync(indexPath)) {
    return {
      projectRoot: resolvedRoot,
      indexPath,
      entries: [],
      totalCount: 0,
      source: null,
      warning: 'no retrospective index; run `peaks retrospective migrate --apply` to build one from legacy MDs'
    };
  }

  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch {
    return {
      projectRoot: resolvedRoot,
      indexPath,
      entries: [],
      totalCount: 0,
      source: null,
      warning: `failed to read retrospective index at ${indexPath}`
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      projectRoot: resolvedRoot,
      indexPath,
      entries: [],
      totalCount: 0,
      source: null,
      warning: `retrospective index at ${indexPath} is not valid JSON`
    };
  }

  const entries = extractEntries(parsed);
  const sorted = [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    projectRoot: resolvedRoot,
    indexPath,
    entries: sorted,
    totalCount: sorted.length,
    source: 'index.json',
    warning: null
  };
}

function extractEntries(parsed: unknown): RetrospectiveEntry[] {
  if (parsed === null || typeof parsed !== 'object') return [];
  const obj = parsed as { entries?: unknown; version?: unknown };
  if (!Array.isArray(obj.entries)) return [];
  const result: RetrospectiveEntry[] = [];
  for (const candidate of obj.entries) {
    if (!isRetrospectiveEntry(candidate)) continue;
    result.push(candidate);
  }
  return result;
}

function isRetrospectiveEntry(value: unknown): value is RetrospectiveEntry {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.sessionId !== 'string') return false;
  if (typeof v.type !== 'string' || !VALID_TYPES.has(v.type as RetrospectiveType)) return false;
  if (typeof v.title !== 'string') return false;
  if (typeof v.summary !== 'string') return false;
  if (typeof v.outcome !== 'string' || !VALID_OUTCOMES.has(v.outcome as RetrospectiveOutcome)) return false;
  if (!Array.isArray(v.keyDecisions)) return false;
  if (!v.keyDecisions.every((decision) => typeof decision === 'string')) return false;
  if (typeof v.lessonsLearned !== 'number' || !Number.isInteger(v.lessonsLearned) || v.lessonsLearned < 0) return false;
  if (!Array.isArray(v.artifactPaths)) return false;
  if (!v.artifactPaths.every((p) => typeof p === 'string')) return false;
  if (typeof v.updatedAt !== 'string') return false;
  if (v.sliceId !== undefined && typeof v.sliceId !== 'string') return false;
  return true;
}
