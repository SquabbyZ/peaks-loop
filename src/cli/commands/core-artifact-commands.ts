import { Command } from 'commander';
import { createArtifactInitPlan, getArtifactStatus, createGuidedArtifactSetup } from '../../services/artifacts/artifact-service.js';
import { getArtifactWorkspaceStatus, planArtifactSync } from '../../services/artifacts/workspace-service.js';
import { executeProjectMemoryBackup, executeProjectMemoryExtract, summarizeProjectMemoryBackupResult, summarizeProjectMemoryExtractResult } from '../../services/memory/project-memory-service.js';
import { executeProjectStandardsInit, executeProjectStandardsUpdate, summarizeProjectStandardsInitResult, summarizeProjectStandardsUpdateResult } from '../../services/standards/project-standards-service.js';
import { listProfiles } from '../../services/profiles/profile-service.js';
import { planProxyTest } from '../../services/proxy/proxy-service.js';
import { runDoctor } from '../../services/doctor/doctor-service.js';
import { listSkills } from '../../services/skills/skill-registry.js';
import { inspectSkillRunbook } from '../../services/skills/skill-runbook-service.js';
import { setSkillPresence, clearSkillPresence, getSkillPresence, isSkillPresenceMode, touchSkillHeartbeat } from '../../services/skills/skill-presence-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, isArtifactProvider, isArtifactSetupStep, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerCoreAndArtifactCommands(program: Command, io: ProgramIO): void {
  addJsonOption(program.command('doctor').description('Run repository doctor checks')).action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    const result = report.summary.ok
      ? ok('doctor', report)
      : fail('doctor', 'DOCTOR_FAILED', 'One or more doctor checks failed', report, ['Fix failed checks and rerun peaks doctor']);
    printResult(io, result, options.json);
    if (!report.summary.ok) {
      process.exitCode = 1;
    }
  });

  const skill = program.command('skill').description('Manage Peaks skills');
  addJsonOption(skill.command('list').description('List skills derived from skills/*/SKILL.md')).action(async (options: { json?: boolean }) => {
    const skills = await listSkills();
    printResult(io, ok('skill.list', { skills }), options.json);
  });
  addJsonOption(skill.command('doctor').description('Run skill-related doctor checks')).action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    const skillChecks = report.checks.filter((check) => check.id.startsWith('skill'));
    const failed = skillChecks.filter((check) => !check.ok).length;
    printResult(io, ok('skill.doctor', { checks: skillChecks, ok: failed === 0 }), options.json);
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
  ).action((name: string, options: { mode?: string; gate?: string; json?: boolean }) => {
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
    const presence = setSkillPresence(name, options.mode, options.gate);
    printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
  });

  addJsonOption(
    skill
      .command('presence:clear')
      .description('Clear the active Peaks skill presence indicator')
  ).action((options: { json?: boolean }) => {
    const removed = clearSkillPresence();
    printResult(io, ok('skill.presence:clear', { active: false, removed }), options.json);
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
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write missing standards into the target project')
  ).action((options: { project: string; language?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.init', 'INVALID_STANDARDS_INIT_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsInit({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), apply: options.apply === true });
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
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'append managed metadata to the target project')
  ).action((options: { project: string; language?: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('standards.update', 'INVALID_STANDARDS_UPDATE_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview writes, or omit --dry-run when applying standards updates']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const result = executeProjectStandardsUpdate({ projectRoot: options.project, ...(options.language !== undefined ? { language: options.language } : {}), apply: options.apply === true });
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
      .description('Extract stable project memory from skill artifacts into project .claude/memory')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--artifact <path...>', 'skill artifact paths inside the project')
      .option('--dry-run', 'preview writes without changing files', true)
      .option('--apply', 'write extracted memories into project .claude/memory')
  ).action((options: { project: string; artifact: string[]; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
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
      .description('Back up project .claude/memory into the artifact workspace')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--workspace <path>', 'artifact workspace path')
      .option('--dry-run', 'preview copies without changing files', true)
      .option('--apply', 'copy project .claude/memory into artifact workspace backup')
  ).action((options: { project: string; workspace: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
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
