// Split out of `core/skill-command.ts`:
// `skill presence:clear`, `skill lease gc` and `skill presence:check-stale` —
// the cleanup / read-only half of the presence family.
import type { Command } from 'commander';
import {
  clearSkillPresence,
  getSkillPresence,
  checkStalePresence
} from '../../../services/skills/skill-presence-service.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { generateProjectContext } from '../../../services/memory/project-context-service.js';
import { gcStalePresenceLeases } from '../../../services/skills/presence-lease-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

const PRESENCE_CLEAR_DESCRIPTION =
  'Unlink the DEPRECATED pre-4.0.11 single-slot presence marker files (`.peaks/_runtime/active-skill.json`, `.peaks/.active-skill.json`). It does NOT terminalize a live presence lease — a workflow-bound lease terminalizes through `peaks workflow terminalize --workflow <id> --reason <reason>`, an ad-hoc lease only at session exit, and raw unlink is FORBIDDEN for both. The envelope reports what is still active.';
const PRESENCE_CLEAR_PROJECT_HELP = 'project root path (auto-detected from cwd when omitted)';
const LEASE_GC_DESCRIPTION =
  'Manually sweep stale presence leases for the canonical project. Both predicates required: now - lastHeartbeat > 1h AND now - startedAt > 24h. Drained leases are classified; corrupt graphs surface as PEAKS_GRAPH_REF_BROKEN warnings and are excluded.';
const LEASE_GC_PROJECT_HELP = 'project root (default: cwd)';
const LEASE_GC_NOW_HELP = 'override the current time (test seam)';
const PRESENCE_CHECK_STALE_DESCRIPTION =
  'Slice 002 (v2.15.0) AC-1: report whether the recorded presence outer session id still matches the current outer session id. ' +
  'Returns { stale: boolean, reason: "outer-session-mismatch" | "no-presence" | null }. ' +
  'Pure read-only — does NOT clear the presence (use `peaks skill presence:clear` for that).';
const PRESENCE_CHECK_STALE_PROJECT_HELP = 'project root (default: cwd)';
const PRESENCE_CHECK_STALE_CURRENT_OUTER_HELP =
  'override the current outer session id (test seam; default: read from PEAKS_OUTER_SESSION_ID / CLAUDE_CODE_SESSION_ID)';

const PRESENCE_CLEAR_SURVIVOR_ACTIONS: string[] = [
  'A workflow-bound lease terminalizes through `peaks workflow terminalize --workflow <id> --reason <reason>`.',
  'An ad-hoc lease (`peaks skill presence:set`) is terminalizable only at session exit; `presence:clear` will not remove it, and raw unlink is FORBIDDEN.',
  'Run `peaks skill presence --json` to read the lease that survived.'
];

const LEASE_GC_NEXT_ACTIONS: string[] = [
  'GC predicate: now - lastHeartbeat > 1h AND now - startedAt > 24h (RD §3 D2 + D3).',
  'Re-run `peaks workspace init` or `peaks skill presence:set` to sweep the same project on the bound trigger.'
];

type PresenceClearOptions = { project?: string; json?: boolean };
type LeaseGcOptions = { project?: string; now?: string; json?: boolean };
type PresenceCheckStaleOptions = { project?: string; currentOuter?: string; json?: boolean };

function presenceClearData(
  active: boolean,
  removed: boolean,
  cleared: boolean
): Record<string, unknown> {
  return {
    active,
    removed,
    cleared,
    ...(cleared ? {} : { reason: 'live-lease-survives-presence-clear' }),
    projectContextUpdated: true
  };
}

async function runPresenceClear(options: PresenceClearOptions, io: ProgramIO): Promise<void> {
  const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  // What this command actually is: a stale-marker cleanup for projects
  // carrying a pre-4.0.11 single-slot file, and nothing more. The previous
  // description claimed it "routes workflow leases through `workflow
  // terminalize`" and that a "compat wrapper re-routes [it] to
  // `terminalizePresenceLease` when a workflow binding is present" — there is
  // no such wrapper, and no such routing happens here or in
  // `clearSkillPresence`. A caller who read that line and ran this command
  // expecting a live workflow lease to terminalize got a successful exit code
  // and a still-running lease.
  const removed = clearSkillPresence(options.project);
  // Auto-update project context so future sessions have up-to-date history.
  // bootstraps `.peaks/project-scan/` (idempotent). Await the async
  // signature; failure is still non-fatal so we don't block the clear.
  try {
    await generateProjectContext(projectRoot);
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // non-fatal: context update failure should not block presence clear
  }
  // Report the state the project is actually in, not the state this command
  // intended to reach. `clearSkillPresence` unlinks only the DEPRECATED
  // single-slot marker files; the canonical sid-scoped lease is deliberately
  // left alive for an AD-HOC lease (raw unlink is FORBIDDEN — only session
  // exit may terminalize one; workflow leases route through `workflow
  // terminalize`). So after a `presence:set` the very next `peaks skill
  // presence` call still reads `active: true`. A hardcoded `active: false`
  // therefore reported a state the command never reached, and the caller had
  // no way to tell that from a real clear.
  //
  // Re-reading through `getSkillPresence` — the same projection the
  // `skill presence` command serves — is the only derivation that cannot
  // drift from what the next command prints: it is the same read path, on
  // the same project root, evaluated after every write this command makes.
  const active = getSkillPresence(projectRoot) !== null;
  // `cleared` is the live question the caller is actually asking ("is it gone
  // now?"), which `removed` could never answer: a legacy marker being unlinked
  // says nothing about the lease the next command will read. When it is false
  // the envelope says WHY, in the two routes that can terminalize a lease —
  // without this the caller saw `active: true, removed: false` and had no way
  // to tell "you ran the wrong command" from "this command has no opinion".
  const cleared = !active;
  printResult(
    io,
    ok(
      'skill.presence:clear',
      presenceClearData(active, removed, cleared),
      [],
      cleared ? [] : PRESENCE_CLEAR_SURVIVOR_ACTIONS
    ),
    options.json
  );
}

