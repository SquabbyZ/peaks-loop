import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tryParseJson } from '../../shared/json-parse.js';
import { ensureMemoryBootstrap } from '../memory/project-memory-service.js';
import { getSessionId, getSessionMeta } from '../session/session-manager.js';
import { SessionIdentitySchema } from '../session/session-file-schema.js';
// Slice 4.0.8 compat shim: the canonical write path lives in
// `presence-lease-service.ts`, and the WRITE ITSELF is owned by
// `skill-presence-write.ts` — the awaited, fail-closed write. The legacy
// shim calls it so the cold path of the legacy `getSkillPresence` /
// `checkStalePresence` / `clearStalePresenceOnRotation` read paths stays
// cheap: the write module imports the lease service and the caller-id
// resolver DYNAMICALLY, so a read-only command never pulls the canonical
// lease and adapter machinery into module load.
//
// WHAT MOVED AND WHY. The canonical write used to live here, inside a
// non-awaited `void (async () => { ... catch {} })()`. That shape made a
// failed write invisible: the failure was swallowed, and the caller was
// handed a success-shaped envelope anyway. The write now lives in
// `skill-presence-write.ts`, where it is awaited and its failure escapes.
//
// Slice 4.0.17 (presence cross-session): the cross-session read and
// the pure SELECTION RULES live in sibling modules (this file is over the
// repository's 300-line cap, which may only go down).
import { resolvePresenceLease, resolveProjectRoot } from './presence-lease-resolver.js';
import { normalizePresenceGate, readPresenceGate } from './presence-gate.js';
import { presenceRoleTier, type PresenceRoleTier } from './presence-role.js';
import { writeCanonicalPresenceLease } from './skill-presence-write.js';
// The 4.0.8 compat surface (`setSkillPresence` / `getSkillPresence` / …)
// keeps its import path for the legacy consumers
// (`code-mode-gate-commands.ts`, `mode-enforcement.ts`,
// `code-job-shape-commands.ts`, the dashboard, the statusline) while the
// actual work flows through the canonical lease service.

export type SkillPresenceMode = 'full-auto' | 'assisted' | 'strict' | '24h';

export const VALID_SKILL_PRESENCE_MODES: ReadonlyArray<SkillPresenceMode> = [
  'full-auto',
  'assisted',
  'strict',
  '24h'
];

// as a mode — parallel fan-out is now the default execution strategy in
// every mode. A legacy on-disk `mode: 'swarm'` is normalized on read to
// `'full-auto'` (never crash, never drop the presence).
export const LEGACY_SKILL_PRESENCE_MODE_ALIASES: Readonly<Record<string, SkillPresenceMode>> = {
  swarm: 'full-auto'
};

export function isSkillPresenceMode(value: string): value is SkillPresenceMode {
  return (VALID_SKILL_PRESENCE_MODES as ReadonlyArray<string>).includes(value);
}

/**
 * Normalize a raw on-disk / CLI mode token to a current
 * `SkillPresenceMode`. Current values pass through; the legacy
 * `'swarm'` alias maps to `'full-auto'`; anything else returns
 * `undefined` so the caller can decide (drop the field, not the
 * presence). Never throws.
 */
export function normalizeSkillPresenceMode(
  value: string | undefined | null
): SkillPresenceMode | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (isSkillPresenceMode(value)) return value;
  return LEGACY_SKILL_PRESENCE_MODE_ALIASES[value];
}

