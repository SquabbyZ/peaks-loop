/**
 * workflow-presence-lifecycle-types.ts — input/result/error interfaces of
 * the workflow presence lifecycle orchestrator.
 *
 * Extracted verbatim from `workflow-presence-lifecycle.ts` for the 300-line
 * file-size cap (`.peaks/docs/lint-gate.md` §4 row 5). The original module
 * re-exports every name below, so importers keep using that path unchanged.
 */
import {
  type WorkflowGraph,
  type WorkflowId,
  type TerminalReason
} from './workflow-graph-types.js';
import type { SkillPresenceLease, PresenceIndex } from '../skills/presence-lease-types.js';

export interface InitWorkflowInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly callerId: string;
  readonly skill: string;
  readonly workflowId?: WorkflowId;
  readonly parentWorkflowId?: WorkflowId;
  readonly graphRef?: string;
  readonly depth?: number;
  readonly now?: string;
}

export interface InitWorkflowResult {
  readonly workflowId: WorkflowId;
  readonly graphRef: string;
  readonly graph: WorkflowGraph;
  readonly lease: SkillPresenceLease;
  readonly index: PresenceIndex;
  readonly events: ReadonlyArray<Record<string, unknown>>;
}

export interface TerminalizeWorkflowInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly callerId: string;
  readonly workflowId: WorkflowId;
  readonly graphRef: string;
  readonly reason: TerminalReason;
  readonly requireConsumed?: boolean;
  readonly now?: string;
}

export interface TerminalizeWorkflowResult {
  readonly lease: SkillPresenceLease;
  readonly graph: WorkflowGraph;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly indexCleared: boolean;
}

export interface TerminalizeError extends Error {
  readonly code: string;
  readonly successEventCount?: number;
  readonly consistent?: boolean;
}
