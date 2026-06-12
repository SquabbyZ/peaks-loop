/**
 * openspec-propose-from-doctor-service (Slice L3.3) — generates a draft
 * OpenSpec change record (proposal.md) from a doctor CRITICAL finding.
 *
 * Per L1+L2+L3 redesign §5.4: "CRITICAL → proposal 草稿生成". The doctor
 * scans the project for issues; when a CRITICAL finding is surfaced,
 * peaks-cli generates a draft `openspec/changes/<id>/proposal.md` so the
 * LLM doesn't have to start from scratch.
 *
 * The draft proposal is INFORMATIONAL — it requires the LLM to review +
 * edit before `peaks openspec validate` will accept it.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getErrorMessage } from '../../shared/result.js';

export interface DoctorFinding {
  readonly id: string;
  readonly rule: string;
  readonly detail: string;
  readonly severity: 'pass' | 'warn' | 'fail';
}

export interface ProposeFromDoctorInput {
  readonly projectRoot: string;
  readonly finding: DoctorFinding;
  /** Optional clock for testability. */
  readonly clock?: () => string;
}

export interface ProposeFromDoctorResult {
  readonly changeId: string;
  readonly changeDir: string;
  readonly proposalPath: string;
  readonly created: boolean;
}

const SLUGIFY = /[^a-z0-9]+/g;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUGIFY, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function formatProposal(input: {
  changeId: string;
  finding: DoctorFinding;
  title: string;
  date: string;
}): string {
  return `# Doctor Finding: ${input.finding.rule}

**Date**: ${input.date}
**Change ID**: ${input.changeId}
**Source**: \`peaks doctor\` finding (CRITICAL severity: ${input.finding.severity})

## Why

A \`peaks doctor\` scan flagged the following issue at \`${input.finding.id}\`:

> ${input.finding.detail}

The current behavior is broken or degraded. This proposal outlines a fix.

## What Changes

- Address the doctor finding at \`${input.finding.id}\`.
- See the Why section above for the original error message.
- Acceptance criteria below describe the success conditions.

## Acceptance Criteria

- \`peaks doctor --json\` returns \`ok: true\` for the \`${input.finding.id}\` check.
- Re-running the audit does not regress other findings.

## Out of Scope

- Other doctor findings (each is tracked in its own OpenSpec change).
- Refactors that don't fix this specific issue.

## Risks

- Low: this is a doctor-flagged issue with a clear acceptance criterion.

## Status

- created: ${input.date}
- last update: ${input.date}
- state: draft
- state reason: auto-generated from peaks doctor; LLM must review + edit before validate
`;
}

function makeChangeId(finding: DoctorFinding, date: string): string {
  return `${date}-fix-${slugify(finding.id)}`;
}

export function proposeFromDoctor(input: ProposeFromDoctorInput): ProposeFromDoctorResult {
  const date = (input.clock ?? (() => new Date().toISOString()))().slice(0, 10);
  const changeId = makeChangeId(input.finding, date);
  const changeDir = join(input.projectRoot, 'openspec/changes', changeId);
  const proposalPath = join(changeDir, 'proposal.md');

  let created = false;
  try {
    if (!existsSync(changeDir)) {
      mkdirSync(changeDir, { recursive: true });
    }
    if (!existsSync(proposalPath)) {
      const content = formatProposal({
        changeId,
        finding: input.finding,
        title: `Fix ${input.finding.rule}`,
        date,
      });
      writeFileSync(proposalPath, content);
      created = true;
    }
  } catch (error) {
    throw new Error(`proposeFromDoctor: ${getErrorMessage(error)}`);
  }

  return { changeId, changeDir, proposalPath, created };
}
