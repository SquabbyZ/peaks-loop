import { join } from 'node:path';
import { isDirectory } from 'peaks-loop-shared/fs';

import { loadOpenSpecChange, type OpenSpecScanOptions } from './openspec-scan-service.js';

export type OpenSpecValidationLevel = 'error' | 'warning';

export type OpenSpecValidationIssue = {
  level: OpenSpecValidationLevel;
  rule: string;
  message: string;
};

export type OpenSpecValidationSource = 'internal' | 'openspec-cli';

export type OpenSpecValidationResult = {
  changeId: string;
  valid: boolean;
  source: OpenSpecValidationSource;
  issues: OpenSpecValidationIssue[];
  cliOutput?: string;
};

export type ExternalRunnerOutcome = {
  available: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type ExternalRunner = (command: string, args: string[]) => Promise<ExternalRunnerOutcome>;

export type OpenSpecValidateOptions = OpenSpecScanOptions & {
  preferExternal?: boolean;
  externalRunner?: ExternalRunner;
};

const CHANGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function defaultOpenSpecRoot(): string {
  return join(process.cwd(), 'openspec');
}

async function defaultExternalRunner(_command: string, _args: string[]): Promise<ExternalRunnerOutcome> {
  return { available: false, exitCode: null, stdout: '', stderr: '' };
}

function buildInternalIssues(changeId: string, detail: Awaited<ReturnType<typeof loadOpenSpecChange>>): OpenSpecValidationIssue[] {
  const issues: OpenSpecValidationIssue[] = [];

  if (!CHANGE_ID_PATTERN.test(changeId)) {
    issues.push({
      level: 'error',
      rule: 'change-id-format',
      message: `changeId ${changeId} does not match [A-Za-z0-9][A-Za-z0-9._-]*`
    });
  }

  if (detail === null || detail.proposal === null) {
    issues.push({ level: 'error', rule: 'proposal-exists', message: 'proposal.md is missing' });
    return issues;
  }

  const proposal = detail.proposal;
  if (proposal.why.length === 0) {
    issues.push({ level: 'warning', rule: 'why-non-empty', message: 'Why section is empty' });
  }
  if (proposal.whatChanges.length === 0) {
    issues.push({ level: 'error', rule: 'what-changes-non-empty', message: 'What Changes section has no bullets' });
  }
  if (proposal.acceptanceCriteria.length === 0) {
    issues.push({ level: 'error', rule: 'acceptance-non-empty', message: 'Acceptance Criteria section has no bullets' });
  }

  return issues;
}

function hasErrors(issues: OpenSpecValidationIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

async function runInternal(changeId: string, openspecRoot: string): Promise<OpenSpecValidationResult | null> {
  const changeRoot = join(openspecRoot, 'changes', changeId);
  if (!(await isDirectory(changeRoot))) {
    return null;
  }
  const detail = await loadOpenSpecChange(changeId, { openspecRoot });
  const issues = buildInternalIssues(changeId, detail);
  return {
    changeId,
    valid: !hasErrors(issues),
    source: 'internal',
    issues
  };
}

export async function validateOpenSpecChange(
  changeId: string,
  options: OpenSpecValidateOptions = {}
): Promise<OpenSpecValidationResult | null> {
  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const runner = options.externalRunner ?? defaultExternalRunner;

  if (options.preferExternal === true) {
    const outcome = await runner('openspec', ['validate', changeId]);
    if (outcome.available) {
      const cliOutput = [outcome.stdout, outcome.stderr].filter((part) => part.length > 0).join('\n').trim();
      const passed = outcome.exitCode === 0;
      const issues: OpenSpecValidationIssue[] = passed
        ? []
        : [{ level: 'error', rule: 'openspec-cli-failed', message: `openspec validate exited with code ${outcome.exitCode ?? 'null'}` }];
      return { changeId, valid: passed, source: 'openspec-cli', issues, cliOutput };
    }
    const internal = await runInternal(changeId, openspecRoot);
    if (internal === null) {
      return null;
    }
    internal.issues = [
      { level: 'warning', rule: 'openspec-cli-unavailable', message: 'openspec CLI not found, fell back to internal lint' },
      ...internal.issues
    ];
    return internal;
  }

  return runInternal(changeId, openspecRoot);
}
