import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/index.js';
import { listSkills } from '../../../services/skills/skill-registry.js';
import { runSkillSync, SYNC_PLATFORMS } from '../../../services/skills/sync-service.js';
import { inspectSkillRunbook } from '../../../services/skills/skill-runbook-service.js';
import {
  setSkillPresence,
  clearSkillPresence,
  getSkillPresence,
  isSkillPresenceMode,
  touchSkillHeartbeat,
  checkStalePresence
} from '../../../services/skills/skill-presence-service.js';
import { detectPresenceMarker } from '../../../services/hooks/presence-marker-detector.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { generateProjectContext } from '../../../services/memory/project-context-service.js';
import { getSessionId, setSessionMeta } from '../../../services/session/session-manager.js';
import { resolveCallerProjection } from '../../../services/session/resolve-caller-id.js';
import { readContextPercent } from '../../../services/context/auto-compact-reader.js';
import { resolveOuterSessionId } from '../../../services/session/binding-status-service.js';
import { evaluateCompactTrigger } from '../../../services/code/auto-compact-orchestrator.js';
import { resolveAutoCompactProfile } from '../../../services/mode/mode-status-service.js';
import type { AutoCompactMode } from '../../../services/code/auto-compact-modes.js';
import { gcStalePresenceLeases } from '../../../services/skills/presence-lease-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { stableRealPath } from '../../../shared/path-utils.js';
import { detectStaleGeneratedArtifacts } from '../../../services/workspace/generated-artifacts-stamp.js';

/**
 * Canonicalize a user-supplied `--project <path>` value.
 *
 * Git Bash on Windows hands us forward-slash paths
 * (`C:/Users/.../peaks-loop`) while `peaks workspace init` writes the
 * backslash form, and either side may carry a trailing separator or
 * differing case. Resolving to the real path here means every
 * downstream consumer (`getSessionId`, `setSessionMeta`,
 * `setSkillPresence`) sees one stable form.
 *
 * Returns the input unchanged when it cannot be resolved (path does
 * not exist yet, or is not readable) so a bad `--project` still
 * reaches the existing error handling rather than throwing here.
 */
/**
 * The loop-hygiene verdict attached to every ACTIVE `skill.presence` read.
 *
 * Why it lives here instead of only in a SKILL.md body: the zero-pause
 * contract ("auto-compact is the skill's own action, never the user's")
 * was already written into `peaks-code/SKILL.md`, including an explicit
 * ban on the exact phrasing "prompt the user to run `/compact`" — and it
 * was still violated. A SKILL.md body is loaded once and is then
 * compacted away, so the rule stops governing at precisely the moment
 * context pressure makes it matter. `skill.presence` is the one call
 * EVERY skill makes on EVERY turn, in EVERY consumer project and EVERY
 * mode, so a value carried here cannot be forgotten, and no skill has to
 * be edited for the obligation to reach the model.
 *
 * READ-ONLY by contract. It probes and reports; it never compacts.
 * Executing `peaks code auto-compact` stays the skill's own action — a
 * side effect here would fire on every single turn.
 *
 * Failure swallows to `null`: the hygiene verdict is advisory and must
 * never be able to break the presence read itself.
 */
export function buildContextVerdict(
  ratio: number,
  mode: AutoCompactMode
): {
  context: { ratioPct: string; action: string; mode: string };
  nextActions: string[];
} {
  const trigger = evaluateCompactTrigger(ratio, mode);
  const ratioPct = `${(ratio * 100).toFixed(1)}%`;
  // `auto-fire` belongs in the in-zone set: it is the tier where
  // peaks-loop preempts rather than asking the LLM to decide.
  const inZone =
    trigger.kind === 'auto-fire' || trigger.kind === 'pre-compact' || trigger.kind === 'red-line';
  return {
    context: { ratioPct, action: trigger.kind, mode },
    nextActions: inZone
      ? [
          `Context at ${ratioPct} is in the '${trigger.kind}' zone (mode=${mode}).`,
          'Run `peaks code auto-compact --project .` YOURSELF now, then continue. Do NOT ask the user to run /compact — that is the regression the zero-pause contract forbids.'
        ]
      : []
  };
}

