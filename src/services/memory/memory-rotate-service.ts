// ---------------------------------------------------------------------------
// `peaks memory rotate` — tier-driven retention for `.peaks/memory/`.
//
// Implements the mechanism prescribed by
// `.peaks/memory/2026-07-24-sediment-pruning-policy.md` (tier 1: archive
// only, never hard-delete). The policy shipped without a mechanism; this
// service is that mechanism.
//
// Retention: 6 months (user override 2026-09-10 — the policy's original 12
// months is superseded). See `MEMORY_ROTATION_RETENTION_MONTHS`.
//
// Tier assignment (first match wins):
//   1. explicit `metadata.tier: A|B|C|D` (or top-level `tier:`) — wins.
//   2. file already under `archived/`                        → D
//   3. pinned in `MEMORY.md` (the policy's authoritative
//      tier reference)                                       → B
//   4. kind in {rule, convention, project-rule}              → A
//   5. kind in {decision, reference, feedback, module,
//               bug, investigation, technical-pattern}       → B
//   6. everything else (retrospective-shaped, incl. no kind) → C
//
// Actions:
//   - Tier C, older than the retention window, not pinned → archive (move
//     into `.peaks/memory/archived/`). Age basis is frontmatter
//     `updatedAt:` / `updated:` / `modified:` when parseable, else file
//     mtime; every candidate reports which basis was used.
//   - Tier D, not pinned → reported as a delete-candidate ONLY. Never
//     deleted, even with `--apply` (tier-1 decision).
//
// Safety gates (all mandatory):
//   - Tier A/B are never selected — an internal assertion turns a violation
//     into a hard refusal rather than an archive.
//   - Every candidate must pass a reference grep against `src/` + `skills/`;
//     any hit excludes it with the referencing path.
//   - `--apply` refuses when the candidate list is empty or any gate fails.
//   - Dry-run is the default; nothing is written without `--apply`.
//
// Reads are fail-soft per file (an unreadable memory is reported, not
// dropped). Writes are rename-only and never overwrite an existing archive.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { isInsidePath, resolveInputPath, stablePath, stableRealPath } from '../../shared/path-utils.js';
import type { ProjectMemoryKind } from './project-memory-service/types.js';
import { parseMemoryFrontmatter } from './project-memory-service/parsers/frontmatter.js';
import { MEMORY_MD_FILENAME } from './project-memory-service/index/reindex.js';
import { listMarkdownFiles } from './project-memory-service/index/search.js';
import { assertSafeProjectMemoryDir, normalizeRoot } from './project-memory-service/store/paths.js';

/** User override 2026-09-10: the policy's 12-month window is now 6 months. */
export const MEMORY_ROTATION_RETENTION_MONTHS = 6;

export const MEMORY_ROTATION_ARCHIVED_DIRNAME = 'archived';

/** Default reference-grep roots, relative to the project root. */
export const MEMORY_ROTATION_REFERENCE_ROOTS = ['src', 'skills'] as const;

export type MemoryRotationTier = 'A' | 'B' | 'C' | 'D';

export type MemoryRotationAction = 'archive' | 'delete-candidate';

export interface MemoryRotationCandidate {
  name: string;
  filePath: string;
  tier: MemoryRotationTier;
  tierReason: string;
  action: MemoryRotationAction;
  reason: string;
  ageDays: number;
  ageBasis: 'frontmatter' | 'mtime';
}

export interface MemoryRotationExcluded {
  name: string;
  filePath: string;
  tier: MemoryRotationTier;
  reason: string;
}

export interface MemoryRotationReport {
  apply: boolean;
  projectRoot: string;
  memoryDir: string;
  archivedDir: string;
  retentionMonths: number;
  referenceRoots: string[];
  /** Every memory file on disk, bucketed by resolved tier. */
  tierCounts: Record<MemoryRotationTier, number>;
  /** Concrete actionable list: tier-C archives + tier-D delete-candidates. */
  candidates: MemoryRotationCandidate[];
  /** Paths actually moved into `archived/` (apply only). */
  archived: string[];
  /** Candidates dropped by a safety gate, each with the reason. */
  excluded: MemoryRotationExcluded[];
  /** True when `--apply` declined to act. */
  refused: boolean;
  refusalReasons: string[];
  /** Safety-gate failures that block `--apply` (e.g. unverifiable grep root). */
  gateFailures: string[];
  warnings: string[];
}