function leaseGcData(
  result: Awaited<ReturnType<typeof gcStalePresenceLeases>>
): Record<string, unknown> {
  return {
    envelopeVersion: '4.0.8',
    removed: result.removed,
    retained: result.retained,
    trigger: result.trigger,
    inFlightBatch: result.inFlightBatch,
    warnings: result.warnings,
    errors: result.errors
  };
}

// Slice 4.0.8 (RD §4): manual lease GC primitive. LLM-coordinated;
// never a user-typed requirement. The user / LLM runner invokes
// `peaks skill lease gc --project <p>` to drain leases that meet
// both stale predicates (24h start AND 1h heartbeat) for the
// canonical project. Returns a typed envelope so the runner can
// branch on the aggregate counters.
// Note: `.command('lease gc')` implicitly creates the `lease`
// parent under `skill`; we MUST NOT also call `.command('lease')`
// separately, or Commander.js throws "cannot add command 'lease' as
// already have command 'lease'" at startup.
async function runLeaseGc(options: LeaseGcOptions, io: ProgramIO): Promise<void> {
  const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  try {
    const result = await gcStalePresenceLeases({
      projectRoot,
      ...(options.now !== undefined ? { now: options.now } : {}),
      trigger: 'manual'
    });
    printResult(
      io,
      ok(
        'skill.lease.gc',
        leaseGcData(result),
        result.warnings.map((w) => `${w.code}: ${w.message}`),
        LEASE_GC_NEXT_ACTIONS
      ),
      options.json
    );
  } catch (err) {
    printResult(
      io,
      fail('skill.lease.gc', 'PEAKS_LEASE_GC_FAILED', getErrorMessage(err), { projectRoot }, [
        'Re-run with a valid --project and ensure the session is bound.'
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

// peaks-code Step 1 (and `peaks code should-pause --step
// step-1-mode-select`) calls this to decide whether the recorded
// `mode` field can be trusted or whether the LLM must AskUserQuestion.
function runPresenceCheckStale(options: PresenceCheckStaleOptions, io: ProgramIO): void {
  // when the user omits the flag. The service-layer branch
  // `'currentOuter' in opts` returns true for an explicit
  // `undefined` (the key exists on the spread object literal),
  // which would skip the env-var fallback and pin `current =
  // undefined` — always reading the presence as stale. Build a
  // sparse opts object so the service can fall back to
  // `getCurrentOuterSessionId()` (reads PEAKS_OUTER_SESSION_ID /
  // CLAUDE_CODE_SESSION_ID).
  const checkOpts: { projectRootOverride?: string; currentOuter?: string | undefined } =
    options.project !== undefined ? { projectRootOverride: options.project } : {};
  if (options.currentOuter !== undefined) {
    checkOpts.currentOuter = options.currentOuter;
  }
  const result = checkStalePresence(checkOpts);
  // Always emit `currentOuterSessionId` in the JSON envelope (even
  // tooling (statusline, sub-agent dispatch) reads the field by
  // name, never by `data.currentOuterSessionId ?? ''`. JSON.stringify
  // drops `undefined` properties, so we coerce to '' before
  // wrapping in the envelope.
  const data = {
    stale: result.stale,
    reason: result.reason,
    presence: result.presence,
    currentOuterSessionId: result.currentOuterSessionId ?? '',
    recordedOuterSessionId: result.recordedOuterSessionId ?? ''
  };
  printResult(io, ok('skill.presence:check-stale', data), options.json);
}

export function registerSkillPresenceHousekeepingCommands(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('presence:clear')
      .description(PRESENCE_CLEAR_DESCRIPTION)
      .option('--project <path>', PRESENCE_CLEAR_PROJECT_HELP)
  ).action((options: PresenceClearOptions) => runPresenceClear(options, io));

  addJsonOption(
    skill
      .command('lease gc')
      .description(LEASE_GC_DESCRIPTION)
      .option('--project <path>', LEASE_GC_PROJECT_HELP)
      .option('--now <iso>', LEASE_GC_NOW_HELP)
  ).action((options: LeaseGcOptions) => runLeaseGc(options, io));

  addJsonOption(
    skill
      .command('presence:check-stale')
      .description(PRESENCE_CHECK_STALE_DESCRIPTION)
      .option('--project <path>', PRESENCE_CHECK_STALE_PROJECT_HELP)
      .option('--current-outer <id>', PRESENCE_CHECK_STALE_CURRENT_OUTER_HELP)
  ).action((options: PresenceCheckStaleOptions) => runPresenceCheckStale(options, io));
}
