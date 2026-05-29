import { showRequestArtifact, type RequestArtifactRole } from './request-artifact-service.js';

export type ArtifactLintSeverity = 'error' | 'warning';

export type ArtifactLintFinding = {
  line: number;
  text: string;
  reason: string;
  severity: ArtifactLintSeverity;
};

export type ArtifactLintReport = {
  ok: boolean;
  role: RequestArtifactRole;
  requestId: string;
  path: string;
  totalLines: number;
  findings: ArtifactLintFinding[];
};

export type LintArtifactOptions = {
  projectRoot: string;
  role: RequestArtifactRole;
  requestId: string;
  sessionId?: string;
};

// Patterns that indicate an unfilled placeholder. Order matters — earlier patterns win.
type Rule = {
  test: (line: string) => boolean;
  reason: string;
  severity: ArtifactLintSeverity;
};

const RULES: ReadonlyArray<Rule> = [
  {
    test: (line) => /<[A-Za-z][^>]*>/.test(line.trim()) && !/^\s*-?\s*linked-/i.test(line),
    reason: 'Contains an unfilled <placeholder> token',
    severity: 'error'
  },
  {
    test: (line) => /^\s*-\s*\.\.\.\s*$/.test(line),
    reason: 'Bullet point is only "..." — replace with real content',
    severity: 'error'
  },
  {
    test: (line) => /\bTBD\b|\bTODO\b|\bFIXME\b|\bXXX\b/.test(line),
    reason: 'Contains TBD/TODO/FIXME/XXX marker',
    severity: 'warning'
  },
  {
    test: (line) => /^\s*-\s*$/.test(line),
    reason: 'Empty bullet point — replace with real content or remove',
    severity: 'warning'
  }
];

// Lines that should never be flagged even if they match a rule (template scaffolding).
const ALLOWLIST_PATTERNS: ReadonlyArray<RegExp> = [
  /^#+\s/, // markdown headers
  /^\s*```/, // code fences
  /^\s*-\s*last update:/i, // metadata
  /^\s*-\s*created:/i,
  /^\s*-\s*state:/i,
  /^\s*-\s*type:\s*(feature|bugfix|refactor|docs|config|chore)\s*$/i,
  /^\s*-\s*session:\s*[a-z0-9-]+/i,
  /^\s*-\s*transition note/i // bypass / repair notes are not placeholders
];

function isAllowlisted(line: string): boolean {
  return ALLOWLIST_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Remove inline code spans (`...`) before applying placeholder rules. Content
 * inside backticks is literal example text — e.g. a documented command syntax
 * `peaks sop init <id>` — not an unfilled prose placeholder. Lint checks prose,
 * not code, so a `<...>` token only counts when it appears outside code spans.
 */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

export async function lintRequestArtifact(options: LintArtifactOptions): Promise<ArtifactLintReport | null> {
  const showOptions: Parameters<typeof showRequestArtifact>[0] = {
    projectRoot: options.projectRoot,
    role: options.role,
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const artifact = await showRequestArtifact(showOptions);
  if (artifact === null) {
    return null;
  }
  const lines = artifact.content.split(/\r?\n/);
  const findings: ArtifactLintFinding[] = [];
  let insideFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (rawLine === undefined) continue;
    // Fenced code blocks hold literal examples, not prose to fill; skip their
    // contents entirely (the fence delimiters themselves toggle the state).
    if (/^\s*```/.test(rawLine)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    if (isAllowlisted(rawLine)) continue;
    const testLine = stripInlineCode(rawLine);
    for (const rule of RULES) {
      if (rule.test(testLine)) {
        findings.push({
          line: index + 1,
          text: rawLine.trim(),
          reason: rule.reason,
          severity: rule.severity
        });
        break;
      }
    }
  }
  const hasError = findings.some((finding) => finding.severity === 'error');
  return {
    ok: !hasError,
    role: options.role,
    requestId: options.requestId,
    path: artifact.path,
    totalLines: lines.length,
    findings
  };
}
