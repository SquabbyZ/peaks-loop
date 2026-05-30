import { Command } from 'commander';
import { mkdirSync } from 'node:fs';
import { initSop, lintSop } from '../../services/sop/sop-service.js';
import { registerSop, readRegistry, SopRegisterError } from '../../services/sop/sop-registry-service.js';
import { checkGate, SopCheckError } from '../../services/sop/sop-check-service.js';
import { advanceSop, SopAdvanceError, SopGateBlockedError, SopPhaseSkipError } from '../../services/sop/sop-advance-service.js';
import { sopStateDir } from '../../services/sop/sop-paths.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';
import { recordBypass, isBypassLimitReached, MAX_BYPASSES_PER_SESSION } from '../../services/mode/bypass-tracker.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type SopInitCliOptions = {
  id: string;
  name?: string;
  apply?: boolean;
  json?: boolean;
};

type SopLintCliOptions = {
  id: string;
  allowCommands?: boolean;
  json?: boolean;
};

type SopRegisterCliOptions = {
  id: string;
  allowCommands?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

type SopCheckCliOptions = {
  id: string;
  gate: string;
  project: string;
  allowCommands?: boolean;
  json?: boolean;
};

type SopRegistryCliOptions = {
  json?: boolean;
};

type SopAdvanceCliOptions = {
  id: string;
  to: string;
  project: string;
  allowCommands?: boolean;
  allowIncomplete?: boolean;
  reason?: string;
  confirm?: boolean;
  forceConfirm?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

export function registerSopCommands(program: Command, io: ProgramIO): void {
  const sop = program.command('sop').description('Author and validate user-defined SOP skills');

  addJsonOption(
    sop
      .command('init')
      .description('Scaffold a user-authored SOP (manifest + SKILL.md) in ~/.peaks/sops; preview by default')
      .requiredOption('--id <sop-id>', 'SOP id (lowercase kebab, e.g. team-release)')
      .option('--name <name>', 'human-readable SOP name (defaults to the id)')
      .option('--apply', 'write the SOP files (default: preview only)')
  ).action(async (options: SopInitCliOptions) => {
    try {
      const initOptions: Parameters<typeof initSop>[0] = { id: options.id };
      if (options.name !== undefined) {
        initOptions.name = options.name;
      }
      if (options.apply === true) {
        initOptions.apply = true;
      }
      const result = await initSop(initOptions);
      // Side-effecting scaffold returns explicit next steps so the user doesn't
      // have to recall the runbook: applied → edit then lint; preview → apply.
      const nextActions = result.applied
        ? [
            `Edit ${result.manifestPath} to define your real phases and gates`,
            `peaks sop lint --id ${result.id} --json`
          ]
        : [`Re-run with --apply to write ${result.manifestPath}`];
      printResult(io, ok('sop.init', result, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('sop.init', 'SOP_INIT_FAILED', getErrorMessage(error), { id: options.id }, ['Check the SOP id before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    sop
      .command('lint')
      .description('Validate a SOP manifest (id namespace, phases, gate ids, check fields)')
      .requiredOption('--id <sop-id>', 'SOP id to lint')
      .option('--allow-commands', 'permit command-type gates (they run shell-less processes)')
  ).action(async (options: SopLintCliOptions) => {
    try {
      const lintOptions: Parameters<typeof lintSop>[0] = { id: options.id };
      if (options.allowCommands === true) {
        lintOptions.allowCommands = true;
      }
      const result = await lintSop(lintOptions);
      if (result === null) {
        printResult(
          io,
          fail('sop.lint', 'SOP_NOT_FOUND', `No SOP found for id "${options.id}"`, { id: options.id }, ['Run peaks sop init --id <sop-id> --apply first']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        result.ok
          ? ok('sop.lint', result)
          : fail('sop.lint', 'SOP_LINT_FAILED', `${result.findings.filter((f) => f.severity === 'error').length} lint error(s) in SOP "${options.id}"`, result, ['Fix the reported findings, then re-run peaks sop lint']),
        options.json
      );
      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('sop.lint', 'SOP_LINT_ERROR', getErrorMessage(error), { id: options.id }, ['Check the SOP id before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    sop
      .command('register')
      .description('Validate a SOP and record its gates in the global (~/.peaks) gate registry')
      .requiredOption('--id <sop-id>', 'SOP id to register')
      .option('--allow-commands', 'permit command-type gates when validating')
      .option('--dry-run', 'preview the registration without writing registry.json')
  ).action(async (options: SopRegisterCliOptions) => {
    try {
      const registerOptions: Parameters<typeof registerSop>[0] = { id: options.id };
      if (options.allowCommands === true) {
        registerOptions.allowCommands = true;
      }
      if (options.dryRun === true) {
        registerOptions.dryRun = true;
      }
      const result = await registerSop(registerOptions);
      printResult(io, ok('sop.register', result, [], result.applied ? [] : ['Re-run without --dry-run to write registry.json']), options.json);
    } catch (error) {
      const code = error instanceof SopRegisterError ? error.code : 'SOP_REGISTER_FAILED';
      printResult(
        io,
        fail('sop.register', code, getErrorMessage(error), { id: options.id }, ['Run peaks sop lint to see why the SOP is not registrable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    sop
      .command('registry')
      .description('List all registered SOPs and their gates from the global registry (read-only)')
  ).action(async (options: SopRegistryCliOptions) => {
    try {
      const registry = await readRegistry();
      printResult(io, ok('sop.registry', registry), options.json);
    } catch (error) {
      printResult(
        io,
        fail('sop.registry', 'SOP_REGISTRY_FAILED', getErrorMessage(error), {}, ['The global registry may be corrupted; inspect ~/.peaks/sops/registry.json']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    sop
      .command('check')
      .description('Evaluate a single SOP gate (returns pass / fail / blocked)')
      .requiredOption('--id <sop-id>', 'SOP id')
      .requiredOption('--gate <gate-id>', 'gate id within the SOP')
      .option('--project <path>', 'project the gate evaluates against (default: current directory)', '.')
      .option('--allow-commands', 'permit evaluating command-type gates')
  ).action(async (options: SopCheckCliOptions) => {
    try {
      const checkOptions: Parameters<typeof checkGate>[0] = { projectRoot: options.project, id: options.id, gateId: options.gate };
      if (options.allowCommands === true) {
        checkOptions.allowCommands = true;
      }
      const result = await checkGate(checkOptions);
      printResult(io, ok('sop.check', result), options.json);
    } catch (error) {
      const code = error instanceof SopCheckError ? error.code : 'SOP_CHECK_FAILED';
      printResult(
        io,
        fail('sop.check', code, getErrorMessage(error), { id: options.id, gateId: options.gate }, ['Verify the SOP id and gate id with peaks sop lint']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    sop
      .command('advance')
      .description('Advance a SOP to a phase; gates guarding that phase must pass (or be explicitly bypassed)')
      .requiredOption('--id <sop-id>', 'SOP id')
      .requiredOption('--to <phase>', 'phase to advance into')
      .option('--project <path>', 'project whose run-state advances (default: current directory)', '.')
      .option('--allow-commands', 'permit evaluating command-type gates')
      .option('--allow-incomplete', 'bypass the phase gates AND phase-order check (requires --reason)')
      .option('--reason <text>', 'justification recorded when bypassing gates')
      .option('--confirm', 'skip interactive confirmation for a bypass in assisted/strict mode')
      .option('--force-confirm', 'bypass mode-enforced confirmation (use with caution)')
      .option('--dry-run', 'evaluate gates without recording the advance in state.json')
  ).action(async (options: SopAdvanceCliOptions) => {
    try {
      // Bypass policy mirrors `request transition`: a bypass needs a reason, and
      // in assisted/strict mode (resolved from the target project) it needs an
      // explicit --confirm and counts against the per-SOP bypass cap.
      if (options.allowIncomplete === true && (options.reason === undefined || options.reason.trim().length === 0)) {
        printResult(io, fail('sop.advance', 'BYPASS_REASON_REQUIRED', '--allow-incomplete requires --reason explaining why the gates are skipped', { id: options.id, to: options.to }, ['Add --reason "<short justification>" or satisfy the gates']), options.json);
        process.exitCode = 1;
        return;
      }
      if (options.allowIncomplete === true && options.forceConfirm !== true) {
        const presence = getSkillPresence(options.project);
        if (presence?.mode === 'assisted' || presence?.mode === 'strict') {
          if (options.confirm !== true) {
            printResult(io, fail('sop.advance', 'ALLOW_INCOMPLETE_RESTRICTED', `--allow-incomplete requires --confirm in ${presence.mode} mode`, { id: options.id, mode: presence.mode }, ['Add --confirm to bypass non-interactively']), options.json);
            process.exitCode = 1;
            return;
          }
          // The bypass counter is keyed to the per-project SOP run-state dir (not
          // a session); the shared cap constant is reused. Keying it per-project
          // means a bypass in one project never consumes another project's budget.
          const bypassRoot = sopStateDir(options.project, options.id);
          // The per-project state dir may not exist yet (no successful advance has
          // written state.json), so ensure it before the counter writes its file.
          mkdirSync(bypassRoot, { recursive: true });
          if (isBypassLimitReached(bypassRoot)) {
            printResult(io, fail('sop.advance', 'BYPASS_LIMIT_REACHED', `gate bypass limit reached (${MAX_BYPASSES_PER_SESSION} bypasses per SOP)`, { id: options.id, limit: MAX_BYPASSES_PER_SESSION }, ['Satisfy the gates instead of bypassing']), options.json);
            process.exitCode = 1;
            return;
          }
          // A dry-run preview must not consume a bypass.
          if (options.dryRun !== true) {
            recordBypass(bypassRoot);
          }
        }
      }

      const advanceOptions: Parameters<typeof advanceSop>[0] = { projectRoot: options.project, id: options.id, toPhase: options.to };
      if (options.allowCommands === true) advanceOptions.allowCommands = true;
      if (options.allowIncomplete === true) advanceOptions.allowIncomplete = true;
      if (options.reason !== undefined) advanceOptions.reason = options.reason;
      if (options.dryRun === true) advanceOptions.dryRun = true;
      const result = await advanceSop(advanceOptions);
      printResult(io, ok('sop.advance', result, [], result.applied ? [] : ['Gates passed; re-run without --dry-run to record the advance']), options.json);
    } catch (error) {
      if (error instanceof SopGateBlockedError) {
        printResult(io, fail('sop.advance', error.code, error.message, { id: options.id, to: options.to, blockedGates: error.blockedGates }, ['Satisfy the blocking gates, or bypass with --allow-incomplete --reason "<why>"']), options.json);
        process.exitCode = 1;
        return;
      }
      if (error instanceof SopPhaseSkipError) {
        printResult(io, fail('sop.advance', error.code, error.message, { id: options.id, to: options.to, fromPhase: error.fromPhase, expectedNext: error.expectedNext }, [`Advance to "${error.expectedNext}" first, or bypass with --allow-incomplete --reason "<why>"`]), options.json);
        process.exitCode = 1;
        return;
      }
      const code = error instanceof SopAdvanceError ? error.code : 'SOP_ADVANCE_FAILED';
      printResult(io, fail('sop.advance', code, getErrorMessage(error), { id: options.id, to: options.to }, ['Verify the SOP id and phase with peaks sop lint']), options.json);
      process.exitCode = 1;
    }
  });
}