export type SkillPresence = {
  skill: string;
  mode?: SkillPresenceMode;
  gate?: string;
  /** The skill's role tier (`orchestrator` | `bee`; `null` for an unknown skill). */
  role?: PresenceRoleTier | null;
  sessionId?: string;
  /**
   * Identifier of the *outer* session — the Claude Code / Cursor /
   * VSCode-plugin / other harness session that is currently driving
   * the LLM. Sourced from the `PEAKS_OUTER_SESSION_ID` environment
   * variable when set, with `CLAUDE_CODE_SESSION_ID` as a fallback for
   * Claude Code. Stamped onto the presence file so the status line
   * can tell whether the recorded skill belongs to the live outer
   * session (show it) or a previous one (render idle), and so
   * `setSkillPresence` can detect a session swap and AskUserQuestion
   * the user about rolling a new peaks session.
   */
  outerSessionId?: string;
  /**
   * Set by `setSkillPresence` when the outer session id changed
   * between the last presence write and this one AND the bound
   * peaks session has a different (or no) recorded outer session id.
   *
   * informational only — it tells the statusline and any log /
   * observability consumer that an outer-session swap was observed
   * on the previous heartbeat. The actual binding rotation is
   * field and turn it into an AskUserQuestion; that ask is no
   * longer needed because the rotation already happened by the time
   * the skill is invoked.
   */
  outerSessionMismatch?: {
    previous?: string;
    current: string;
    boundSessionId: string;
    boundOuterSessionId?: string;
  };
  setAt: string;
  lastHeartbeat?: string;
};

/**
 * The current outer session id, exposed to Bash tool calls via the
 * `PEAKS_OUTER_SESSION_ID` environment variable. Stamping it onto the
 * presence file lets the read-only status line tell whether the recorded
 * skill belongs to the live session (show it) or a previous one
 * (render idle). Falls back to `CLAUDE_CODE_SESSION_ID` for Claude Code
 * so existing Claude Code users get the field populated without any
 * configuration; other harnesses that want a presence stamp can set
 * either variable.
 */
