import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  formatMainSessionTriggerLogLine,
  pickMainSessionTrigger
} from '../../services/context/main-session-monitor.js';
import { emitObservabilityEvent } from '../../services/observability/observability-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import {
  capacityOf,
  requirePromptSize,
  type ContextThresholdOptions
} from './context-status-command.js';

type MainSessionTrigger = ReturnType<typeof pickMainSessionTrigger>;

/** The `--in-flight-batch` seam: a sub-agent batch defers the trigger (D6.e). */
function inFlightOf(opts: ContextThresholdOptions) {
  return opts.inFlightBatch === true
    ? { hasInFlightBatch: true, sharedChannelEntries: 1 }
    : undefined;
}

/**
 * Observability hook #5/7. Fire-and-forget per PRD Q4; the synchronous emit
 * never throws. Only fires when a session id is resolvable.
 */
function emitContextTrigger(trigger: MainSessionTrigger, promptSize: number): void {
  const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  const sid = getSessionIdCanonical(projectRoot) ?? '';
  if (sid.length === 0) return;
  emitObservabilityEvent(
    {
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: sid,
      category: 'context-trigger',
      detail: {
        kind: trigger.kind,
        promptSize,
        ...(trigger.kind === 'soft-warn' || trigger.kind === 'compact'
          ? { ratio: trigger.ratio }
          : {})
      }
    },
    { projectRoot }
  );
}

/** The single advisory line the tier decides. */
function triggerAdvice(trigger: MainSessionTrigger): string {
  if (trigger.kind === 'compact') {
    return `Tier reached → trigger ${trigger.path} on ${trigger.ide} (code=${trigger.code})`;
  }
  if (trigger.kind === 'defer') return `Deferred: ${trigger.reason}`;
  if (trigger.kind === 'soft-warn') {
    return `Soft warning at ${(trigger.ratio * 100).toFixed(0)}% (no trigger yet)`;
  }
  return 'Below threshold; no trigger';
}

export function registerContextCheckCommand(context: Command, io: ProgramIO): void {
  addJsonOption(
    context
      .command('check')
      .description(
        'v2.11.0 D6: threshold check + IDE-aware trigger dispatch. With --auto-trigger, returns the trigger path the LLM should follow; without, returns a dry-run recommendation. The LLM is responsible for actually invoking the trigger (slash command, self-compress, or escalation).'
      )
      .requiredOption('--prompt-size <bytes>', 'estimated prompt size in bytes')
      .option('--capacity <bytes>', 'override the 256K default capacity (test seam)', '262144')
      .option('--in-flight-batch', 'a sub-agent batch is in flight (defer trigger per D6.e)', false)
      .option('--auto-trigger', 'return the trigger path the LLM should follow', false)
  ).action((opts: ContextThresholdOptions) => {
    try {
      const promptSize = requirePromptSize('context.check', opts, io);
      if (promptSize === null) return;
      const trigger = pickMainSessionTrigger({
        promptSize,
        capacityBytes: capacityOf(opts),
        inFlightBatch: inFlightOf(opts)
      });
      emitContextTrigger(trigger, promptSize);
      const payload = {
        ...trigger,
        autoTrigger: opts.autoTrigger === true,
        logLine: formatMainSessionTriggerLogLine(trigger, 'main')
      };
      printResult(io, ok('context.check', payload, [], [triggerAdvice(trigger)]), opts.json);
    } catch (err) {
      printResult(
        io,
        fail('context.check', 'CONTEXT_CHECK_FAILED', getErrorMessage(err), null, [
          'Verify --prompt-size is a non-negative number'
        ]),
        opts.json
      );
      process.exitCode = 1;
    }
  });
}
