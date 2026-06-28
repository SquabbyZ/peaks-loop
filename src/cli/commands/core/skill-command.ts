import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/doctor-service.js';
import { listSkills } from '../../../services/skills/skill-registry.js';
import { runSkillSync, SYNC_PLATFORMS } from '../../../services/skills/sync-service.js';
import { inspectSkillRunbook } from '../../../services/skills/skill-runbook-service.js';
import { setSkillPresence, clearSkillPresence, getSkillPresence, isSkillPresenceMode, touchSkillHeartbeat, checkStalePresence } from '../../../services/skills/skill-presence-service.js';
import { detectPresenceMarker } from '../../../services/hooks/presence-marker-detector.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { generateProjectContext } from '../../../services/memory/project-context-service.js';
import { getSessionId, setSessionMeta } from '../../../services/session/session-manager.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerSkillCommand(program: Command, io: ProgramIO): void {
  const skill = program.command('skill').description('Manage Peaks skills');

  addJsonOption(skill.command('list').description('List skills derived from skills/*/SKILL.md')).action(async (options: { json?: boolean }) => {
    const skills = await listSkills();
    if (options.json === true) {
      printResult(io, ok('skill.list', { skills }), true);
    } else {
      const sorted = [...skills].sort((a, b) => {
        if (a.name === 'peaks-sop') return -1;
        if (b.name === 'peaks-sop') return 1;
        if (a.name === 'peaks-solo') return -1;
        if (b.name === 'peaks-solo') return 1;
        return a.name.localeCompare(b.name);
      });
      for (const skill of sorted) {
        io.stdout(`  ${skill.name.padEnd(14)}${skill.description}`);
      }
      io.stdout(`\n  Invoke any skill by typing its name in conversation (e.g. \`peaks-sop\`).`);
    }
  });

  addJsonOption(skill.command('doctor').description('Run skill-related doctor checks')).action(async (options: { json?: boolean }) => {
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
  });

  // Slice #12 final piece (per spec §9 line 1105):
  // `peaks skills sync 8 平台分发`. Idempotent: re-running is a
  // no-op when the symlinks are already correct.
  addJsonOption(
    skill
      .command('sync')
      .description(
        `Sync the peaks-* skill family to one or all of the 8 supported LLM-CLI platforms (${SYNC_PLATFORMS.join(', ')}). Idempotent.`
      )
      .option('--platform <id>', `sync only one platform (default: --all). Valid: ${SYNC_PLATFORMS.join(', ')}`)
      .option('--all', 'sync all 8 platforms (default if --platform is omitted)')
      .option('--dry-run', 'do not write; emit the same shape with applied=false')
      .option('--project <path>', 'project root (default: cwd)')
  ).action(async (options: { platform?: string; all?: boolean; dryRun?: boolean; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? process.cwd();
      const platforms = options.platform !== undefined ? [options.platform as never] : undefined;
      const result = await runSkillSync({
        projectRoot,
        ...(platforms !== undefined ? { platforms } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {}),
      });
      const envelope = ok('skill.sync', result, [], [
        `syncedCount: ${result.syncedCount}/${result.perPlatform.length} platforms`,
        `totalInstalled: ${result.totalInstalled} skill symlinks`,
        result.failedCount > 0
          ? `failedCount: ${result.failedCount} (run \`peaks skill status\` for details)`
          : 'no failures',
      ]);
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
  });

  addJsonOption(
    skill
      .command('runbook <name>')
      .description('Inspect a skill Default runbook section and its --apply authorization-note status')
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
              ? ['Add an authorization or --dry-run note next to destructive --apply lines in the runbook section']
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
      .option('--check-stale', 'slice 002 (v2.15.0): also report whether the recorded outer session id still matches the current one. Default false (back-compat).')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: { json?: boolean; checkStale?: boolean; project?: string }) => {
    const presence = getSkillPresence(options.project);
    if (presence === null) {
      printResult(io, ok('skill.presence', { active: false }), options.json);
      return;
    }
    if (options.checkStale === true) {
      // Slice 002 (v2.15.0) AC-1: pair the read with a staleness
      // check so callers (peaks-solo Step 1, statusline) get both
      // pieces of info from a single CLI invocation. The presence
      // is returned UNCHANGED — `--check-stale` is a read-only flag,
      // not a clear.
      const staleness = checkStalePresence({ projectRootOverride: options.project });
      printResult(
        io,
        ok('skill.presence', {
          active: true,
          ...presence,
          stale: staleness.stale,
          staleReason: staleness.reason,
          currentOuterSessionId: staleness.currentOuterSessionId,
          recordedOuterSessionId: staleness.recordedOuterSessionId
        }),
        options.json
      );
      return;
    }
    printResult(io, ok('skill.presence', { active: true, ...presence }), options.json);
  });

  addJsonOption(
    skill
      .command('presence:set <name>')
      .description('Set the currently active Peaks skill for session-wide visibility')
      .option('--mode <mode>', 'execution mode')
      .option('--gate <gate>', 'current gate')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((name: string, options: { mode?: string; gate?: string; project?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    if (options.mode !== undefined && !isSkillPresenceMode(options.mode)) {
      printResult(
        io,
        fail('skill.presence:set', 'INVALID_MODE',
          `Invalid mode: ${options.mode} (expected one of: full-auto, assisted, swarm, strict)`,
          { name, mode: options.mode },
          ['Use a valid mode: full-auto, assisted, swarm, or strict']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const presence = setSkillPresence(name, options.mode, options.gate, options.project);
    // As of slice 003-2026-06-06-session-layout-canonicalize we do NOT
    // call `ensureSession` here. The CLI wrapper previously spawned a
    // new session on every presence call, which made the canonical
    // session binding drift (the LLM saw the session id change every
    // turn). The presence now reuses the session bound at
    // `.peaks/_runtime/session.json` (or the legacy `.peaks/.session.json`
    // during the back-compat window). If no session is bound, the
    // presence still writes the active-skill marker — downstream code
    // can `peaks workspace init` separately to create the session.
    //
    // Session metadata is updated when a session is bound (read-only
    // path: `getSessionId`). We do not auto-spawn a session.
    const boundSessionId = getSessionId(projectRoot);
    if (boundSessionId !== null) {
      setSessionMeta(projectRoot, boundSessionId, {
        skill: name,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.gate ? { gate: options.gate } : {})
      });
    }
    printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
  });

  addJsonOption(
    skill
      .command('presence:clear')
      .description('Clear the active Peaks skill presence indicator and update project context')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((options: { project?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const removed = clearSkillPresence(options.project);
    // Auto-update project context so future sessions have up-to-date history
    try {
      generateProjectContext(projectRoot);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // non-fatal: context update failure should not block presence clear
    }
    printResult(io, ok('skill.presence:clear', { active: false, removed, projectContextUpdated: true }), options.json);
  });

  // Slice 002 (v2.15.0) — AC-1: presence staleness detector.
  // peaks-solo Step 1 (and `peaks solo should-pause --step
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
      .option('--current-outer <id>', 'override the current outer session id (test seam; default: read from PEAKS_OUTER_SESSION_ID / CLAUDE_CODE_SESSION_ID)')
  ).action((options: { project?: string; currentOuter?: string; json?: boolean }) => {
    const result = checkStalePresence({
      projectRootOverride: options.project,
      currentOuter: options.currentOuter
    });
    printResult(io, ok('skill.presence:check-stale', result), options.json);
  });

  addJsonOption(
    skill
      .command('heartbeat')
      .description('Show the heartbeat status of the active Peaks skill')
  ).action((options: { json?: boolean }) => {
    const presence = getSkillPresence();
    if (presence === null) {
      printResult(io, ok('skill.heartbeat', { active: false, heartbeat: 'none' }), options.json);
      return;
    }
    printResult(io, ok('skill.heartbeat', {
      active: true,
      skill: presence.skill,
      gate: presence.gate ?? null,
      lastHeartbeat: presence.lastHeartbeat ?? presence.setAt,
      setAt: presence.setAt
    }), options.json);
  });

  addJsonOption(
    skill
      .command('heartbeat:touch')
      .description('Update the heartbeat timestamp (called by the LLM each turn to confirm peaks skill context is alive)')
  ).action((options: { json?: boolean }) => {
    const updated = touchSkillHeartbeat();
    if (updated === null) {
      printResult(io, ok('skill.heartbeat:touch', { active: false, heartbeat: 'none' }), options.json);
      return;
    }
    printResult(io, ok('skill.heartbeat:touch', {
      active: true,
      skill: updated.skill,
      lastHeartbeat: updated.lastHeartbeat
    }), options.json);
  });

  addJsonOption(
    skill
      .command('detect-marker-loss')
      .description('Detect whether the latest assistant message lost the Peaks-Cli status header while a peaks skill is still active (slice 028 detection primitive).')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--message <text>', 'latest assistant message text to scan (defaults to reading the most recent LLM response from the stdin pipe, or empty string when no pipe is attached)')
  ).action((options: { project?: string; message?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const message = options.message ?? '';
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: message });
    printResult(io, ok('skill.detect-marker-loss', result), options.json);
  });
}