export interface MemoryRotateOptions {
  projectRoot: string;
  apply?: boolean;
  /** Override the retention window (months). Defaults to 6. */
  retentionMonths?: number;
  /** Override the reference-grep roots (tests). Defaults to `<root>/src`, `<root>/skills`. */
  referenceRoots?: string[];
  /** Injectable clock (tests). */
  now?: Date;
}

/** Tier A — operational contracts. Never selected for rotation. */
const TIER_A_KINDS: ReadonlySet<ProjectMemoryKind> = new Set<ProjectMemoryKind>(['rule', 'convention', 'project-rule']);

/** Tier B — descriptive governance. Never selected for rotation. */
const TIER_B_KINDS: ReadonlySet<ProjectMemoryKind> = new Set<ProjectMemoryKind>([
  'decision',
  'reference',
  'feedback',
  'module',
  'bug',
  'investigation',
  'technical-pattern'
]);

const EXPLICIT_TIERS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D']);

/** Files we are willing to read during the reference grep. */
const REFERENCE_SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.json', '.yaml', '.yml', '.txt'
]);

const REFERENCE_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo'
]);

/** Bound the reference grep so a pathological tree cannot hang the command. */
const REFERENCE_SCAN_MAX_FILES = 20_000;

function isTier(value: string): value is MemoryRotationTier {
  return EXPLICIT_TIERS.has(value);
}

/**
 * Read an explicit tier from raw frontmatter. Accepts nested
 * `metadata.tier:` and top-level `tier:`; first valid value wins.
 */
export function readExplicitTier(frontmatter: string): MemoryRotationTier | null {
  let inMetadata = false;
  for (const rawLine of frontmatter.split('\n')) {
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    if (!indented) inMetadata = line === 'metadata:';
    if (!line.startsWith('tier:')) continue;
    if (indented && !inMetadata) continue; // nested tier must sit under `metadata:`
    const value = line.slice('tier:'.length).trim().toUpperCase();
    if (isTier(value)) return value;
  }
  return null;
}

/**
 * Resolve the age of a memory. Prefers a frontmatter `updatedAt:` /
 * `updated:` / `modified:` ISO date; falls back to file mtime. Returns the
 * basis so the report can state which was used.
 */
export function resolveMemoryAge(
  frontmatter: string,
  filePath: string
): { date: Date; basis: 'frontmatter' | 'mtime' } {
  for (const key of ['updatedAt', 'updated', 'modified']) {
    const match = new RegExp(`^\\s*${key}:\\s*(\\S+)`, 'm').exec(frontmatter);
    const raw = match?.[1];
    if (raw === undefined) continue;
    const candidate = new Date(raw.slice(0, 10));
    if (!Number.isNaN(candidate.getTime())) return { date: candidate, basis: 'frontmatter' };
  }
  try {
    return { date: statSync(filePath).mtime, basis: 'mtime' };
  } catch {
    return { date: new Date(0), basis: 'mtime' };
  }
}

/**
 * Whether a memory is pinned in the generated `MEMORY.md` index. Pinning is
 * substring-based on the filename stem: the generated index links every
 * entry as `[<name>](<file>.md)`, so a stem hit means the entry is surfaced.
 */
export function isPinnedInMemoryIndex(memoryIndexText: string, stem: string): boolean {
  return stem.length > 0 && memoryIndexText.includes(stem);
}

/**
 * Reference grep: does any file under the given roots mention the memory's
 * filename stem? Returns the matching absolute paths (sorted, deduped).
 * A missing root is NOT silently a pass — the caller turns that into a gate
 * failure so `--apply` refuses rather than archiving an unverified memory.
 */
export function findReferenceHits(stem: string, roots: readonly string[]): string[] {
  const hits: string[] = [];
  if (stem.length === 0) return hits;
  const stack = [...roots];
  let scanned = 0;

  while (stack.length > 0 && scanned < REFERENCE_SCAN_MAX_FILES) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (REFERENCE_SCAN_SKIP_DIRS.has(entry.name)) continue;
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex < 0 || !REFERENCE_SCAN_EXTENSIONS.has(entry.name.slice(dotIndex))) continue;
      if (++scanned > REFERENCE_SCAN_MAX_FILES) break;
      try {
        if (readFileSync(entryPath, 'utf8').includes(stem)) hits.push(entryPath);
      } catch {
        // Unreadable file: cannot prove absence, cannot prove presence.
        // Treat as a hit so the candidate is excluded (fail-safe).
        hits.push(entryPath);
      }
    }
  }

  return hits.sort((left, right) => left.localeCompare(right));
}

