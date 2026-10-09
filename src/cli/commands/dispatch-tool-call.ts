// The tool call `peaks sub-agent dispatch` returns: built by the active adapter, then
// stamped with the isolation lease, the provenance token, the Playwright profile env
// and the observability event.
import { fail } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  SubAgentNotSupportedError,
  type SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import {
  emitObservabilityEvent,
  OBSERVABILITY_SUBAGENT_ROLES,
  type ObservabilitySubagentRole
} from '../../services/observability/observability-service.js';
import {
  createDispatchProvenanceToken,
  DISPATCH_PROVENANCE_ENV,
  writeDispatchProvenance
} from '../../services/worktree/dispatch-provenance.js';
import { playwrightProfilePaths } from '../../services/worktree/playwright-profile.js';

export interface BuildDispatchToolCallInput {
  adapter: ReturnType<typeof getAdapter>;
  role: string;
  effectivePrompt: string;
  rid: string;
  sid: string;
  projectRoot: string;
  isolationMode: 'worktree' | 'container' | 'vm' | null;
  leaseId: string | null;
  asJson: boolean;
}

interface IsolationStampInput {
  projectRoot: string;
  sid: string;
  rid: string;
  isolationMode: 'worktree' | 'container' | 'vm' | null;
  leaseId: string | null;
}

interface DispatchObservabilityInput {
  adapter: ReturnType<typeof getAdapter>;
  role: string;
  effectivePrompt: string;
  sid: string;
  rid: string;
  projectRoot: string;
}

interface WorktreeProvenanceInput {
  projectRoot: string;
  sid: string;
  rid: string;
  leaseId: string;
  provenanceToken: string;
}

function writeWorktreeProvenance(input: WorktreeProvenanceInput): void {
  const { projectRoot, sid, rid, leaseId, provenanceToken } = input;
  writeDispatchProvenance({
    projectRoot,
    record: {
      schemaVersion: 1,
      token: provenanceToken,
      sessionId: sid,
      requestId: rid,
      leaseId,
      isolation: 'worktree',
      issuedAt: new Date().toISOString()
    }
  });
}

// Part 2.C: stamp the toolCall with `isolation` + a sub-agent
// env block so adapters that surface it (Claude Code's Task
// tool) propagate the lease id to the spawned process. The
// env block is the canonical hook the PreToolUse gate reads
// (gate-commands.ts: process.env.PEAKS_WORKTREE_LEASE_ID).
function applyIsolationStamp(
  toolCall: SubAgentToolCall,
  input: IsolationStampInput
): SubAgentToolCall {
  const { projectRoot, sid, rid, isolationMode, leaseId } = input;
  if (isolationMode !== null && leaseId !== null) {
    const existingEnv = (toolCall.args['env'] as Record<string, string> | undefined) ?? {};
    const provenanceToken = createDispatchProvenanceToken({
      sessionId: sid,
      requestId: rid,
      leaseId
    });
    if (isolationMode === 'worktree') {
      writeWorktreeProvenance({ projectRoot, sid, rid, leaseId, provenanceToken });
    }
    // two Playwright profile-isolation env vars so the sub-agent's
    // browser MCP session lands in a deterministic
    // `.peaks/_runtime/<sid>/pw-profiles/<dispatchId>/` directory
    // (see src/services/worktree/playwright-profile.ts). Without
    // these, concurrent dispatches share the user's default
    // Chromium profile and corrupt cookies / localStorage.
    const profile = playwrightProfilePaths({
      projectRoot,
      sessionId: sid,
      dispatchId: rid
    });
    toolCall = {
      ...toolCall,
      args: {
        ...toolCall.args,
        isolation: isolationMode,
        env: {
          ...existingEnv,
          PEAKS_WORKTREE_LEASE_ID: leaseId,
          PEAKS_PLAYWRIGHT_USER_DATA_DIR: profile.userDataDir,
          PEAKS_PLAYWRIGHT_PROFILE_NAME: profile.profileName,
          ...(isolationMode === 'worktree' ? { [DISPATCH_PROVENANCE_ENV]: provenanceToken } : {})
        }
      }
    };
  }
  return toolCall;
}

// Slice C of v2.11.1 — observability hook #2/7. Fire-and-forget
// per PRD Q4 (full-auto must never fail-loud). The
// synchronous emit returns {written:false} on disk-full; we
// deliberately swallow the result so dispatch contract is
// unchanged. role is only included when it matches the schema's
// known sub-agent role set; otherwise it's omitted (non-standard
// roles like 'qa-business' would otherwise drop the event
// through schema rejection).
function emitDispatchObservability(input: DispatchObservabilityInput): void {
  const { adapter, role, effectivePrompt, sid, rid, projectRoot } = input;
  const KNOWN_ROLES: ReadonlySet<string> = new Set(OBSERVABILITY_SUBAGENT_ROLES);
  const knownRole: ObservabilitySubagentRole | null = KNOWN_ROLES.has(role)
    ? (role as ObservabilitySubagentRole)
    : null;
  emitObservabilityEvent(
    {
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: sid,
      category: 'dispatch',
      ...(knownRole !== null ? { role: knownRole } : {}),
      detail: {
        requestId: rid,
        ide: adapter.subAgentDispatcher.label,
        promptBytes: effectivePrompt.length
      }
    },
    { projectRoot }
  );
}

function rejectUnsupportedAdapter(
  io: ProgramIO,
  role: string,
  error: SubAgentNotSupportedError,
  asJson: boolean
): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'IDE_NOT_SUPPORTED',
      error.message,
      { role, toolCall: null, dispatchRecordPath: null } as never,
      ['Switch IDE or pick a role the current IDE supports.']
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

export function buildDispatchToolCall(
  io: ProgramIO,
  input: BuildDispatchToolCallInput
): SubAgentToolCall | null {
  const { adapter, role, effectivePrompt, rid, sid, projectRoot, isolationMode, leaseId, asJson } =
    input;
  let toolCall: SubAgentToolCall;
  try {
    toolCall = adapter.subAgentDispatcher.buildToolCall({
      role,
      prompt: effectivePrompt,
      requestId: rid,
      sessionId: sid
    });
    toolCall = applyIsolationStamp(toolCall, {
      projectRoot,
      sid,
      rid,
      isolationMode,
      leaseId
    });
    emitDispatchObservability({ adapter, role, effectivePrompt, sid, rid, projectRoot });
  } catch (error: unknown) {
    if (error instanceof SubAgentNotSupportedError) {
      return rejectUnsupportedAdapter(io, role, error, asJson);
    }
    throw error;
  }
  return toolCall;
}
