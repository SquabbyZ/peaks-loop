/**
 * Workflow Autonomous Service -- resume artifact content validators.
 *
 * This module is the extracted validation sub-tree of
 * `workflow-autonomous-resume-helpers.ts` (B wave-3 file-size split).
 * It hosts the pure JSON / front-matter / markdown-body checks
 * (`isValidResumeArtifact`, `getCheckpointValidationRefs`,
 * `getMarkdownBody`, `extractMarkdownListSection` and their private
 * helpers). Function bodies and behaviour are unchanged (verbatim
 * move); the I/O-bound `readResumeArtifact` pipeline stays in the
 * sibling module.
 */

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ResumeArtifactType =
  'goal-package' | 'rd-plan' | 'checkpoint' | 'validation-report' | 'resume-instructions';

function getExpectedResumeArtifactType(artifact: string): ResumeArtifactType {
  if (artifact.endsWith('/autonomous-goal-package.json')) return 'goal-package';
  if (artifact.endsWith('/autonomous-rd-plan.json')) return 'rd-plan';
  if (artifact.endsWith('/checkpoint-1.json')) return 'checkpoint';
  if (artifact.endsWith('/validation-report.md')) return 'validation-report';
  return 'resume-instructions';
}

function hasStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function hasValidGoalPackageJson(parsed: Record<string, unknown>, goal: string): boolean {
  return (
    parsed.goal === goal &&
    typeof parsed.doneCondition === 'string' &&
    parsed.doneCondition.trim().length > 0 &&
    typeof parsed.resumeCondition === 'string' &&
    parsed.resumeCondition.trim().length > 0 &&
    hasStringArray(parsed.acceptanceCriteria)
  );
}

function hasValidRdPlanJson(parsed: Record<string, unknown>): boolean {
  return (
    parsed.workerQueueStatus === 'ready' &&
    typeof parsed.taskCount === 'number' &&
    Number.isInteger(parsed.taskCount) &&
    parsed.taskCount > 0 &&
    parsed.reducerRequired === true
  );
}

function hasValidCheckpointJson(parsed: Record<string, unknown>): boolean {
  return (
    parsed.checkpointId === 'checkpoint-1' &&
    typeof parsed.createdAt === 'string' &&
    parsed.createdAt.trim().length > 0 &&
    isObjectRecord(parsed.workerQueueState) &&
    hasStringArray(parsed.validationRefs)
  );
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function hasValidJsonMetadata(
  content: string,
  sessionId: string,
  artifactType: string,
  goal: string
): boolean {
  const parsed = parseJsonObject(content);
  if (
    parsed === null ||
    parsed.sessionId !== sessionId ||
    parsed.artifactType !== artifactType ||
    parsed.status !== 'ready'
  ) {
    return false;
  }

  if (artifactType === 'goal-package') return hasValidGoalPackageJson(parsed, goal);
  if (artifactType === 'rd-plan') return hasValidRdPlanJson(parsed);
  return artifactType === 'checkpoint' && hasValidCheckpointJson(parsed);
}

function parseFrontMatter(content: string): Record<string, string> | null {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return null;
  }

  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  if (closingDelimiterIndex === -1) {
    return null;
  }

  const metadata = new Map<string, string>();
  for (const line of lines.slice(1, closingDelimiterIndex + 1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    metadata.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return Object.fromEntries(metadata);
}

export function getMarkdownBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  return closingDelimiterIndex === -1 ? '' : lines.slice(closingDelimiterIndex + 2).join('\n');
}

function hasValidationReportBody(body: string): boolean {
  return (
    body.includes('Validation summary:') &&
    body.includes('Checks:') &&
    body.includes('Result: passed') &&
    body.includes('Evidence refs:')
  );
}

function hasResumeInstructionsBody(body: string): boolean {
  return (
    body.includes('Resume steps:') &&
    body.includes('Preconditions:') &&
    body.includes('Blocked actions:') &&
    body.includes('Next actions:')
  );
}

export function extractMarkdownListSection(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return [];
  }

  const sectionLines = lines.slice(startIndex + 1);
  const nextHeadingIndex = sectionLines.findIndex((line) => /^[A-Z][A-Za-z ]+:$/.test(line.trim()));
  const sectionEndIndex = nextHeadingIndex + 1 || sectionLines.length;
  return sectionLines
    .slice(0, sectionEndIndex)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

export function getCheckpointValidationRefs(checkpointContent: string): string[] {
  const parsed = parseJsonObject(checkpointContent);
  return parsed && hasStringArray(parsed.validationRefs) ? parsed.validationRefs : [];
}

function hasValidMarkdownMetadata(
  content: string,
  sessionId: string,
  artifactType: string
): boolean {
  const metadata = parseFrontMatter(content);
  if (
    metadata === null ||
    metadata.sessionId !== sessionId ||
    metadata.artifactType !== artifactType ||
    metadata.status !== 'passed'
  ) {
    return false;
  }

  const body = getMarkdownBody(content);
  return artifactType === 'validation-report'
    ? hasValidationReportBody(body)
    : hasResumeInstructionsBody(body);
}

export function isValidResumeArtifact(
  artifact: string,
  content: string,
  sessionId: string,
  goal: string
): boolean {
  if (!content.trim()) {
    return false;
  }

  const artifactType = getExpectedResumeArtifactType(artifact);
  return artifact.endsWith('.json')
    ? hasValidJsonMetadata(content, sessionId, artifactType, goal)
    : hasValidMarkdownMetadata(content, sessionId, artifactType);
}