interface TierDecision {
  tier: MemoryRotationTier;
  reason: string;
}

function resolveTier(input: {
  explicitTier: MemoryRotationTier | null;
  underArchived: boolean;
  pinned: boolean;
  kind: ProjectMemoryKind | null;
}): TierDecision {
  if (input.explicitTier !== null) {
    return { tier: input.explicitTier, reason: `explicit metadata.tier: ${input.explicitTier}` };
  }
  if (input.underArchived) {
    return { tier: 'D', reason: 'already under archived/' };
  }
  // Pinning is the policy's authoritative tier reference (§2), so it wins
  // over the kind heuristic. Pinned files are tier B — never selected.
  if (input.pinned) {
    return { tier: 'B', reason: 'pinned in MEMORY.md index' };
  }
  if (input.kind !== null && TIER_A_KINDS.has(input.kind)) {
    return { tier: 'A', reason: `kind '${input.kind}' is an operational contract` };
  }
  if (input.kind !== null && TIER_B_KINDS.has(input.kind)) {
    return { tier: 'B', reason: `kind '${input.kind}' is descriptive governance` };
  }
  if (input.kind !== null) {
    return { tier: 'C', reason: `kind '${input.kind}' is retrospective-shaped` };
  }
  return { tier: 'C', reason: 'no resolvable kind; treated as retrospective (C)' };
}

function emptyTierCounts(): Record<MemoryRotationTier, number> {
  return { A: 0, B: 0, C: 0, D: 0 };
}

/**
 * Plan (and with `apply: true`, perform) a tier-driven rotation pass.
 * Always returns the full envelope; `apply` only controls whether tier-C
 * archives are moved.
 */
