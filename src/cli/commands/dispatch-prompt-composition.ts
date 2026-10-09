// The prompt `peaks sub-agent dispatch` hands a sub-agent: the adapter check, the
// optional preflight blocks (memory / codegraph / UI library / fresh context /
// context probe / session capsule), the isolation and must-ls-files blocks, and the
// warning list the envelope carries.
import { fail, getErrorMessage } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import type { ContextGuardDecision } from '../../services/context/context-guard.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';
import {
  DEFAULT_PREFERENCES,
  type ProjectPreferences
} from '../../services/preferences/preferences-types.js';
import {
  MemoryPreflightService,
  deriveMemoryQuery
} from '../../services/context/memory-preflight-service.js';
import { buildDispatchSystemPrompt } from '../../services/context/build-dispatch-system-prompt.js';
import { readSessionCapsule } from '../../services/dispatch/session-capsule.js';
import { computeUiLibraryDispatchBlock } from '../../services/standards/ui-library-dispatch-block.js';
import { readFreshContextBlock } from '../../services/fresh-context/fresh-context-block.js';
import type { ContextPercentProbe } from '../../services/context/auto-compact-types.js';
import { deprecatedReviewerWarnings, type DispatchOptions } from './sub-agent-shared.js';
import { buildIsolationBlock, buildMustLsFilesBlock } from './dispatch-prompt-blocks.js';

export interface ComposeDispatchPromptInput {
  projectRoot: string;
  sid: string;
  rid: string;
  role: string;
  options: DispatchOptions;
  /** The prompt the sub-agent receives, as `preflightDispatch` resolved it. */
  prompt: string;
  isolationMode: 'worktree' | 'container' | 'vm' | null;
  leaseId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  decision: ContextGuardDecision;
  asJson: boolean;
}

export interface ComposedDispatchPrompt {
  adapter: ReturnType<typeof getAdapter>;
  effectivePrompt: string;
  warnings: string[];
  mustLsFilesVerification: { path: string; exists: boolean; files: readonly string[] } | null;
}

// loadPreferences can throw on schema mismatch; we fall back to defaults
// to avoid breaking the dispatch on a stale preferences.json file.
function loadProjectPreferences(projectRoot: string): ProjectPreferences {
  try {
    return loadPreferences(projectRoot);
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // Keep default preferences.
    return DEFAULT_PREFERENCES;
  }
}

function rejectUnsupportedIde(io: ProgramIO, ide: string, role: string, asJson: boolean): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'IDE_NOT_SUPPORTED',
      `IDE ${ide} does not support role "${role}"`,
      { role, toolCall: null, dispatchRecordPath: null } as never,
      ['Switch to a registered IDE (e.g. claude-code) or pick a role the current IDE supports.']
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

// memory preflight block (or silently skip when unavailable) via the
// pure-function builder.
function loadMemoryBlock(
  projectRoot: string,
  projectPrefs: ProjectPreferences,
  role: string,
  prompt: string
) {
  const preflightService = new MemoryPreflightService(projectRoot, projectPrefs);
  // task at hand (role + first line of the brief), not the bare role.
  return preflightService.fetchBlock(deriveMemoryQuery(role, prompt));
}

// codegraph preflight for RD planning. BEFORE the RD sub-agent's
// prompt is composed, ensure the index exists (init + index best-effort
// when `.codegraph/` is absent) and read a BOUNDED structure summary.
// `rd` only — other roles keep the legacy prompt byte-identical.
// Fail-soft: any failure degrades and dispatch proceeds. On failure the
// preflight's NOTE — the upstream cause — travels as the same value as
// the block, so the reason cannot be dropped while the block survives.
// The old `block : null` dropped it, so every degraded dispatch read as success.
async function loadCodegraphBlock(projectRoot: string, role: string) {
  let codegraphBlock: string | null | undefined;
  if (role === 'rd') {
    try {
      const { buildCodegraphPreflightBlock } =
        await import('../../services/codegraph/codegraph-preflight-service.js');
      const preflight = await buildCodegraphPreflightBlock(projectRoot);
      codegraphBlock = preflight.available ? preflight.block : preflight.note;
    } catch (error) {
      codegraphBlock = `codegraph preflight threw: ${getErrorMessage(error)}`;
    }
  }
  return codegraphBlock;
}

// component library (+ CSS framework + build tool) in the RD/UI
// dispatch system prompt so the sub-agent prefers the library over
// hand-rolled native DOM. Only injected for frontend-generating roles
// (rd + ui) — qa/sc/txt/prd keep the legacy prompt byte-identical.
// Fail-soft inside the wrapper: a detection error degrades to null.
function loadProjectStackBlock(projectRoot: string, role: string) {
  let projectStackBlock: string | null | undefined;
  if (role === 'rd' || role === 'ui') {
    projectStackBlock = computeUiLibraryDispatchBlock(projectRoot);
  }
  return projectStackBlock;
}

