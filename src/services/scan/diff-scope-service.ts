import { execFileSync } from 'node:child_process';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';

export type ScopePattern = {
  raw: string;
  regex: RegExp;
  line: number;
};

export type FileClassification = 'in-scope' | 'out-of-scope-violation' | 'unclassified' | 'auto-allowed';

export type ClassifiedFile = {
  path: string;
  classification: FileClassification;
  matchedPattern?: string;
  reason: string;
};

export type DiffScopeReport = {
  ok: boolean;
  rdArtifactPath: string;
  inScopePatterns: ScopePattern[];
  outOfScopePatterns: ScopePattern[];
  changedFiles: ClassifiedFile[];
  violations: ClassifiedFile[];
  unclassified: ClassifiedFile[];
  gitAvailable: boolean;
  patternsDeclared: boolean;
};

export type DiffScopeError =
  | { kind: 'rd-not-found' };

export type DiffScopeOptions = {
  projectRoot: string;
  requestId: string;
  sessionId?: string;
  baseRef?: string;
};

const RED_LINE_HEADER = /^##\s+Red-line scope\s*$/;
const IN_SCOPE_SUBHEADER = /^(?:###?\s+)?(?:in[- ]scope|scope|allowed):\s*$/i;
const OUT_OF_SCOPE_SUBHEADER = /^(?:###?\s+)?(?:out[- ]of[- ]scope|forbidden|excluded|not in scope|do not touch):\s*$/i;
const OUT_OF_SCOPE_INLINE = /\b(?:out[- ]of[- ]scope|do not modify|do not touch|forbidden|excluded)\b/i;
const PLACEHOLDER_PATTERNS = [
  /^<[^>]+>$/, // <placeholder>
  /^\.{2,}$/, // ...
  /^(?:in-scope|out-of-scope)\s+(?:files|surfaces)/i // bullet that is the template label, not a real path
];

const AUTO_ALLOWED_PATHS = [
  /^\.peaks\//,
  /^\.peaks-artifacts\//,
  /^\.git\//
];
const AUTO_ALLOWED_TEST_FILE = /\.(?:test|spec)\.[a-z]+$/i;
const AUTO_ALLOWED_TEST_DIR = /(?:^|\/)(?:tests?|__tests__|__mocks__|test|spec)\//;

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a simple glob pattern to a regex.
 * Supports `**` (any path including separators), `*` (one path segment), `?` (single char).
 * Leading `/` is removed; matching is relative to project root.
 */
export function globToRegex(pattern: string): RegExp {
  const trimmed = pattern.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  let body = '';
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i] ?? '';
    if (ch === '*') {
      if (trimmed[i + 1] === '*') {
        body += '.*';
        i += 2;
        // Skip following slash if any (since '**/' should match zero or more dirs)
        if (trimmed[i] === '/') i += 1;
      } else {
        body += '[^/]*';
        i += 1;
      }
      continue;
    }
    if (ch === '?') {
      body += '[^/]';
      i += 1;
      continue;
    }
    body += escapeRegex(ch);
    i += 1;
  }
  // If the pattern ends with no trailing slash and no extension wildcard, also allow it to match files under the path (treat as dir prefix)
  // E.g. `src/services/login` should match `src/services/login/handler.ts`.
  if (!trimmed.includes('*') && !trimmed.includes('?') && !trimmed.includes('.')) {
    body = `${body}(?:/.*)?`;
  }
  return new RegExp(`^${body}$`);
}