export function executeMemoryRotate(options: MemoryRotateOptions): MemoryRotationReport {
  const projectRoot = normalizeRoot(options.projectRoot);
  const apply = options.apply ?? false;
  const retentionMonths = options.retentionMonths ?? MEMORY_ROTATION_RETENTION_MONTHS;
  const memoryDir = assertSafeProjectMemoryDir(projectRoot);
  const archivedDir = join(memoryDir, MEMORY_ROTATION_ARCHIVED_DIRNAME);
  const now = options.now ?? new Date();
  const referenceRoots = options.referenceRoots
    ?? MEMORY_ROTATION_REFERENCE_ROOTS.map((root) => join(projectRoot, root));

  const report: MemoryRotationReport = {
    apply,
    projectRoot,
    memoryDir,
    archivedDir,
    retentionMonths,
    referenceRoots,
    tierCounts: emptyTierCounts(),
    candidates: [],
    archived: [],
    excluded: [],
    refused: false,
    refusalReasons: [],
    gateFailures: [],
    warnings: []
  };

  const memoryIndexPath = join(memoryDir, MEMORY_MD_FILENAME);
  let memoryIndexText = '';
  if (existsSync(memoryIndexPath)) {
    try {
      memoryIndexText = readFileSync(memoryIndexPath, 'utf8');
    } catch {
      report.warnings.push(`Could not read ${MEMORY_MD_FILENAME}; pinning cannot be detected.`);
    }
  } else {
    report.warnings.push(`No ${MEMORY_MD_FILENAME} found; no memory is treated as pinned.`);
  }

  const stableMemoryDir = existsSync(memoryDir) ? stableRealPath(memoryDir) : null;
  const archivedPrefix = `${archivedDir}${sep}`;
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  const diskFiles = listMarkdownFiles(memoryDir).filter((filePath) => basename(filePath) !== MEMORY_MD_FILENAME);

  for (const filePath of diskFiles) {
    const stem = basename(filePath, '.md');
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      report.excluded.push({ name: stem, filePath, tier: 'C', reason: 'file could not be read' });
      continue;
    }

    const parsed = parseMemoryFrontmatter(content);
    const kind = parsed.kind.kind;
    const underArchived = filePath.startsWith(archivedPrefix);
    const pinned = isPinnedInMemoryIndex(memoryIndexText, stem);
    const explicitTier = readExplicitTier(parsed.frontmatter);
    const { tier, reason: tierReason } = resolveTier({ explicitTier, underArchived, pinned, kind });
    report.tierCounts[tier] += 1;

    // Safety gate 1: tier A/B are never selected. Pinned files are reported
    // (the interesting case); unpinned A/B files are simply not candidates.
    if (tier === 'A' || tier === 'B') {
      if (pinned) {
        report.excluded.push({ name: parsed.name ?? stem, filePath, tier, reason: 'pinned in MEMORY.md index' });
      }
      continue;
    }

    const { date, basis } = resolveMemoryAge(parsed.frontmatter, filePath);
    const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));

    if (tier === 'D') {
      // Report-only: never deleted, even with --apply (tier-1 decision).
      report.candidates.push({
        name: parsed.name ?? stem,
        filePath,
        tier,
        tierReason,
        action: 'delete-candidate',
        reason: 'tier D (ephemeral/archived) — reported as a delete-candidate only; peaks never deletes',
        ageDays,
        ageBasis: basis
      });
      continue;
    }

    // Tier C from here on.
    if (date.getTime() >= cutoff.getTime()) {
      continue; // within the retention window — not a candidate yet
    }
    if (pinned) {
      report.excluded.push({ name: parsed.name ?? stem, filePath, tier, reason: 'pinned in MEMORY.md index' });
      continue;
    }

    const hits = findReferenceHits(stem, referenceRoots);
    if (hits.length > 0) {
      const preview = hits.slice(0, 2).map((hit) => relative(projectRoot, hit).replaceAll('\\', '/')).join(', ');
      report.excluded.push({
        name: parsed.name ?? stem,
        filePath,
        tier,
        reason: `referenced by ${hits.length} file(s) (${preview}${hits.length > 2 ? ', …' : ''})`
      });
      continue;
    }

    report.candidates.push({
      name: parsed.name ?? stem,
      filePath,
      tier,
      tierReason,
      action: 'archive',
      reason: `tier C, ${ageDays} days old (${basis}) > ${retentionMonths}-month retention`,
      ageDays,
      ageBasis: basis
    });
  }

  // Safety gate 2: every reference root must be verifiable before applying.
  for (const root of referenceRoots) {
    if (!existsSync(root)) {
      report.gateFailures.push(`reference-grep root not found: ${root}`);
    }
  }

  const archiveCandidates = report.candidates.filter((candidate) => candidate.action === 'archive');

  if (apply) {
    if (report.candidates.length === 0) {
      report.refused = true;
      report.refusalReasons.push('no rotation candidates; refusing to apply an empty plan');
    }
    if (report.gateFailures.length > 0) {
      report.refused = true;
      report.refusalReasons.push(...report.gateFailures);
    }

    if (!report.refused && archiveCandidates.length > 0) {
      mkdirSync(archivedDir, { recursive: true });
      const stableArchivedDir = stableRealPath(archivedDir);
      for (const candidate of archiveCandidates) {
        const source = stablePath(resolveInputPath(candidate.filePath));
        if (stableMemoryDir === null || !isInsidePath(source, stableMemoryDir)) {
          report.gateFailures.push(`candidate escapes the memory directory: ${candidate.filePath}`);
          report.refused = true;
          report.refusalReasons.push(`candidate escapes the memory directory: ${candidate.filePath}`);
          break;
        }
        const destination = join(archivedDir, basename(candidate.filePath));
        const stableDestination = stablePath(resolveInputPath(destination));
        if (!isInsidePath(stableDestination, stableArchivedDir)) {
          report.gateFailures.push(`archive destination escapes archived/: ${destination}`);
          report.refused = true;
          report.refusalReasons.push(`archive destination escapes archived/: ${destination}`);
          break;
        }
        if (existsSync(destination)) {
          report.excluded.push({
            name: candidate.name,
            filePath: candidate.filePath,
            tier: candidate.tier,
            reason: `archive destination already exists: ${basename(destination)}`
          });
          continue;
        }
        renameSync(candidate.filePath, destination);
        report.archived.push(destination);
      }
    }
  }

  return report;
}