function contextVerdict(projectRoot: string): {
  context: { ratioPct: string; action: string; mode: string } | null;
  nextActions: string[];
} {
  try {
    const sessionId = getSessionId(projectRoot);
    if (sessionId === null) return { context: null, nextActions: [] };
    const mode = resolveAutoCompactProfile(projectRoot);
    // `outerSessionId` is NOT optional in practice: without it the
    // adapter cannot find the harness transcript and falls back to
    // conservative-zero, reporting a serene "0.0%" that never crosses
    // any threshold. Same resolution order the orchestrator uses.
    const outerSessionId = resolveOuterSessionId(projectRoot, sessionId, process.env);
    const probe = readContextPercent({ projectRoot, sessionId, outerSessionId, env: process.env });
    return buildContextVerdict(probe.ratio, mode);
  } catch {
    return { context: null, nextActions: [] };
  }
}

function canonicalizeProjectOption(project: string | undefined): string | undefined {
  if (project === undefined) return undefined;
  try {
    return stableRealPath(project);
  } catch {
    return project;
  }
}

/**
 * D1 (2026-09-15) — generated-config staleness, carried on `skill presence`.
 *
 * WHY THIS CALL. `npm i -g peaks-loop@<newer>` upgrades the CLI and leaves the
 * project's generated config exactly as the OLD release wrote it:
 * `initWorkspace` is the only writer and `ensureSession` early-returns once a
 * session is bound, so nothing re-runs the generator. `.claude/settings.local.json`
 * is drift-checked — but only on an init that never comes. The user found the
 * previous instance of this by deleting their `.claude/*.json` and restarting;
 * nothing in the product told them to.
 *
 * `peaks skill presence` is the ONE peaks call every skill makes in every turn
 * (CLAUDE.md mandates it at the start of every response), so it is the only
 * channel guaranteed to carry a drift notice to the LLM that can act on it —
 * the same reasoning as the loop-hygiene verdict attached one screen down. A
 * rule that lives only in a SKILL.md body is compacted away; a warning that
 * rides the per-turn tool output is not.
 *
 * The field is additive and present only when stale, so no existing consumer
 * of the envelope changes shape. `null` projectRoot means the caller had no
 * project to inspect — skipped, not assumed stale.
 */
function generatedConfigNotice(projectRoot: string | undefined): {
  field: Record<string, unknown>;
  warnings: string[];
} {
  if (projectRoot === undefined) return { field: {}, warnings: [] };
  const staleness = detectStaleGeneratedArtifacts(projectRoot);
  if (!staleness.stale) return { field: {}, warnings: [] };
  const onDiskVersion = staleness.onDisk?.packageVersion ?? '(unstamped)';
  return {
    field: {
      generatedArtifacts: {
        stale: true,
        reasons: staleness.reasons,
        onDiskPackageVersion: staleness.onDisk?.packageVersion ?? null,
        installedPackageVersion: staleness.expected.packageVersion
      }
    },
    warnings: [
      `Generated config at '${projectRoot}' was produced by peaks-loop ${onDiskVersion} ` +
        `but ${staleness.expected.packageVersion} is installed (${staleness.reasons.join(', ')}). ` +
        `Re-run \`peaks workspace init\` (or the idempotent \`peaks upgrade --apply-init\`) ` +
        `to regenerate .claude/settings.local.json and the offline template copy.`
    ]
  };
}

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
// Slice S0 (4.0.0-beta.5 peaks-solo dispatcher release):
// `peaks skill search` is the CLI primitive that feeds the
// peaks-solo dispatcher (S1). Adding a single import + register call
// here keeps the change surgical and leaves all existing skill
// subcommands (list / doctor / sync / runbook / presence / heartbeat)
// untouched. See
// docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
// and the S0 plan under docs/superpowers/plans/.
import { registerSkillSearchCommand } from '../skill-search-commands.js';