function classifyPatternLine(raw: string): { pattern: string | null } {
  // Strip leading "- ", "* ", numbered list, or trailing comments.
  const cleaned = raw.replace(/^\s*[-*+]\s*/, '').replace(/^\s*\d+\.\s*/, '').trim();
  if (cleaned.length === 0) return { pattern: null };
  if (isPlaceholder(cleaned)) return { pattern: null };
  // Take the first word/path-like token before whitespace or backticks.
  // If the line wraps a path in backticks, extract it; otherwise take the whole line.
  const backtickMatch = /`([^`]+)`/.exec(cleaned);
  if (backtickMatch !== null && backtickMatch[1] !== undefined) {
    return { pattern: backtickMatch[1].trim() };
  }
  // If the cleaned line is just a path-ish token, take it as-is.
  if (/^[\w./*?{}[\]@-]+$/.test(cleaned)) {
    return { pattern: cleaned };
  }
  // Otherwise the bullet is descriptive prose (e.g. "do not touch payment module"); skip.
  return { pattern: null };
}

function parseRedLineScope(rdBody: string): { inScope: ScopePattern[]; outOfScope: ScopePattern[]; declared: boolean } {
  const lines = rdBody.split(/\r?\n/);
  let inSection = false;
  let mode: 'in' | 'out' | 'unspecified' = 'unspecified';
  const inScope: ScopePattern[] = [];
  const outOfScope: ScopePattern[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (!inSection) {
      if (RED_LINE_HEADER.test(raw)) {
        inSection = true;
      }
      continue;
    }
    if (/^##\s/.test(raw)) break; // next H2
    if (IN_SCOPE_SUBHEADER.test(raw.trim())) {
      mode = 'in';
      continue;
    }
    if (OUT_OF_SCOPE_SUBHEADER.test(raw.trim())) {
      mode = 'out';
      continue;
    }
    const { pattern } = classifyPatternLine(raw);
    if (pattern === null) continue;
    const target = mode === 'out' || (mode === 'unspecified' && OUT_OF_SCOPE_INLINE.test(raw))
      ? outOfScope
      : inScope;
    target.push({ raw: pattern, regex: globToRegex(pattern), line: i + 1 });
  }

  const declared = inScope.length > 0 || outOfScope.length > 0;
  return { inScope, outOfScope, declared };
}

function tryGitChangedFiles(projectRoot: string, baseRef: string): { ok: boolean; files: string[] } {
  try {
    const trackedRaw = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', baseRef], { encoding: 'utf8' });
    const tracked = trackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const untrackedRaw = execFileSync('git', ['-C', projectRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untracked = untrackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return { ok: true, files: Array.from(new Set([...tracked, ...untracked])) };
  } catch {
    return { ok: false, files: [] };
  }
}

function isAutoAllowed(path: string): boolean {
  if (AUTO_ALLOWED_PATHS.some((pattern) => pattern.test(path))) return true;
  if (AUTO_ALLOWED_TEST_FILE.test(path)) return true;
  if (AUTO_ALLOWED_TEST_DIR.test(path)) return true;
  return false;
}

function classifyFile(
  path: string,
  inScope: ScopePattern[],
  outOfScope: ScopePattern[]
): { classification: FileClassification; matchedPattern?: string; reason: string } {
  if (isAutoAllowed(path)) {
    return { classification: 'auto-allowed', reason: 'Auto-allowed (test, mock, or Peaks artifact path)' };
  }
  const outMatch = outOfScope.find((pattern) => pattern.regex.test(path));
  if (outMatch !== undefined) {
    return { classification: 'out-of-scope-violation', matchedPattern: outMatch.raw, reason: `Matches explicit out-of-scope pattern "${outMatch.raw}"` };
  }
  const inMatch = inScope.find((pattern) => pattern.regex.test(path));
  if (inMatch !== undefined) {
    return { classification: 'in-scope', matchedPattern: inMatch.raw, reason: `Matches in-scope pattern "${inMatch.raw}"` };
  }
  return { classification: 'unclassified', reason: 'Does not match any declared scope pattern' };
}

export async function getDiffVsScope(options: DiffScopeOptions): Promise<DiffScopeReport | DiffScopeError> {
  const baseRef = options.baseRef ?? 'HEAD';
  const showOptions: Parameters<typeof showRequestArtifact>[0] = {
    projectRoot: options.projectRoot,
    role: 'rd',
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const rdArtifact = await showRequestArtifact(showOptions);
  if (rdArtifact === null) {
    return { kind: 'rd-not-found' };
  }
  const { inScope, outOfScope, declared } = parseRedLineScope(rdArtifact.content);
  const { ok: gitAvailable, files } = tryGitChangedFiles(options.projectRoot, baseRef);
  const changedFiles: ClassifiedFile[] = files.map((path) => {
    const { classification, matchedPattern, reason } = classifyFile(path, inScope, outOfScope);
    const entry: ClassifiedFile = { path, classification, reason };
    if (matchedPattern !== undefined) {
      entry.matchedPattern = matchedPattern;
    }
    return entry;
  });
  const violations = changedFiles.filter((file) => file.classification === 'out-of-scope-violation');
  const unclassified = changedFiles.filter((file) => file.classification === 'unclassified');
  // ok if patterns are declared AND no violations AND no unclassified non-trivial files.
  // If patterns were NOT declared, treat as a warning (ok=false but with a clear "patterns missing" reason).
  const ok = gitAvailable && declared && violations.length === 0 && unclassified.length === 0;
  return {
    ok,
    rdArtifactPath: rdArtifact.path,
    inScopePatterns: inScope,
    outOfScopePatterns: outOfScope,
    changedFiles,
    violations,
    unclassified,
    gitAvailable,
    patternsDeclared: declared
  };
}

export function isDiffScopeError(value: DiffScopeReport | DiffScopeError): value is DiffScopeError {
  return (value as DiffScopeError).kind !== undefined;
}
