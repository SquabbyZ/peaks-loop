/**
 * Slice rid-024 — `peaks code detect-job` + `peaks code read-job-shape`.
 *
 * Extracted from code-commands.ts (rid-024 split).
 * Owns: detect-job (write JobShapeDecision), read-job-shape (read+print).
 */

import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  readJobShapeDecision,
  writeJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED,
  JOB_SHAPE_ALREADY_DECIDED,
  type JobStrategy,
  type JobConfidence
} from '../../services/code/job-shape-decision.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';

export function registerCodeJobShapeCommands(code: Command, io: ProgramIO): void {
  // v3.1.1 Step 0.8 — Job-shape decision recorder.
  // The CLI is a *recorder*, not a judge. The LLM supplies the verdict
  // (--is-job, --rationale, --suggested-job-id, --suggested-strategy,
  // --confidence); the CLI validates the shape, stamps `decidedAt`
  // server-side, and writes to `.peaks/_runtime/<sessionId>/job-shape.json`.
  addJsonOption(
    code
      .command('detect-job')
      .description(
        'v3.1.1 Step 0.8: record the LLM\'s Job-shape judgement. CLI is a recorder, NOT a detector. ' +
          'Pass --is-job true|false, --rationale <text>, --suggested-job-id <slug>. ' +
          'Downstream steps call `peaks code read-job-shape` and refuse to proceed if missing.'
      )
      .requiredOption('--is-job <bool>', 'true | false (the LLM\'s semantic verdict)')
      .requiredOption('--rationale <text>', '1-3 sentences the LLM writes explaining the call')
      .requiredOption('--suggested-job-id <jid>', 'LLM-chosen stable id, slug-safe (/^[a-z0-9][a-z0-9-]{2,40}$/)')
      .option('--suggested-strategy <single|rotating>', 'single | rotating', 'single')
      .option('--confidence <high|medium|low>', 'high | medium | low', 'medium')
      .option('--force', 'overwrite an existing decision file')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--project <path>', 'target project root (default: findProjectRoot(cwd))')
      .option('--prompt <text>', 'override the prompt hashed into promptHash (default: read last-prompt.txt if present, else empty)')
  ).action(
    async (opts: {
      isJob: string;
      rationale: string;
      suggestedJobId: string;
      suggestedStrategy: string;
      confidence: string;
      force?: boolean;
      sessionId?: string;
      project?: string;
      prompt?: string;
      json?: boolean;
    }) => {
      try {
        if (opts.isJob !== 'true' && opts.isJob !== 'false') {
          printResult(
            io,
            fail('code.detect-job', 'INVALID_FLAG', `--is-job must be true | false (got "${opts.isJob}")`, { provided: opts.isJob }, ['Pass --is-job true or --is-job false']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        if (opts.suggestedStrategy !== 'single' && opts.suggestedStrategy !== 'rotating') {
          printResult(
            io,
            fail('code.detect-job', 'INVALID_FLAG', `--suggested-strategy must be single | rotating (got "${opts.suggestedStrategy}")`, { provided: opts.suggestedStrategy }, ['Pass --suggested-strategy single or --suggested-strategy rotating']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        if (opts.confidence !== 'high' && opts.confidence !== 'medium' && opts.confidence !== 'low') {
          printResult(
            io,
            fail('code.detect-job', 'INVALID_FLAG', `--confidence must be high | medium | low (got "${opts.confidence}")`, { provided: opts.confidence }, ['Pass --confidence high | medium | low']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const jidRe = /^[a-z0-9][a-z0-9-]{2,40}$/;
        if (!jidRe.test(opts.suggestedJobId)) {
          printResult(
            io,
            fail('code.detect-job', 'INVALID_FLAG', `--suggested-job-id must match /^[a-z0-9][a-z0-9-]{2,40}$/ (got "${opts.suggestedJobId}")`, { provided: opts.suggestedJobId }, ['Pass a slug-safe id (lowercase, digits, dashes; 3-41 chars)']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        const sessionId = opts.sessionId ?? readActiveSidForJobShape(projectRoot);
        if (sessionId === null) {
          printResult(
            io,
            fail('code.detect-job', 'NO_ACTIVE_SESSION', 'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-code`', null, ['Re-run with --session-id <sid>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        // Prompt source: explicit --prompt > last-prompt.txt > empty.
        let promptText = opts.prompt ?? '';
        if (opts.prompt === undefined) {
          const lastPromptPath = join(projectRoot, '.peaks', '_runtime', sessionId, 'txt', 'last-prompt.txt');
          if (existsSync(lastPromptPath)) {
            try {
              promptText = readFileSync(lastPromptPath, 'utf8');
            } catch { // TODO(g2): legacy silent catch — grace: 1 minor release
              promptText = '';
            }
          }
        }
        const record = writeJobShapeDecision(
          projectRoot,
          sessionId,
          {
            isJob: opts.isJob === 'true',
            rationale: opts.rationale,
            suggestedJobId: opts.suggestedJobId,
            suggestedStrategy: opts.suggestedStrategy as JobStrategy,
            confidence: opts.confidence as JobConfidence,
            prompt: promptText
          },
          { force: opts.force === true }
        );
        printResult(
          io,
          ok('code.detect-job', {
            sessionId: record.sessionId,
            promptHash: record.promptHash,
            decision: record.decision,
            schemaVersion: record.schemaVersion
          }, [], [
            `Decision recorded: isJob=${record.decision.isJob} strategy=${record.decision.suggestedStrategy} confidence=${record.decision.confidence}`,
            `File: .peaks/_runtime/${record.sessionId}/job-shape.json`
          ]),
          opts.json
        );
      } catch (err) {
        if (err instanceof JobShapeDecisionError) {
          const code = err.code === JOB_SHAPE_ALREADY_DECIDED ? JOB_SHAPE_ALREADY_DECIDED : err.code === JOB_SHAPE_NOT_DECIDED ? JOB_SHAPE_NOT_DECIDED : err.code;
          printResult(
            io,
            fail('code.detect-job', code, err.message, err.details ?? null, [
              err.code === JOB_SHAPE_ALREADY_DECIDED
                ? 'Re-run with --force to overwrite the existing decision.'
                : 'Re-run with valid flags.'
            ]),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail('code.detect-job', 'DETECT_JOB_FAILED', getErrorMessage(err), null, ['Verify the flags and try again']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  // v3.1.1 Step 0.8 — read-only validator. Downstream steps call this
  // to refuse to proceed if the LLM has not yet recorded a decision.
  addJsonOption(
    code
      .command('read-job-shape')
      .description(
        'v3.1.1 Step 0.8: return the recorded Job-shape decision. ' +
          'Returns JOB_SHAPE_NOT_DECIDED when the LLM has not yet recorded a verdict.'
      )
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--project <path>', 'target project root (default: findProjectRoot(cwd))')
  ).action(
    (opts: { sessionId?: string; project?: string; json?: boolean }) => {
      try {
        const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        const sessionId = opts.sessionId ?? readActiveSidForJobShape(projectRoot);
        if (sessionId === null) {
          printResult(
            io,
            fail('code.read-job-shape', 'NO_ACTIVE_SESSION', 'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-code`', null, ['Re-run with --session-id <sid>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const record = readJobShapeDecision(projectRoot, sessionId);
        printResult(
          io,
          ok('code.read-job-shape', {
            sessionId: record.sessionId,
            promptHash: record.promptHash,
            decision: record.decision,
            schemaVersion: record.schemaVersion
          }, [], [
            `Decision on file: isJob=${record.decision.isJob} strategy=${record.decision.suggestedStrategy} confidence=${record.decision.confidence}`
          ]),
          opts.json
        );
      } catch (err) {
        if (err instanceof JobShapeDecisionError) {
          printResult(
            io,
            fail('code.read-job-shape', err.code, err.message, err.details ?? null, [
              err.code === JOB_SHAPE_NOT_DECIDED
                ? 'Run `peaks code detect-job` to record a decision.'
                : 'Investigate the decision file integrity.'
            ]),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail('code.read-job-shape', 'READ_JOB_SHAPE_FAILED', getErrorMessage(err), null, ['Verify the project path and try again']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}

// Local helper (was `readActiveSid` in code-commands.ts before rid-024 split).
// Slice 4.0.7-dogfood-PR-2: now uses the shared canonical resolver
// (`resolveActiveSessionId` from services/session) so detect-job and
// read-job-shape see the same session id that `peaks session info --active`
// returns. The pre-rid helper read `getSkillPresence` (the
// `.peaks/.active-skill.json` file), which was a different store from
// `.peaks/_runtime/session.json` — any session created via
// `peaks workspace init` that never had `peaks skill presence:set peaks-code`
// called on it (the common case for downstream consumer projects and
// 24h-mode sessions) reported `NO_ACTIVE_SESSION` from this file.
import { resolveActiveSessionId } from '../../services/session/index.js';
function readActiveSidForJobShape(projectRoot: string): string | null {
  try {
    return resolveActiveSessionId(projectRoot);
  } catch {
    return null;
  }
}