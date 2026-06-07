import { Command } from 'commander';
import { createArtifactInitPlan, getArtifactStatus, createGuidedArtifactSetup } from '../../services/artifacts/artifact-service.js';
import { getArtifactWorkspaceStatus, planArtifactSync } from '../../services/artifacts/workspace-service.js';
import { executeProjectMemoryBackup, executeProjectMemoryExtract, summarizeProjectMemoryBackupResult, summarizeProjectMemoryExtractResult } from '../../services/memory/project-memory-service.js';
import { executeProjectStandardsInit, executeProjectStandardsUpdate, summarizeProjectStandardsInitResult, summarizeProjectStandardsUpdateResult } from '../../services/standards/project-standards-service.js';
import { executeProjectStandardsInitIdeAware, executeProjectStandardsUpdateIdeAware } from '../../services/standards/ide-aware-standards-service.js';
import { listProfiles } from '../../services/profiles/profile-service.js';
import { planProxyTest } from '../../services/proxy/proxy-service.js';
import { runDoctor } from '../../services/doctor/doctor-service.js';
import { listSkills } from '../../services/skills/skill-registry.js';
import { inspectSkillRunbook } from '../../services/skills/skill-runbook-service.js';
import { setSkillPresence, clearSkillPresence, getSkillPresence, isSkillPresenceMode, touchSkillHeartbeat } from '../../services/skills/skill-presence-service.js';
import { ensureSession, getSessionId, getSessionMeta, rotateSessionBinding, setSessionMeta, setSessionTitle, listSessionMetas } from '../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { generateProjectContext } from '../../services/memory/project-context-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, isArtifactProvider, isArtifactSetupStep, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerCoreAndArtifactCommands(program: Command, io: ProgramIO): void {
  addJsonOption(program.command('doctor').description('Run repository doctor checks')).action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    const result = report.summary.ok
      ? ok('doctor', report)
      : fail('doctor', 'DOCTOR_FAILED', 'One or more doctor checks failed', report, ['Fix failed checks and rerun peaks doctor']);
    if (options.json === true) {
      printResult(io, result, true);
    } else {
      // Human-readable: one line per check, green/red indicators, no JSON.
      for (const check of report.checks) {
        const icon = check.ok ? '+' : '×';
        io.stdout(`  ${icon}  ${check.message}`);
      }
      io.stdout(`\n  ${report.summary.passed} passed, ${report.summary.failed} failed`);
      if (!report.summary.ok) {
        io.stderr(`\nDOCTOR_FAILED: ${report.summary.failed} check(s) failed. Fix them and rerun peaks doctor.`);
      }
    }
    if (!report.summary.ok) {
      process.exitCode = 1;
    }
  });

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
      .description('Show the currently active Peaks skill')
  ).action((options: { json?: boolean }) => {
    const presence = getSkillPresence();
    if (presence === null) {
      printResult(io, ok('skill.presence', { active: false }), options.json);
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
    } catch {
      // non-fatal: context update failure should not block presence clear
    }
    printResult(io, ok('skill.presence:clear', { active: false, removed, projectContextUpdated: true }), options.json);
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

  const session = program.command('session').description('Manage Peaks session directories');

  addJsonOption(
    session
      .command('list')
      .description('List all session directories with titles and metadata')
  ).action((options: { json?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const metas = listSessionMetas(projectRoot);
    printResult(io, ok('session.list', { sessions: metas, total: metas.length }), options.json);
  });

  addJsonOption(
    session
      .command('info [sessionId]')
      .description('Show full metadata for a session directory. Pass --active to resolve the canonical binding from .peaks/_runtime/session.json (the "one command a sub-agent runs to find the parent\'s sid" primitive).')
      .option('--active', 'resolve the canonical session id from .peaks/_runtime/session.json (ignores [sessionId] when set)')
  ).action(async (sessionId: string | undefined, options: { json?: boolean; active?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    // Slice 007 — sub-agent session sharing. A sub-agent that does
    // not know the parent's sid reads it from the binding via
    // `peaks session info --active`. The call uses the
    // canonicalize-on-read path so a stored "projectRoot: '.'" and a
    // caller-passed absolute realpath both resolve to the same
    // binding. Without this primitive the sub-agent has no way to
    // discover the parent sid short of scanning the filesystem.
    if (options.active === true) {
      // Import lazily to avoid a cycle with workspace-commands.
      const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
      const activeSid = getSessionIdCanonical(projectRoot);
      if (activeSid === null) {
        printResult(io, fail('session.info', 'NO_ACTIVE_BINDING', 'No canonical session binding at .peaks/_runtime/session.json', { projectRoot }, ['Run `peaks workspace init` or `peaks skill presence:set` to anchor a session']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('session.info', { active: true, sessionId: activeSid, source: '.peaks/_runtime/session.json' }), options.json);
      return;
    }
    if (sessionId === undefined) {
      printResult(io, fail('session.info', 'SESSION_ID_REQUIRED', 'session.info requires a <sessionId> or --active', {}, ['Pass a <sessionId> argument, or use --active to resolve the canonical binding']), options.json);
      process.exitCode = 1;
      return;
    }
    const meta = getSessionMeta(projectRoot, sessionId);
    if (meta === null) {
      printResult(io, fail('session.info', 'SESSION_NOT_FOUND', `Session "${sessionId}" not found or has no metadata`, { sessionId }, ['Use `peaks session list` to see available sessions']), options.json);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('session.info', meta), options.json);
  });

  addJsonOption(
    session
      .command('title <sessionId> <title>')
      .description('Set a human-readable title for a session directory')
  ).action((sessionId: string, title: string, options: { json?: boolean }) => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    try {
      const meta = setSessionTitle(projectRoot, sessionId, title);
      printResult(io, ok('session.title', meta), options.json);
    } catch (error) {
      printResult(io, fail('session.title', 'SESSION_TITLE_FAILED', getErrorMessage(error), { sessionId }, ['Verify the sessionId exists under .peaks/']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    session
      .command('rotate')
      .description('Drop the project-level session binding so the next peaks call auto-generates a fresh session id. The on-disk session directory is left intact — only .peaks/.session.json is removed.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--reason <text>', 'human-readable reason for the rotation, recorded in the response data')
  ).action(async (options: { project?: string; reason?: string; json?: boolean }) => {
    try {
      // Canonicalise the project root before touching the binding.
      // `peaks workspace init` writes the binding with the
      // realpath-resolved projectRoot; if the caller passes a path
      // through a symlink (notably /tmp on macOS, which is a
      // symlink to /private/tmp) without canonicalising here,
      // readSessionFile's strict projectRoot equality check fails
      // and the rotate call reports "no prior binding" even
      // though one exists. The same fix as `workspace init`
      // (b193714): promote the path to the git root, falling back
      // to the heuristic, falling back to cwd verbatim.
      const projectRoot = options.project !== undefined
        ? options.project
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);
      const previousSessionId = rotateSessionBinding(canonical);
      printResult(io, ok('session.rotate', {
        previousSessionId,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        note: previousSessionId === null
          ? 'No prior binding was present; the project is already unbound.'
          : 'Next ensureSession() call will auto-generate a fresh id. The previous session directory is still on disk at .peaks/<previousSessionId>/.'
      }), options.json);
    } catch (error) {
      printResult(io, fail('session.rotate', 'SESSION_ROTATE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']), options.json);
      process.exitCode = 1;
    }
  });

  const profile = program.command('profile').description('Manage runtime profiles');
  addJsonOption(profile.command('list').description('List available profiles')).action((options: { json?: boolean }) => {
    printResult(io, ok('profile.list', { profiles: listProfiles() }), options.json);
  });

  const standards = program.command('standards').description('Manage project-local coding standards');
  addJsonOption(
    standards
      .command('init')
      .description('Initialize project-local coding standards for Peaks skill preflight')
      .requiredOption('--project <path>', 'target project root')
      .option('--language <language>', 'standards language pack')
      .option('--ide <id>', 'override IDE detection (e.g. claude-code, trae)')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write missing standards into the target project')
  ).action((options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.init', 'INVALID_STANDARDS_INIT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsInitIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      printResult(io, ok('standards.init', summarizeProjectStandardsInitResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('standards.init', 'STANDARDS_INIT_FAILED', getErrorMessage(error), {}, ['Check the project path and existing .claude/rules directory before retrying']), options.json);
      process.exitCode = 1;
    }
  });
  addJsonOption(
    standards
      .command('update')
      .description('Append managed standards metadata to an existing CLAUDE.md without rewriting the body')
      .requiredOption('--project <path>', 'target project root')
      .option('--language <language>', 'standards language pack')
      .option('--ide <id>', 'override IDE detection (e.g. claude-code, trae)')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'append managed metadata to the target project')
  ).action((options: { project: string; language?: string; ide?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.update', 'INVALID_STANDARDS_UPDATE_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards updates']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsUpdateIdeAware({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), ...(options.ide !== undefined ? { ideId: options.ide as 'claude-code' | 'trae' | 'codex' | 'cursor' | 'qoder' | 'tongyi-lingma' } : {}), apply: options.apply === true });
      const summary = summarizeProjectStandardsUpdateResult(result);
      const response = summary.reviewSuggestions.length > 0
        ? fail('standards.update', 'STANDARDS_UPDATE_REVIEW_REQUIRED', 'Standards update requires manual review', summary, summary.reviewSuggestions)
        : ok('standards.update', summary);
      printResult(io, response, options.json);
      if (summary.reviewSuggestions.length > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(io, fail('standards.update', 'STANDARDS_UPDATE_FAILED', getErrorMessage(error), {}, ['Check the project path, CLAUDE.md contents, and existing .claude/rules directory before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  const memory = program.command('memory').description('Manage project-local Peaks memory');
  addJsonOption(
    memory
      .command('extract')
      .description('Extract stable project memory from skill artifacts into project .peaks/memory')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--artifact <path...>', 'skill artifact paths inside the project')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write extracted memories into project .peaks/memory')
  ).action((options: { project: string; artifact: string[]; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('memory.extract', 'INVALID_MEMORY_EXTRACT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or pass --apply to write memories']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const result = executeProjectMemoryExtract({ projectRoot: options.project, artifactPaths: options.artifact, apply: options.apply === true });
      printResult(io, ok('memory.extract', summarizeProjectMemoryExtractResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('memory.extract', 'MEMORY_EXTRACT_FAILED', getErrorMessage(error), {}, ['Check artifact paths and remove secrets before extracting memory']), options.json);
      process.exitCode = 1;
    }
  });
  addJsonOption(
    memory
      .command('sync')
      .description('Back up project .peaks/memory into the artifact workspace')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--workspace <path>', 'artifact workspace path')
      .option('--dry-run', 'preview copies without changing files')
      .option('--apply', 'copy project .peaks/memory into artifact workspace backup')
  ).action((options: { project: string; workspace: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('memory.sync', 'INVALID_MEMORY_SYNC_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview copies, or pass --apply to back up memories']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const result = executeProjectMemoryBackup({ projectRoot: options.project, artifactWorkspacePath: options.workspace, apply: options.apply === true });
      printResult(io, ok('memory.sync', summarizeProjectMemoryBackupResult(result)), options.json);
    } catch (error) {
      printResult(io, fail('memory.sync', 'MEMORY_SYNC_FAILED', getErrorMessage(error), {}, ['Use an artifact workspace outside the project root']), options.json);
      process.exitCode = 1;
    }
  });

  const proxy = program.command('proxy').description('Manage proxy settings');
  addJsonOption(
    proxy
      .command('test')
      .description('Plan or run a proxy connectivity test')
      .requiredOption('--proxy <url>', 'proxy URL')
      .option('--target <url>', 'target URL', 'https://www.google.com')
      .option('--dry-run', 'only print the planned command', true)
      .option('--no-dry-run', 'unsupported: do not execute connectivity tests from this CLI')
  ).action((options: { proxy: string; target: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'proxy.test', options.json);
      return;
    }

    try {
      const plan = planProxyTest(options.proxy, options.target, true);
      printResult(io, ok('proxy.test', plan), options.json);
    } catch (error) {
      printResult(io, fail('proxy.test', 'INVALID_PROXY', getErrorMessage(error), {}, ['Use a proxy URL starting with http:// or https://']), options.json);
      process.exitCode = 1;
    }
  });

  const artifacts = program.command('artifacts').description('Manage intermediate artifact repositories');
  addJsonOption(artifacts.command('status').description('Show artifact repository status')).action((options: { json?: boolean }) => {
    printResult(io, ok('artifacts.status', getArtifactStatus()), options.json);
  });
  addJsonOption(
    artifacts
      .command('init')
      .description('Plan remote-first artifact repository initialization')
      .requiredOption('--provider <provider>', 'artifact provider: github or gitlab')
      .requiredOption('--name <name>', 'remote repository name')
      .option('--path <path>', 'local artifact working copy path', '.peaks-artifacts')
      .option('--dry-run', 'preview without creating repositories or files', true)
      .option('--no-dry-run', 'unsupported: do not create repositories or files from this CLI')
  ).action((options: { provider: string; name: string; path: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'artifacts.init', options.json);
      return;
    }

    if (!isArtifactProvider(options.provider)) {
      printResult(io, fail('artifacts.init', 'UNSUPPORTED_ARTIFACT_PROVIDER', `Unsupported provider ${options.provider}`, {}, ['Use --provider github or --provider gitlab']), options.json);
      process.exitCode = 1;
      return;
    }

    printResult(io, ok('artifacts.init', createArtifactInitPlan({
      provider: options.provider,
      name: options.name,
      localPath: options.path,
      dryRun: true
    })), options.json);
  });
  addJsonOption(
    artifacts
      .command('sync')
      .description('Plan sync between local artifact workspace and remote repository')
      .option('--workspace <id>', 'workspace identifier (uses current if not specified)')
      .option('--dry-run', 'preview sync plan without executing', true)
      .option('--no-dry-run', 'unsupported: do not sync from this CLI')
  ).action((options: { workspace?: string; dryRun?: boolean; json?: boolean }) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'artifacts.sync', options.json);
      return;
    }
    printResult(io, ok('artifacts.sync', planArtifactSync(options.workspace, true)), options.json);
  });
  addJsonOption(artifacts.command('workspace').description('Show artifact workspace status for current or specified workspace').option('--workspace <id>', 'workspace identifier')).action((options: { workspace?: string; json?: boolean }) => {
    printResult(io, ok('artifacts.workspace', getArtifactWorkspaceStatus(options.workspace)), options.json);
  });
  addJsonOption(artifacts.command('setup').description('Interactive guided artifact repository setup').option('--step <step>', 'start from specific step: detect, configure, validate, complete')).action((options: { step?: string; json?: boolean }) => {
    const requestedStep = options.step;
    const setup = createGuidedArtifactSetup();

    if (requestedStep) {
      if (!isArtifactSetupStep(requestedStep)) {
        printResult(io, fail('artifacts.setup', 'INVALID_ARTIFACT_SETUP_STEP', `Invalid artifact setup step ${requestedStep}`, {}, ['Use one of: detect, configure, validate, complete']), options.json);
        process.exitCode = 1;
        return;
      }
      setup.step = requestedStep;
    }

    printResult(io, ok('artifacts.setup', setup), options.json);
  });
}