function getCurrentOuterSessionId(): string | undefined {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

// Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
// project-level single-slot presence files
// `.peaks/_runtime/active-skill.json` and `.peaks/.active-skill.json`
// are REMOVED from this module. The canonical sid-scoped lease
// projection (`.peaks/_runtime/<sid>/leases/presence-*.json`) is the
// only source of truth. The legacy constants `PRESENCE_FILE` and
// `PRESENCE_FILE_LEGACY` are deleted; readers use `listPresenceLeases`.

const SESSION_FILE = join('.peaks', '_runtime', 'session.json');
const SESSION_FILE_LEGACY = '.peaks/.session.json';

/**
 * Resolve the active peaks session id.
 *
 * Resolution order (slice caller-first-session-resolution):
 *   1. The per-caller binding (via `getSessionId`) — the SAME source
 *      `peaks session info --active` resolves through.
 *   2. The project-global `.peaks/_runtime/session.json` (legacy:
 *      `.peaks/.session.json`) — unchanged back-compat fallback.
 *   3. `null` when neither is present.
 *
 * The caller-first step is what keeps two IDE windows on one project
 * apart. The project-global file is last-writer-wins, so the window
 * that initialised most recently owned it for every reader; commands
 * that resolved through this helper (job / dispatch / worktree /
 * share / ...) then wrote into THAT window's session tree, silently
 * cross-contaminating the two sessions.
 *
 * Returns `null` when no session is bound. Never throws.
 *
 * Public export: callers like `peaks sub-agent dispatch` use this
 * to auto-resolve `--session-id` when the LLM driver forgets to
 * pass the flag, so dispatch records land in the right
 * `.peaks/_sub_agents/<sid>/` tree instead of an `unknown-sid`
 */
export function getCurrentSessionId(projectRootOverride?: string): string | null {
  const projectRoot = resolveProjectRoot(projectRootOverride);
  // Caller-first: a binding for THIS caller outranks the project-global
  // file. Delegated to `getSessionId` rather than re-implemented, so the
  // two answers to "which session is current?" cannot drift again.
  const callerBound = getSessionId(projectRoot);
  if (callerBound !== null) return callerBound;
  const sessionPath = resolve(projectRoot, SESSION_FILE);
  const legacyPath = resolve(projectRoot, SESSION_FILE_LEGACY);
  // Back-compat window: prefer the new canonical path; fall back to the
  // legacy `.peaks/.session.json` for one minor release.
  const pathToRead = existsSync(sessionPath) ? sessionPath : legacyPath;
  if (!existsSync(pathToRead)) return null;
  try {
    const parsed = tryParseJson(readFileSync(pathToRead, 'utf8'), SessionIdentitySchema);
    return parsed.ok ? parsed.value.sessionId : null;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/**
 * Read the canonical sid-scoped lease projection and project the freshest
 * in-flight lease into the legacy `SkillPresence` shape the public consumers
 * expect. The projection is lossy (the lease does not carry `outerSessionId`;
 * `setAt` maps to `startedAt`; `lastHeartbeat` is reused as `lastHeartbeat`).
 *
 * The read spans EVERY session tree of the project and selects the lease that
 * is actually driving peaks; terminalized and stale leases are ignored so
 * the read does not resurrect a stale skill. The `role` tier comes from the
 * lease's skill, so the header's Role cell is read from the tier lists
 * rather than written by the model.
 */
function readSkillPresenceFromLease(projectRootOverride?: string): SkillPresence | null {
  const selection = resolvePresenceLease(resolveProjectRoot(projectRootOverride));
  if (selection === null) return null;
  const lease = selection.lease;
  // The lease carries `callerId` (the adapter / harness session id),
  // not the legacy `outerSessionId` field. Project it for back-compat
  // with `clearStalePresenceOnRotation`'s outer-mismatch check.
  // Normalize on read so a legacy `'swarm'` lease surfaces as
  // `'full-auto'`.
  const leaseMode = normalizeSkillPresenceMode(lease.mode);
  // The gate is the machine fact behind the status header's middle cell.
  const gate = readPresenceGate(lease.gate);
  return {
    skill: lease.skill,
    ...(leaseMode !== undefined ? { mode: leaseMode } : {}),
    ...(gate !== undefined ? { gate } : {}),
    role: presenceRoleTier(lease.skill),
    sessionId: selection.sessionId,
    outerSessionId: lease.callerId,
    setAt: lease.startedAt,
    lastHeartbeat: lease.lastHeartbeat
  };
}

/**
 * Look up the outer-session-id that was bound to the *current* peaks
 * session, i.e. the one written to the per-session
 * `.peaks/_runtime/<sid>/session.json` by `ensureSession`/`initWorkspace`. This
 * is the source of truth for "which outer session owns the
 * in-flight peaks session".
 *
 * Returns `null` if no peaks session is bound yet, or if the bound
 * session has no recorded outer session id (legacy sessions predating
 * the outer-session contract).
 */
function getBoundOuterSessionId(projectRootOverride?: string): string | undefined {
  const sessionId = getCurrentSessionId(projectRootOverride);
  if (sessionId === null) return undefined;
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const meta = getSessionMeta(projectRoot, sessionId);
  if (meta === null) return undefined;
  return typeof meta.outerSessionId === 'string' && meta.outerSessionId.length > 0
    ? meta.outerSessionId
    : undefined;
}

/**
 * The outer session id recorded on the presence that is about to be
 * overwritten. It powers the informational `outerSessionMismatch` field on
 * the presence envelope: when the recorded id differs from the one about to
 * be stamped, the harness probably opened a fresh session.
 *
 * The value comes from the canonical lease projection
 * (`.peaks/_runtime/<sid>/leases/presence-*.json`). The project-level
 * single-slot marker files were removed in 4.0.11 and are NOT read here.
 */
function getPreviousOuterSessionId(projectRootOverride?: string): string | undefined {
  const result = readSkillPresenceFromLease(projectRootOverride);
  if (result === null) return undefined;
  if (typeof result.outerSessionId === 'string' && result.outerSessionId.length > 0) {
    return result.outerSessionId;
  }
  return undefined;
}

// ============================================================================
// ============================================================================
//
// The canonical presence write path is the sid-scoped lease
// (`.peaks/_runtime/<sid>/leases/presence-<callerId>-<workflowId>.json`).
// The project-level single-slot markers (`.peaks/_runtime/active-skill.json`
// and the legacy `.peaks/.active-skill.json`) were removed in 4.0.11 and
// are neither written nor read from here.

/**
 * Write the LEGACY per-caller marker
 * `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json` (D6). This path
 * was superseded by the sid-scoped lease; it stays for the audit enforcer,
 * which still reads those files. New code calls `setPresenceLease` instead.
 */
export function setSkillPresenceForCaller(
  projectRootOverride: string,
  callerId: string,
  peakSessionId: string,
  skill: string,
  mode?: string,
  gate?: string
): SkillPresence {
  const validatedMode = normalizeSkillPresenceMode(mode);
  const now = new Date().toISOString();
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    ...(peakSessionId ? { sessionId: peakSessionId } : {}),
    ...(callerId ? { outerSessionId: callerId } : {}),
    setAt: now,
    lastHeartbeat: now
  };
  const presencePath = getActiveSkillFileForCallerPath(
    resolveProjectRoot(projectRootOverride),
    peakSessionId,
    callerId
  );
  const presenceDir = dirname(presencePath);
  if (!existsSync(presenceDir)) {
    mkdirSync(presenceDir, { recursive: true });
  }
  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');

  // Skill-activation side effect: bring the memory store into existence for
  // fresh projects. Same fail-open contract as the legacy path.
  ensureMemoryBootstrap(resolveProjectRoot(projectRootOverride));
  return presence;
}

/**
 * Compute the per-caller active-skill file path. Re-exported for test
 * ergonomics; canonical path lives in
 * `src/services/session/caller-binding-service.ts` but inlined here to
 * avoid a circular import (`caller-binding-service` reads
 * `skill-presence-service` for the `setCallerBinding` integration in
 * future slices; the inverse import would deadlock).
 */
function getActiveSkillFileForCallerPath(
  projectRoot: string,
  peakSessionId: string,
  callerId: string
): string {
  return resolve(projectRoot, '.peaks', '_runtime', peakSessionId, `active-skill-${callerId}.json`);
}

/**
 * The optional inputs of `setSkillPresence`. They travel as ONE object so
 * the function stays inside the repository's 4-parameter cap: the caller id
 * override is the escape hatch a non-Claude-Code host uses, and the project
 * root override is what the CLI passes so the read and the write agree on
 * which project they are talking about.
 */
export interface SetSkillPresenceOptions {
  readonly projectRootOverride?: string | undefined;
  readonly callerIdOverride?: string | undefined;
}

/**
 * Record the informational outer-session mismatch on the presence envelope.
 *
 * It powers the `outerSessionMismatch` field: when the recorded id differs
 * from the one about to be stamped, the harness probably opened a fresh
 * session. The field is INFORMATIONAL — it tells the statusline and any
 * log / observability consumer that an outer-session swap was observed on
 * the previous heartbeat. It does NOT rotate anything: the actual binding
 * rotation is the session layer's business, and by the time the skill is
 * invoked the rotation has already happened.
 *
 * The previous outer session id comes from the canonical lease projection
 * (`.peaks/_runtime/<sid>/leases/presence-*.json`). The project-level
 * single-slot marker files were removed in 4.0.11 and are NOT read here.
 *
 * The bound session's own recorded outer id is the second signal: when it
 * matches the id about to be stamped, the swap is a re-connect of the SAME
 * outer session and no mismatch is recorded.
 */
function markOuterSessionMismatch(
  presence: SkillPresence,
  sessionId: string | null,
  outerSessionId: string | undefined,
  projectRootOverride: string | undefined
): void {
  if (outerSessionId === undefined) return;
  const previousOuterSessionId = getPreviousOuterSessionId(projectRootOverride);
  const boundOuterSessionId = getBoundOuterSessionId(projectRootOverride);
  const outerChanged = previousOuterSessionId !== outerSessionId;
  const boundOuterMatches = boundOuterSessionId === outerSessionId;
  const hasOuterSignal = previousOuterSessionId !== undefined || boundOuterSessionId !== undefined;
  if (!hasOuterSignal || !outerChanged || boundOuterMatches || sessionId === null) return;
  presence.outerSessionMismatch = {
    ...(previousOuterSessionId !== undefined ? { previous: previousOuterSessionId } : {}),
    current: outerSessionId,
    boundSessionId: sessionId,
    ...(boundOuterSessionId !== undefined ? { boundOuterSessionId } : {})
  };
}

/**
 * Set the presence for the current skill.
 *
 * ASYNC, AND AWAITED. The canonical write — the graph the lease names, the
 * lease itself, the caller index — is awaited here, so a caller that awaits
 * this function KNOWS whether the presence landed. It used to run inside a
 * non-awaited `void (async () => { ... catch {} })()`: a graph that could
 * not be built, or a lease that could not be written, was swallowed and the
 * caller was handed a success-shaped envelope anyway. That failure now
 * ESCAPES, and the CLI turns it into a fail-closed envelope.
 *
 * The compat shim (slice 4.0.8) still holds:
 *   1. the canonical session id is resolved (caller binding first, then the
 *      project-global `.peaks/_runtime/session.json`);
 *   2. the caller id the caller already resolved wins (`--caller-id` >
 *      `PEAKS_CALLER_ID` > active IDE adapter — the chain lives in
 *      `resolve-caller-id.ts`); when none is supplied the write resolves one
 *      itself and fails closed when that is impossible;
 *   3. the canonical write is delegated to `setPresenceLease`, AWAITED.
 */
export async function setSkillPresence(
  skill: string,
  mode?: string,
  gate?: string,
  options?: SetSkillPresenceOptions
): Promise<SkillPresence> {
  const projectRootOverride = options?.projectRootOverride;
  const callerIdOverride = options?.callerIdOverride;
  const validatedMode = normalizeSkillPresenceMode(mode);
  // The gate is normalized ONCE, here, so the in-memory envelope and the
  // persisted lease can never disagree about what gate was recorded.
  const validatedGate = normalizePresenceGate(gate);
  const sessionId = getCurrentSessionId(projectRootOverride);
  const outerSessionId = getCurrentOuterSessionId();
  const now = new Date().toISOString();

  // as `''`) when no harness env var is set. Without this, the JSON
  // envelope omits the key entirely, which makes downstream staleness
  // detection unreliable (consumers can't tell "no signal" from
  // "stale-missing-key"). Presence-shape consumers should treat
  // `outerSessionId === ''` as "no signal", matching the
  // `getCurrentOuterSessionId()` resolution contract.
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(validatedGate !== undefined ? { gate: validatedGate } : {}),
    ...(sessionId ? { sessionId } : {}),
    outerSessionId: outerSessionId ?? '',
    setAt: now,
    lastHeartbeat: now
  };

  // Outer-session-mismatch detection. Same logic as the 4.0.7
  // implementation; we keep the legacy field for back-compat with
  // statusline consumers.
  markOuterSessionMismatch(presence, sessionId, outerSessionId, projectRootOverride);

  // Canonical lease write — when a session is bound we route through
  // `setPresenceLease`, which writes the graph the lease names BEFORE the
  // lease: no lease is ever left pointing at a missing graph. The write is
  // AWAITED and its failure ESCAPES — a presence that was not written is
  // not a presence that was set.
  const projectRoot = resolveProjectRoot(projectRootOverride);
  if (sessionId !== null) {
    await writeCanonicalPresenceLease({
      projectRoot,
      sessionId,
      skill,
      now,
      ...(callerIdOverride !== undefined ? { callerId: callerIdOverride } : {}),
      ...(validatedMode !== undefined ? { mode: validatedMode } : {}),
      ...(validatedGate !== undefined ? { gate: validatedGate } : {})
    });
  }

  // Slice 4.0.11 statusline-sid-scoped-lease A: the canonical write
  // path is now exclusively `presence-lease-service.setPresenceLease`.
  // The legacy single-slot marker file write was removed in this
  // slice: every `setSkillPresence` call flows through the sid-scoped
  // lease + presence-index machinery above. The legacy
  // `active-skill.json` file is NOT recreated here.

  // Skill-activation side effect: ensure `.peaks/memory/` and a full-shape
  // empty `index.json` exist for the project. This is the user-facing fix
  // for "stock projects never get a memory directory or index". Every peaks
  // skill starts with `peaks skill presence:set peaks-<role>`, so doing the
  // bootstrap here means the very first skill invocation in a fresh project
  // (or in a stock project that pre-dates the memory layer) brings the
  // memory store into existence. The helper is fail-open, so a failure here
  // does not block presence from being written.
  ensureMemoryBootstrap(projectRoot);

  return presence;
}

export function getSkillPresence(projectRootOverride?: string): SkillPresence | null {
  // Slice 4.0.11 statusline-sid-scoped-lease C: read from the
  // canonical sid-scoped lease projection. The legacy
  // `unlinkSync(presencePath)` purge on session-mismatch is
  // removed: the lease projection is keyed off the bound session
  // id, so a mismatch cannot happen — `listPresenceLeases`
  // already filters by the session-id resolved from the workspace
  // binding.
  return readSkillPresenceFromLease(projectRootOverride);
}

/**
 *
 * Compare the *outer* session id stamped onto the current presence
 * marker against the *current* outer session id (from
 * `PEAKS_OUTER_SESSION_ID` / `CLAUDE_CODE_SESSION_ID`).
 *
 * Stale reasons (in priority order):
 *
 *   - `'outer-session-mismatch'` — the presence was stamped by a
 *     different outer (Claude / harness) session than the one that
 *     is now driving peaks. Most common cause: the LLM closed the
 *     previous Claude session, the next session boots and finds a
 *     presence leftover from the old one. peaks-code Step 1 must
 *     AskUserQuestion to confirm the user wants the old mode.
 *
 *   - `'no-presence'`            — there is no presence file on disk.
 *     Not strictly "stale", but callers (peaks-code Step 1, `peaks
 *     code should-pause --step step-1-mode-select`) want to treat
 *     this case as "no opinion yet — must ask". Surfaced as
 *     `stale: true` with reason `'no-presence'` so the ask path is
 *     uniform.
 *
 *   - `null`                     — the presence exists AND its outer
 *     session id matches the current outer session id. Not stale.
 *     Caller may safely reuse the recorded mode.
 *
 * Pure read-only: never deletes the presence file (the rotation
 * auto-clear path is a separate concern; see
 * `clearStalePresenceOnRotation`). Test seam: `--current-outer` lets
 * tests inject a deterministic current outer id without touching env
 * vars.
 */
export type StaleReason = 'outer-session-mismatch' | 'no-presence';

export type StalenessCheck = {
  stale: boolean;
  reason: StaleReason | null;
  /** What was on disk; null when no presence was found. */
  presence: SkillPresence | null;
  /** Current outer session id (env-driven). Undefined when no signal. */
  currentOuterSessionId: string | undefined;
  /** Outer session id recorded on the presence marker. Undefined when no signal. */
  recordedOuterSessionId: string | undefined;
};

export function checkStalePresence(opts?: {
  projectRootOverride?: string | undefined;
  /**
   * Override the *current* outer session id. Test seam only.
   *   - `undefined` (omitted): read from `PEAKS_OUTER_SESSION_ID` /
   *     `CLAUDE_CODE_SESSION_ID` env vars.
   *   - explicit `string`: use the value verbatim (empty string means
   *     "no signal", same as a missing env var).
   */
  currentOuter?: string | undefined;
}): StalenessCheck {
  const result = readSkillPresenceFromLease(opts?.projectRootOverride);
  // `opts?.currentOuter === undefined` is the omitted-key case. A falsy
  // string `''` is an explicit "no signal" (used by tests to simulate a
  // CLI run with no harness env vars). The env signal wins; the bound
  // session's recorded outer-session id is the fallback, so a presence
  // written with an explicit caller id (no harness env var) is still
  // recognised as belonging to the current session.
  const current =
    opts && 'currentOuter' in opts
      ? opts.currentOuter
      : (getCurrentOuterSessionId() ?? getBoundOuterSessionId(opts?.projectRootOverride));
  if (result === null) {
    return {
      stale: true,
      reason: 'no-presence',
      presence: null,
      currentOuterSessionId: current,
      recordedOuterSessionId: undefined
    };
  }
  const recorded = result.outerSessionId;
  // Suppress false-positives when NEITHER side recorded an outer
  // session id (legacy project, no harness signal). Two unknowns
  // are not a swap — they are "no signal available yet".
  const hasSignal =
    (recorded !== undefined && recorded.length > 0) ||
    (current !== undefined && current.length > 0);
  if (!hasSignal) {
    return {
      stale: false,
      reason: null,
      presence: result,
      currentOuterSessionId: current,
      recordedOuterSessionId: recorded
    };
  }
  if (recorded === current) {
    return {
      stale: false,
      reason: null,
      presence: result,
      currentOuterSessionId: current,
      recordedOuterSessionId: recorded
    };
  }
  return {
    stale: true,
    reason: 'outer-session-mismatch',
    presence: result,
    currentOuterSessionId: current,
    recordedOuterSessionId: recorded
  };
}

/**
 *
 * Called from `peaks workspace init` immediately after a successful
 * `outer-session-mismatch` rotation. When the previous session's
 * presence is still on disk under the OLD outer session id,
 * clearing it prevents peaks-code Step 1 from picking up a stale
 * `mode` field that the user never explicitly chose.
 *
 * intent-source guard at the top of the function. The user constraint
 * (preserved in `.peaks/memory/2026-08-11-peaks-code-skill-persistence-pause.md`)
 * requires that "the current bee (peaks-code) can only be replaced or
 * cleared when the user explicitly asks, or when the user invokes
 * another non-bee Peaks skill; superpowers auto-hits, plain bug
 * reports, compact, and outer-session rotations must NOT change the
 * bee." Per the constraint, the `currentOuterSessionId` argument
 * doubles as the caller-binding intent source: when the harness env
 * var is set (`PEAKS_OUTER_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`),
 * the call was user-explicit and the existing 3-branch logic is
 * authoritative; when the env var is absent (currentOuterSessionId
 * is `undefined`), the rotation is system-triggered and MUST NOT
 * mutate user-explicit presence state.
 *
 * The guard is the minimal surface that satisfies the user constraint
 * while preserving the existing reconnect + live-different-outer +
 * stale-clear behavior for the user-explicit path. No new arguments,
 * no signature change — the 2 existing call sites
 * (`init-command.ts:329-334`, `primer-command.ts:128-133`) keep
 * working unchanged.
 *
 * Only clears when:
 *   - the caller supplies a user-explicit intent source
 *     (`currentOuterSessionId !== undefined`), AND
 *   - the recorded outer session id does NOT match the current outer
 *     session id (i.e. the presence IS stale), AND
 *   - the recorded outer session id matches the just-rotated-out
 *     session id (i.e. we're clearing exactly the old binding, not a
 *     user-explicitly-set mode from another live outer session).
 *
 * Returns `{ cleared, reason }` so callers can surface the outcome
 * in the JSON envelope and audit log. Pure: no env-var reads, all
 * inputs are passed explicitly so the call site (init command) can
 * decide what the "rotated-out" id was.
 */
export function clearStalePresenceOnRotation(opts: {
  projectRootOverride?: string;
  currentOuterSessionId: string | undefined;
  rotatedOutSessionId: string | null;
}): { cleared: boolean; reason: string | null; recordedOuter?: string } {
  // guard. When the caller has no caller-binding outerSessionId
  // (env vars unset, system-triggered rotation), refuse the mutation
  // up-front — the recorded presence may belong to a user-explicit
  // invocation and auto-clear would silently destroy user intent.
  // See `.peaks/memory/2026-08-11-peaks-code-skill-persistence-pause.md`.
  if (opts.currentOuterSessionId === undefined) {
    return { cleared: false, reason: 'no-intent-source' };
  }
  const result = readSkillPresenceFromLease(opts.projectRootOverride);
  if (result === null) {
    return { cleared: false, reason: 'no-presence' };
  }
  const recorded = result.outerSessionId;
  const current = opts.currentOuterSessionId;
  // If the recorded outer id matches the new (current) outer id,
  // this presence is NOT stale — the user just reconnected from
  // the same outer session after rotation. Leave it alone.
  if (recorded === current && recorded !== undefined) {
    return {
      cleared: false,
      reason: 'not-stale',
      ...(recorded !== undefined ? { recordedOuter: recorded } : {})
    };
  }
  // If we have a recorded outer id AND it does NOT match the
  // rotated-out session id, the user explicitly set this presence
  // from a DIFFERENT outer session that is still live. Do NOT clear
  // — would destroy user intent.
  if (
    opts.rotatedOutSessionId !== null &&
    recorded !== undefined &&
    recorded !== opts.rotatedOutSessionId
  ) {
    return {
      cleared: false,
      reason: 'recorded-by-different-outer',
      recordedOuter: recorded
    };
  }
  // Stale by outer-mismatch (either recorded === undefined and
  // current is set, or recorded !== current). Clear it.
  const cleared = clearSkillPresence(opts.projectRootOverride);
  return {
    cleared,
    reason: cleared ? 'outer-session-mismatch' : 'clear-failed',
    ...(recorded !== undefined ? { recordedOuter: recorded } : {})
  };
}

export function touchSkillHeartbeat(projectRootOverride?: string): SkillPresence | null {
  // Slice 4.0.11 statusline-sid-scoped-lease C: read from the
  // canonical sid-scoped lease projection. The legacy
  // unlink-on-session-mismatch purge is removed: the lease is
  // keyed off the bound session id, so the mismatch path cannot
  // fire (a lease under session A is never returned when the bound
  // session is B).
  const presence = readSkillPresenceFromLease(projectRootOverride);
  if (presence === null) return null;
  // Slice 4.0.11 statusline-sid-scoped-lease A: the legacy write to
  // the single-slot marker file was removed. Heartbeat refresh now
  // lives exclusively in `presence-lease-service.setPresenceLease`
  // (the canonical sid-scoped lease). This function remains as a
  // read-only back-compat shim for the 4-B / 4-C sub-slices; callers
  // still receive the in-memory `presence` (with the new
  // `lastHeartbeat` stamped) but the legacy `active-skill.json` file
  // is no longer touched. The canonical lease / presence-index
  // entries are the source of truth for heartbeat freshness.
  presence.lastHeartbeat = new Date().toISOString();
  return presence;
}

export function clearSkillPresence(projectRootOverride?: string): boolean {
  // Slice 4.0.8 (DR): `clearSkillPresence` is the compat shim for
  // `presence:clear`. Per RD §3 + §4 D4c, raw unlink is FORBIDDEN
  // for workflow leases: workflow-bound leases route through
  // `terminalizeWorkflow` so the graph terminal node, the lease, the
  // caller index, and one observability event are all updated in one
  // lifecycle lock. Ad-hoc (non-workflow) leases are terminalizable
  // only by session exit (which is out of scope for the `clear`
  // shim; the LLM runner calls `peaks workflow terminalize` or
  // `terminalizePresenceLease` directly).
  //
  // That rule is the surrounding DESIGN, not a description of this
  // function: nothing below routes anywhere. This shim has no session
  // lock, no lease argument and no workflow id, so it cannot route —
  // it cleans up deprecated files and returns whether it removed any.
  // The truthful report of what remains is the caller's job
  // (`skill-command.ts` re-reads the live projection and emits
  // `cleared` / `reason`). Do not read the paragraph above as a
  // promise about this function.
  //
  // The shim still removes the legacy `active-skill.json` /
  // `.peaks/.active-skill.json` so a stale marker from a prior CLI
  // version cannot resurrect after a fresh `clear`. The canonical
  // lease + index entries are NOT touched by this shim — they
  // Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
  // single-slot presence files (`.peaks/_runtime/active-skill.json`
  // and `.peaks/.active-skill.json`) are removed. The canonical
  // sid-scoped lease projection (under
  // `.peaks/_runtime/<sid>/leases/`) is untouched here — workflow
  // leases route through `terminalizeWorkflow`, NOT this shim.
  //
  // This shim remains as a best-effort stale-file cleanup for
  // projects that still carry the deprecated single-slot file from
  // a pre-4.0.11 CLI version. After one minor release the legacy
  // paths are gone and the loop is a no-op. Returns true when a
  // stale file was actually removed.
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const candidates: ReadonlyArray<string> = [
    resolve(projectRoot, '.peaks', '_runtime', 'active-skill.json'),
    resolve(projectRoot, '.peaks', '.active-skill.json')
  ];
  let cleared = false;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      cleared = true;
    } catch {
      // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // best effort
    }
  }
  return cleared;
}