// Slice 2026-09-07-search-first-preflight: read the orchestrator-
// synthesized fresh-context block for rd + prd dispatches. The block
// was written to .peaks/_runtime/<sid>/fresh-context.md when the
// preflight triggered; it carries ≤5 binding directives that hedge
// model training-data lag. Fail-soft: a missing / unreadable file, or
// a file without the `## Fresh context` heading, degrades to null so
// the prompt stays byte-identical to the legacy shape. Other roles
// (qa/sc/txt/ui) keep the legacy prompt unchanged.
function loadFreshContextBlock(projectRoot: string, sid: string, role: string) {
  let freshContextBlock: string | null | undefined;
  if (role === 'rd' || role === 'prd') {
    freshContextBlock = readFreshContextBlock(projectRoot, sid);
  }
  return freshContextBlock;
}

// authoritative context-fill probe before composing the
// dispatch prompt. The probe is token-counted (IDE adapter's
// `compact` env-var), not a byte estimate. The composer
// prepends a `## Context window` block so the dispatched
// sub-agent reads the actual ratio instead of guessing
// from message length (char/4 estimates diverge by 2-4x
// and have caused false "context too low" reports at 60%+
// free).
async function loadContextProbe(
  projectRoot: string,
  sid: string
): Promise<ContextPercentProbe | null> {
  let contextProbe: ContextPercentProbe | null = null;
  try {
    const { readContextPercent } = await import('../../services/context/auto-compact-reader.js');
    const outerSessionId = resolveOuterSessionId(projectRoot, sid);
    contextProbe = readContextPercent({
      projectRoot,
      sessionId: sid,
      outerSessionId,
      env: process.env
    });
  } catch {
    // Probe is best-effort; the composer renders a
    // "no probe available" hint instead of failing the
    // dispatch.
  }
  return contextProbe;
}

async function composeMemoryAugmentedBody(
  input: ComposeDispatchPromptInput,
  projectPrefs: ProjectPreferences
): Promise<string> {
  const { projectRoot, sid, rid, role, prompt } = input;
  const memoryBlock = await loadMemoryBlock(projectRoot, projectPrefs, role, prompt);
  const codegraphBlock = await loadCodegraphBlock(projectRoot, role);
  const projectStackBlock = loadProjectStackBlock(projectRoot, role);
  const freshContextBlock = loadFreshContextBlock(projectRoot, sid, role);
  const contextProbe = await loadContextProbe(projectRoot, sid);
  // capsule published by the orchestrator via `peaks sub-agent share`.
  // Absent capsule → no pointer and no precedence line (byte-identical
  // legacy prompt).
  const capsuleRef = readSessionCapsule({ projectRoot, sid, rid });
  return buildDispatchSystemPrompt({
    taskTitle: role,
    taskBody: prompt,
    memoryBlock,
    // unified Test Tool Detection injection for every role.
    contextProbe,
    // exactOptionalPropertyTypes: only set codegraphBlock when the rd
    // preflight actually produced a value (null = attempted-unavailable,
    // undefined = not requested → legacy prompt unchanged).
    ...(codegraphBlock !== undefined ? { codegraphBlock } : {}),
    // Same optionality contract for the project-stack block: set only
    // when the rd/ui detection ran (null = no library → no block,
    // undefined = non-frontend role → legacy prompt unchanged).
    ...(projectStackBlock !== undefined ? { projectStackBlock } : {}),
    // Same optionality contract for the fresh-context block: set only
    // when the rd/prd read ran (null = no block on disk → no block,
    // undefined = non-rd/prd role → legacy prompt unchanged).
    ...(freshContextBlock !== undefined ? { freshContextBlock } : {}),
    // §4: advisory session capsule pointer + precedence line.
    ...(capsuleRef !== null
      ? {
          capsule: { batchId: capsuleRef.batchId, key: capsuleRef.key, bytes: capsuleRef.bytes }
        }
      : {})
  });
}

export async function composeDispatchPrompt(
  io: ProgramIO,
  input: ComposeDispatchPromptInput
): Promise<ComposedDispatchPrompt | null> {
  const {
    projectRoot,
    role,
    options,
    isolationMode,
    leaseId,
    worktreePath,
    worktreeBranch,
    decision,
    asJson
  } = input;
  const projectPrefs = loadProjectPreferences(projectRoot);

  const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
  const adapter = getAdapter(ide);
  if (!adapter.subAgentDispatcher.supportsRole(role)) {
    return rejectUnsupportedIde(io, ide, role, asJson);
  }

  const memoryAugmentedBody = await composeMemoryAugmentedBody(input, projectPrefs);
  const isolationBlock = buildIsolationBlock(isolationMode, leaseId, worktreePath, worktreeBranch);
  const { mustLsFilesVerification, mustLsFilesBlock } = buildMustLsFilesBlock(options, projectRoot);
  const effectivePrompt = `${memoryAugmentedBody}${isolationBlock}${mustLsFilesBlock}`;
  // + rerouted here, never refused — rationale on the helper itself.
  const warnings: string[] = [...decision.warnings, ...deprecatedReviewerWarnings(role)];

  return { adapter, effectivePrompt, warnings, mustLsFilesVerification };
}
