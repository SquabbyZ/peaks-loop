/**
 * eslint JSON report → findings + the population they were found in
 * (backlog §2.41). Split out of `eslint-runner-support.ts` for the 300-raw-line
 * cap; `eslint-runner.ts` is the only caller.
 */
import type { EslintFinding, EslintMessage } from './eslint-runner-types.js';
import { isIgnoredMessage, severityFor } from './eslint-runner-support.js';

export type ParsedReport = {
  readonly findings: EslintFinding[];
  /** Files eslint actually examined — the population behind the findings. */
  readonly checkedFiles: number;
  /** Entries eslint skipped instead of examining. */
  readonly ignoredFiles: number;
};

function messagesOf(entry: EslintMessage): EslintMessage[] {
  return Array.isArray((entry as { messages?: unknown[] }).messages)
    ? (entry as { messages: EslintMessage[] }).messages
    : [];
}

function parentFileOf(entry: EslintMessage): string {
  return typeof (entry as { filePath?: unknown }).filePath === 'string'
    ? (entry as { filePath: string }).filePath
    : '';
}

/** A skipped entry carries no lint result at all — it is not a finding. */
function isIgnoredEntry(messages: readonly EslintMessage[]): boolean {
  return messages.some(
    (m) =>
      m !== null &&
      typeof m === 'object' &&
      typeof m.message === 'string' &&
      isIgnoredMessage(m.message)
  );
}

function toFinding(m: EslintMessage, parentFile: string): EslintFinding | null {
  if (m === null || typeof m !== 'object') return null;
  return {
    filePath: typeof m.filePath === 'string' && m.filePath.length > 0 ? m.filePath : parentFile,
    line: typeof m.line === 'number' ? m.line : 0,
    column: typeof m.column === 'number' ? m.column : 0,
    ruleId: typeof m.ruleId === 'string' ? m.ruleId : null,
    severity: severityFor(m.severity),
    message: typeof m.message === 'string' ? m.message : ''
  };
}

/**
 * Counting a skipped entry's "File ignored" warning as a finding is what made
 * an empty run read as a populated one. Throws on unparseable stdout; the
 * caller reports that as `execution-failed`.
 */
export function parseEslintReport(stdout: string): ParsedReport {
  const findings: EslintFinding[] = [];
  let checkedFiles = 0;
  let ignoredFiles = 0;
  if (stdout.trim().length === 0) return { findings, checkedFiles, ignoredFiles };
  const parsed = JSON.parse(stdout) as ReadonlyArray<EslintMessage>;
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const messages = messagesOf(entry);
    if (isIgnoredEntry(messages)) {
      ignoredFiles += 1;
      continue;
    }
    checkedFiles += 1;
    const parentFile = parentFileOf(entry);
    for (const m of messages) {
      const finding = toFinding(m, parentFile);
      if (finding !== null) findings.push(finding);
    }
  }
  return { findings, checkedFiles, ignoredFiles };
}
