/**
 * reviewer-types.ts — public type surface of the G4 third-party reviewer.
 *
 * Extracted verbatim from `reviewer-service.ts` for the 300-line file-size
 * cap (`.peaks/docs/lint-gate.md` §4 row 5). `reviewer-service.ts` re-exports
 * every name below, so importers keep using the original path unchanged.
 */
import { type SelectionState } from './selection-strategies.js';

export type ReviewerViolation = {
  kind: string;
  file: string;
  line: number;
  hint: string;
};

export type ReviewerEnvelope = {
  reviewerId: string;
  modelId: string;
  modelFamily: string;
  passed: boolean;
  violations: ReviewerViolation[];
  gateAction: 'block' | 'allow' | 'warn';
  reason: string;
};

export type ReviewerRunInput = {
  rid: string;
  /** Slice context blob fed to the prompt. Plain text — no PII (A1.5). */
  context: string;
  /** Optional override of the reviewer section path (`~/.peaks/config.json`). */
  configPath?: string;
  /** Project root the configured `schemaPath` resolves against (default `cwd`). */
  projectRoot?: string;
  /** Optional override of the selection-mode state for cross-slice round-robin. */
  state?: SelectionState;
  /** Optional injected fetch (testability). */
  fetchImpl?: typeof fetch;
  /** Optional injected rng (random mode tests). */
  rng?: () => number;
};

export type ReviewerRunOutput =
  | {
      ok: true;
      envelope: ReviewerEnvelope;
      nextState: SelectionState;
      /** True when no review verdict was produced (skip, provider error, bad JSON). */
      skipped: boolean;
    }
  | {
      ok: false;
      reason: 'no-reviewer-config' | 'insufficient-providers' | 'schema-missing';
      envelope: ReviewerEnvelope;
      /** The paths searched, set when `reason === 'schema-missing'`. */
      schemaCandidates?: string[];
    };
