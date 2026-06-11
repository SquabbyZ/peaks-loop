/**
 * peaks loop * CLI (Slice #14) — L4 Agent Loop Integration.
 *
 * Per docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §5.4
 * Slice #14, ships 5 sub-features:
 *
 *   14.1 peaks loop distill          — extract patterns from past sessions
 *                                       (delegates to peaks memory extract)
 *   14.2 peaks loop preflight        — pre-run sanity checks (placeholder)
 *   14.3 peaks loop detect-pattern   — find repeating patterns (placeholder)
 *   14.4 peaks loop check-consistency — verify state consistency (placeholder)
 *   14.5 peaks goal compose          — autonomous goal composition (placeholder;
 *                                       requires IDE adapter goalCommand capability
 *                                       per Slice #0.7)
 *
 * The 4 placeholders emit a clear nextActions list; the LLM-side UX
 * layer composes the actual runtime today.
 */

import { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

type LoopDistillOptions = {
  project: string;
  apply: boolean;
  json?: boolean;
};

type LoopPreflightOptions = {
  project: string;
  json?: boolean;
};

type LoopDetectPatternOptions = {
  project: string;
  json?: boolean;
};

type LoopCheckConsistencyOptions = {
  project: string;
  json?: boolean;
};

type GoalComposeOptions = {
  project: string;
  goal: string;
  json?: boolean;
};

export function registerLoopCommands(program: Command, io: ProgramIO): void {
  // 14.5 peaks goal compose — registered as a TOP-LEVEL command (not under
  // `peaks loop`) because IDE adapters expose it as `goalCommand`.
  // The sub-agent dispatch path consumes it; the slice 0.7 hermes +
  // openclaw adapters will thread it through.
  addJsonOption(
    program
      .command('goal')
      .description('14.5: compose an autonomous goal (returns the goal envelope that the LLM-side UX layer feeds to peaks sub-agent dispatch)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--goal <text>', 'the high-level goal to compose')
  ).action(async (options: GoalComposeOptions) => {
    try {
      printResult(io, ok('goal.compose', {
        project: options.project,
        goal: options.goal,
        status: 'placeholder',
        nextSteps: [
          'The composed goal is consumed by peaks sub-agent dispatch.',
          'The hermes + openclaw IDE adapters (Slice #0.7) surface this as a goalCommand.',
        ],
      }, [], [
        'goal.compose is a thin facade; the LLM-side UX layer decomposes the goal into sub-agent tasks.',
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('goal.compose', 'GOAL_COMPOSE_FAILED', getErrorMessage(error), { project: options.project, goal: options.goal }, ['Verify the project path and --goal value']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // peaks loop *
  const loop = program.command('loop').description('Slice #14: L4 Agent Loop sub-features (distill / preflight / detect-pattern / check-consistency)');

  // 14.1 distill
  addJsonOption(
    loop.command('distill')
      .description('14.1: distill patterns from past sessions into .peaks/memory/ (delegates to peaks memory extract)')
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'write extracted memories to .peaks/memory/ (default: dry-run preview)', false)
  ).action(async (options: LoopDistillOptions) => {
    try {
      const apply = options.apply === true;
      // Delegate to the existing peaks memory extract CLI via dynamic
      // import (avoids circular); the LLM-side UX layer composes the
      // two commands.
      const { execFileSync } = await import('node:child_process') as typeof import('node:child_process');
      const args = ['memory', 'extract', '--project', options.project];
      if (apply) args.push('--apply');
      const stdout = execFileSync('node', ['bin/peaks.js', ...args], {
        cwd: options.project,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString('utf-8');
      printResult(io, ok('loop.distill', {
        project: options.project,
        apply,
        delegateStdout: stdout.slice(0, 200),
      }, [], [
        apply ? 'peaks memory extract --apply was invoked' : 'peaks memory extract dry-run was invoked',
        'A future slice will inline the memory extract (not via execFileSync).',
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('loop.distill', 'LOOP_DISTILL_FAILED', getErrorMessage(error), { project: options.project }, ['Verify the project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // 14.2 preflight
  addJsonOption(
    loop.command('preflight')
      .description('14.2: pre-run sanity checks (placeholder; future slice runs peaks doctor + peaks audit before each loop iter)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopPreflightOptions) => {
    printResult(io, ok('loop.preflight', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'For each L4 loop iteration, call peaks doctor + peaks audit to surface regressions.',
        'A future slice will inline the preflight checks (not just placeholder).',
      ],
    }, [], [
      'loop.preflight is a thin facade; the LLM-side UX layer composes peaks doctor + peaks audit.',
    ]), options.json);
  });

  // 14.3 detect-pattern
  addJsonOption(
    loop.command('detect-pattern')
      .description('14.3: detect repeating patterns across past sessions (placeholder; future slice uses peaks retrospective search)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopDetectPatternOptions) => {
    printResult(io, ok('loop.detect-pattern', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'Run peaks retrospective search --limit 50 to surface high-frequency patterns.',
        'A future slice will rank by frequency + LLM confidence.',
      ],
    }, [], [
      'loop.detect-pattern is a thin facade; the LLM-side UX layer composes peaks retrospective search.',
    ]), options.json);
  });

  // 14.4 check-consistency
  addJsonOption(
    loop.command('check-consistency')
      .description('14.4: verify state consistency (placeholder; future slice compares .peaks/_runtime across sessions)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopCheckConsistencyOptions) => {
    printResult(io, ok('loop.check-consistency', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'Compare .peaks/_runtime/<sid>/session.json across recent sessions for drift.',
        'A future slice will report drift with severity (warn / fail).',
      ],
    }, [], [
      'loop.check-consistency is a thin facade; the LLM-side UX layer composes the drift scan.',
    ]), options.json);
  });
}