export function registerSkillCommand(program: Command, io: ProgramIO): void {
  const skill = program.command('skill').description('Manage Peaks skills');

  addJsonOption(
    skill
      .command('list')
      .description('List skills derived from skills/*/SKILL.md')
      .option('--include-internal', 'include skills with visibility: internal (default: hide them)')
  ).action(async (options: { json?: boolean; includeInternal?: boolean }) => {
    let skills = await listSkills();
    if (options.includeInternal !== true) {
      skills = skills.filter((s) => s.visibility !== 'internal');
    }
    if (options.json === true) {
      printResult(io, ok('skill.list', { skills }), true);
    } else {
      const sorted = [...skills].sort((a, b) => {
        // Slice S0 (4.0.0-beta.5): peaks-solo is the dispatcher (front
        // door) — list it FIRST so users discover the dispatcher before
        // any specific leaf. Followed by peaks-sop (current default
        // runbook showcase) and peaks-code (canonical code-domain
        // orchestrator); everything else falls back to alphabetical.
        if (a.name === 'peaks-solo') return -1;
        if (b.name === 'peaks-solo') return 1;
        if (a.name === 'peaks-sop') return -1;
        if (b.name === 'peaks-sop') return 1;
        if (a.name === 'peaks-code') return -1;
        if (b.name === 'peaks-code') return 1;
        return a.name.localeCompare(b.name);
      });
      for (const skill of sorted) {
        io.stdout(`  ${skill.name.padEnd(14)}${skill.description}`);
      }
      io.stdout(`\n  Invoke any skill by typing its name in conversation (e.g. \`peaks-sop\`).`);
    }
  });

  addJsonOption(skill.command('doctor').description('Run skill-related doctor checks')).action(
    async (options: { json?: boolean }) => {
      const report = await runDoctor();
      const skillChecks = report.checks.filter((check) => check.id.startsWith('skill'));
      const failed = skillChecks.filter((check) => !check.ok).length;
      if (options.json === true) {
        printResult(io, ok('skill.doctor', { checks: skillChecks, ok: failed === 0 }), true);
      } else {
        for (const check of skillChecks) {
          const icon = check.ok ? '+' : '×';
          io.stdout(`  ${icon}  ${check.message}`);
        }
        io.stdout(`\n  ${skillChecks.length - failed} passed, ${failed} failed`);
        if (failed > 0) {
          io.stderr('\nOne or more skill checks failed.');
        }
      }
      if (failed > 0) {
        process.exitCode = 1;
      }
    }
  );

  // Slice #12 final piece (per spec §9 line 1105):
  // `peaks skills sync 8 平台分发`. Idempotent: re-running is a
  // no-op when the symlinks are already correct.
  addJsonOption(
    skill
      .command('sync')
      .description(
        `Sync the peaks-* skill family to one or all of the 8 supported LLM-CLI platforms (${SYNC_PLATFORMS.join(', ')}). Idempotent.`
      )
      .option(
        '--platform <id>',
        `sync only one platform (default: --all). Valid: ${SYNC_PLATFORMS.join(', ')}`
      )
      .option('--all', 'sync all 8 platforms (default if --platform is omitted)')
      .option('--dry-run', 'do not write; emit the same shape with applied=false')
      .option(
        '--reconcile-junctions',
        'repair Peaks-managed skill Junctions whose targets were deleted with a host worktree'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action(
    async (options: {
      platform?: string;
      all?: boolean;
      dryRun?: boolean;
      reconcileJunctions?: boolean;
      project?: string;
      json?: boolean;
    }) => {
      try {
        const projectRoot = options.project ?? process.cwd();
        const platforms = options.platform !== undefined ? [options.platform as never] : undefined;
        const result = await runSkillSync({
          projectRoot,
          ...(platforms !== undefined ? { platforms } : {}),
          ...(options.dryRun === true ? { dryRun: true } : {}),
          ...(options.reconcileJunctions === true ? { reconcileJunctions: true } : {})
        });
        const envelope = ok(
          'skill.sync',
          result,
          [],
          [
            `syncedCount: ${result.syncedCount}/${result.perPlatform.length} platforms`,
            `totalInstalled: ${result.totalInstalled} skill symlinks`,
            result.failedCount > 0
              ? `failedCount: ${result.failedCount} (run \`peaks skill status\` for details)`
              : 'no failures'
          ]
        );
        printResult(io, envelope, options.json);
        if (result.failedCount > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        printResult(
          io,
          fail('skill.sync', 'SKILL_SYNC_FAILED', message, { applied: false }, [message]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    skill
      .command('runbook <name>')
      .description(
        'Inspect a skill Default runbook section and its --apply authorization-note status'
      )
  ).action(async (name: string, options: { json?: boolean }) => {
    try {
      const inspection = await inspectSkillRunbook(name);
      const result = inspection.ok
        ? ok('skill.runbook', inspection)
        : fail(
            'skill.runbook',
            inspection.hasRunbook ? 'SKILL_RUNBOOK_APPLY_UNGATED' : 'SKILL_RUNBOOK_MISSING',
            inspection.hasRunbook
              ? `Skill ${inspection.name} has ${inspection.destructiveApplyLines.length} destructive --apply command(s) without an authorization/dry-run note`
              : `Skill ${inspection.name} is missing a ## Default runbook section`,
            inspection,
            inspection.hasRunbook
              ? [
                  'Add an authorization or --dry-run note next to destructive --apply lines in the runbook section'
                ]
              : ['Add a `## Default runbook` section to the skill SKILL.md']
          );
      printResult(io, result, options.json);
      if (!inspection.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('skill.runbook', 'SKILL_NOT_FOUND', getErrorMessage(error), { name }),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    skill
      .command('presence')
      .description('Show the currently active Peaks skill (alias: presence:get)')
      .option(
        '--check-stale',
        'slice 002 (v2.15.0): also report whether the recorded outer session id still matches the current one. Default false (back-compat).'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: { json?: boolean; checkStale?: boolean; project?: string }) => {
    const projectOption = canonicalizeProjectOption(options.project);
    const generatedConfig = generatedConfigNotice(
      projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd()
    );
    const presence = getSkillPresence(projectOption);
    if (presence === null) {
      printResult(
        io,
        ok('skill.presence', { active: false, ...generatedConfig.field }, generatedConfig.warnings),
        options.json
      );
      return;
    }
    // Loop-hygiene verdict: attached to every ACTIVE read, so the
    // zero-pause contract travels with the one call every skill already
    // makes — in every mode and every consumer project.
    const verdict = contextVerdict(projectOption ?? process.cwd());
    if (options.checkStale === true) {
      // Slice 002 (v2.15.0) AC-1: pair the read with a staleness
      // check so callers (peaks-code Step 1, statusline) get both
      // pieces of info from a single CLI invocation. The presence
      // is returned UNCHANGED — `--check-stale` is a read-only flag,
      // not a clear.
      const staleness = checkStalePresence({ projectRootOverride: projectOption });
      printResult(
        io,
        ok(
          'skill.presence',
          {
            active: true,
            ...presence,
            stale: staleness.stale,
            staleReason: staleness.reason,
            currentOuterSessionId: staleness.currentOuterSessionId,
            recordedOuterSessionId: staleness.recordedOuterSessionId,
            ...(verdict.context !== null ? { context: verdict.context } : {}),
            ...generatedConfig.field
          },
          generatedConfig.warnings,
          verdict.nextActions
        ),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok(
        'skill.presence',
        {
          active: true,
          ...presence,
          ...(verdict.context !== null ? { context: verdict.context } : {}),
          ...generatedConfig.field
        },
        generatedConfig.warnings,
        verdict.nextActions
      ),
      options.json
    );
  });

  addJsonOption(
    skill
      .command('presence:set <name>')
      .description(
        'Set the currently active Peaks skill for session-wide visibility. Slice 4.0.8: requires a bound session and an adapter-resolved caller id (fail-closed); raw unlink is rejected.'
      )
      .option('--mode <mode>', 'execution mode')
      .option('--gate <gate>', 'current gate')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action(
    (name: string, options: { mode?: string; gate?: string; project?: string; json?: boolean }) => {
      const projectOption = canonicalizeProjectOption(options.project);
      const projectRoot = projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd();
      if (options.mode !== undefined && !isSkillPresenceMode(options.mode)) {
        printResult(
          io,
          fail(
            'skill.presence:set',
            'INVALID_MODE',
            `Invalid mode: ${options.mode} (expected one of: full-auto, assisted, strict, 24h)`,
            { name, mode: options.mode },
            ['Use a valid mode: full-auto, assisted, strict, or 24h']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      // Slice 4.0.8 (D1 + D2): `presence:set` is fail-closed. We refuse
      // any write when (a) no peaks session is bound, or (b) the active
      // IDE adapter cannot resolve a valid callerId. Both failures
      // surface BEFORE any filesystem write. The legacy
      // `setSkillPresence` wrapper is kept as a compat shim for tests
      // and CLI flows that intentionally do not need a session — but
      // production CLI traffic must go through this gate.
      const boundSessionId = getSessionId(projectRoot);
      if (boundSessionId === null) {
        printResult(
          io,
          fail(
            'skill.presence:set',
            'PEAKS_SESSION_NOT_BOUND',
            'No canonical peaks session is bound for this project (RD §3 D1).',
            { projectRoot, name },
            [
              'Run `peaks workspace init --project <p>` first, then re-run `peaks skill presence:set`.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      try {
        resolveCallerProjection({ projectRoot });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printResult(
          io,
          fail(
            'skill.presence:set',
            'PEAKS_CALLER_NOT_RESOLVED',
            `Active IDE adapter could not resolve a callerId (RD §3 D1): ${message}`,
            { projectRoot, name },
            [
              'Ensure the active IDE is detected by `peaks` and the IDE session variable is set.',
              'Or set PEAKS_CALLER_ID=<id> in the environment for scripted usage.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const presence = setSkillPresence(name, options.mode, options.gate, projectOption);
      // Session metadata is updated when a session is bound (read-only
      // path: `getSessionId`). We do not auto-spawn a session.
      if (boundSessionId !== null) {
        setSessionMeta(projectRoot, boundSessionId, {
          skill: name,
          ...(options.mode ? { mode: options.mode } : {}),
          ...(options.gate ? { gate: options.gate } : {})
        });
      }
      printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
    }
  );

  addJsonOption(
    skill
      .command('presence:clear')
      .description(
        'Unlink the DEPRECATED pre-4.0.11 single-slot presence marker files (`.peaks/_runtime/active-skill.json`, `.peaks/.active-skill.json`). It does NOT terminalize a live presence lease — a workflow-bound lease terminalizes through `peaks workflow terminalize --workflow <id> --reason <reason>`, an ad-hoc lease only at session exit, and raw unlink is FORBIDDEN for both. The envelope reports what is still active.'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action(async (options: { project?: string; json?: boolean }) => {
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
    // Slice 2026-07-15-project-scan-bootstrap: generateProjectContext now also
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
        {
          active,
          removed,
          cleared,
          ...(cleared ? {} : { reason: 'live-lease-survives-presence-clear' }),
          projectContextUpdated: true
        },
        [],
        cleared
          ? []
          : [
              'A workflow-bound lease terminalizes through `peaks workflow terminalize --workflow <id> --reason <reason>`.',
              'An ad-hoc lease (`peaks skill presence:set`) is terminalizable only at session exit; `presence:clear` will not remove it, and raw unlink is FORBIDDEN.',
              'Run `peaks skill presence --json` to read the lease that survived.'
            ]
      ),
      options.json
    );
  });

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
  addJsonOption(
    skill
      .command('lease gc')
      .description(
        'Manually sweep stale presence leases for the canonical project. Both predicates required: now - lastHeartbeat > 1h AND now - startedAt > 24h. Drained leases are classified; corrupt graphs surface as PEAKS_GRAPH_REF_BROKEN warnings and are excluded.'
      )
      .option('--project <path>', 'project root (default: cwd)')
      .option('--now <iso>', 'override the current time (test seam)')
  ).action(async (options: { project?: string; now?: string; json?: boolean }) => {
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
          {
            envelopeVersion: '4.0.8',
            removed: result.removed,
            retained: result.retained,
            trigger: result.trigger,
            inFlightBatch: result.inFlightBatch,
            warnings: result.warnings,
            errors: result.errors
          },
          result.warnings.map((w) => `${w.code}: ${w.message}`),
          [
            'GC predicate: now - lastHeartbeat > 1h AND now - startedAt > 24h (RD §3 D2 + D3).',
            'Re-run `peaks workspace init` or `peaks skill presence:set` to sweep the same project on the bound trigger.'
          ]
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
  });

  // Slice 002 (v2.15.0) — AC-1: presence staleness detector.
  // peaks-code Step 1 (and `peaks code should-pause --step
  // step-1-mode-select`) calls this to decide whether the recorded
  // `mode` field can be trusted or whether the LLM must AskUserQuestion.
  addJsonOption(
    skill
      .command('presence:check-stale')
      .description(
        'Slice 002 (v2.15.0) AC-1: report whether the recorded presence outer session id still matches the current outer session id. ' +
          'Returns { stale: boolean, reason: "outer-session-mismatch" | "no-presence" | null }. ' +
          'Pure read-only — does NOT clear the presence (use `peaks skill presence:clear` for that).'
      )
      .option('--project <path>', 'project root (default: cwd)')
      .option(
        '--current-outer <id>',
        'override the current outer session id (test seam; default: read from PEAKS_OUTER_SESSION_ID / CLAUDE_CODE_SESSION_ID)'
      )
  ).action((options: { project?: string; currentOuter?: string; json?: boolean }) => {
    // v2.15.0 slice 002 repair: do NOT pass `currentOuter: undefined`
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
    // when undefined → ''), per slice 002 AC-1 contract: downstream
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
  });

  addJsonOption(
    skill.command('heartbeat').description('Show the heartbeat status of the active Peaks skill')
  ).action((options: { json?: boolean }) => {
    const presence = getSkillPresence();
    if (presence === null) {
      printResult(io, ok('skill.heartbeat', { active: false, heartbeat: 'none' }), options.json);
      return;
    }
    printResult(
      io,
      ok('skill.heartbeat', {
        active: true,
        skill: presence.skill,
        gate: presence.gate ?? null,
        lastHeartbeat: presence.lastHeartbeat ?? presence.setAt,
        setAt: presence.setAt
      }),
      options.json
    );
  });

  addJsonOption(
    skill
      .command('heartbeat:touch')
      .description(
        'Update the heartbeat timestamp (called by the LLM each turn to confirm peaks skill context is alive)'
      )
  ).action((options: { json?: boolean }) => {
    const updated = touchSkillHeartbeat();
    if (updated === null) {
      printResult(
        io,
        ok('skill.heartbeat:touch', { active: false, heartbeat: 'none' }),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok('skill.heartbeat:touch', {
        active: true,
        skill: updated.skill,
        lastHeartbeat: updated.lastHeartbeat
      }),
      options.json
    );
  });

  addJsonOption(
    skill
      .command('detect-marker-loss')
      .description(
        'Detect whether the latest assistant message lost the Peaks-Loop status header while a peaks skill is still active (slice 028 detection primitive).'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option(
        '--message <text>',
        'latest assistant message text to scan (defaults to reading the most recent LLM response from the stdin pipe, or empty string when no pipe is attached)'
      )
  ).action((options: { project?: string; message?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const message = options.message ?? '';
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: message });
    printResult(io, ok('skill.detect-marker-loss', result), options.json);
  });

  // Slice S0 — register `peaks skill search`. Sibling subcommand to
  // list / runbook / presence; preserves the existing surface
  // (HC-10 — 老入口保留).
  registerSkillSearchCommand(program, io);
}
