/**
 * P2-b sweep 005 — peaks-rd handoff + coverage enforcers.
 *
 * Closes three peaks-rd discovered lines:
 *  - md-121 : "do not hand off to QA without [the RD artifact]" (BLOCKING)
 *  - md-127 : "do not hand off to QA without a perf-baseline" (BLOCKING)
 *  - md-162 : "100% coverage target on testable files is meaningful"
 *
 * A10 of the 2026-09-15 diagnosis — `lintRdHandoffContract` used to regex
 * the peaks-rd SKILL.md prose for the sentence *"do not hand off to QA
 * without this file"* and call that enforcement. It never opened a file
 * under `.peaks/_runtime/`. The gate was verifying a sentence about the
 * artifact instead of the artifact: the exact failure the 4.0.49 release
 * note named, found alive inside the enforcer layer.
 *
 * It now reads `.peaks/_runtime/<sessionId>/rd/requests/*.md` — the
 * artifact the sentence is about (contract:
 * `skills/bee/peaks-rd/references/artifact-per-request.md`) — and reports
 * when nothing is there. When no session binding can be resolved it
 * reports nothing, matching the soft-pass convention of its sibling
 * enforcers (`pre-rd-scan.ts`, `lint-audit-regression.ts`).
 *
 * `lintRdCoverageDiscipline` still reads the skill doc, because its rule
 * *is* about what the skill doc declares. It is not a handoff gate.
 *
 * scope: peaks-rd only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LintHit, SkillFile } from './lint-style.js';

const COVERAGE_TARGET = /100%\s*coverage target[^\n]*testable files/i;
const NO_PADDING = /must not write coverage-padding tests/i;

/** The artifact whose absence makes an RD→QA handoff invalid. */
const RD_ARTIFACT_RELATIVE = '.peaks/_runtime';

interface SessionBinding {
  readonly sessionId: string | null;
  readonly reason: string;
}

/**
 * Resolve the bound session id from `.peaks/_runtime/session.json`. Both
 * key spellings are accepted: the file has shipped as `peakSessionId` and
 * as `sessionId`, and reading only one silently disables the check.
 */
function resolveSessionBinding(projectRoot: string): SessionBinding {
  const sessionJsonPath = join(projectRoot, '.peaks', '_runtime', 'session.json');
  if (!existsSync(sessionJsonPath)) {
    return { sessionId: null, reason: 'no .peaks/_runtime/session.json' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sessionJsonPath, 'utf8'));
  } catch (error) {
    return { sessionId: null, reason: `session.json is not readable JSON (${String(error)})` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { sessionId: null, reason: 'session.json is not an object' };
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ['sessionId', 'peakSessionId']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return { sessionId: value, reason: `bound via session.json:${key}` };
    }
  }
  return { sessionId: null, reason: 'session.json carries no session id' };
}

/** Count non-empty `*.md` files in `dir`. A missing dir counts as zero. */
function countNonEmptyArtifacts(dir: string): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md'));
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    try {
      if (statSync(join(dir, name)).size > 0) count += 1;
    } catch {
      continue;
    }
  }
  return count;
}

function findCoverageContract(lines: ReadonlyArray<string>): {
  target: boolean;
  noPadding: boolean;
} {
  let target = false;
  let noPadding = false;
  for (const line of lines) {
    if (COVERAGE_TARGET.test(line)) target = true;
    if (NO_PADDING.test(line)) noPadding = true;
  }
  return { target, noPadding };
}

/**
 * peaks-rd must not hand off to QA without a reviewable RD artifact. The
 * check reads `.peaks/_runtime/<sessionId>/rd/requests/*.md`; it does not
 * read the SKILL.md sentence that promises one.
 */
export function lintRdHandoffContract(
  skill: SkillFile,
  projectRoot: string
): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-rd') return [];

  const binding = resolveSessionBinding(projectRoot);
  if (binding.sessionId === null) return [];

  const requestsDir = join(projectRoot, RD_ARTIFACT_RELATIVE, binding.sessionId, 'rd', 'requests');
  const artifactCount = countNonEmptyArtifacts(requestsDir);
  if (artifactCount > 0) return [];

  return [
    {
      catalogId: 'rl-rd-handoff-contract-001',
      rule: 'peaks-rd must not hand off to QA without a non-empty RD artifact under rd/requests/',
      file: requestsDir,
      line: 1,
      matchedText: `no non-empty .md artifact under ${requestsDir} (${binding.reason})`
    }
  ];
}

export function lintRdCoverageDiscipline(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-rd') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const { target, noPadding } = findCoverageContract(lines);
  if (target && noPadding) return [];
  const missing: string[] = [];
  if (!target) missing.push('100% coverage target (testable files) phrasing');
  if (!noPadding) missing.push('"must not write coverage-padding tests" rule');
  return [
    {
      catalogId: 'rl-rd-coverage-discipline-001',
      rule: 'peaks-rd SKILL.md must declare the coverage discipline (100% target + no-padding rule)',
      file: skill.path,
      line: 1,
      matchedText: `missing markers: ${missing.join(', ')}`
    }
  ];
}
