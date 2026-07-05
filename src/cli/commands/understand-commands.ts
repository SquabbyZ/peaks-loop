import { Command, InvalidArgumentError } from 'commander';
import { scanUnderstandAnything, summarizeKnowledgeGraph } from '../../services/understand/understand-scan-service.js';
import { buildUnderstandContext } from '../../services/understand/understand-hybrid-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { UaOptInPrompt } from '../../services/understand/understand-types.js';

type UnderstandStatusOptions = {
  project: string;
  artifactDir?: string;
  json?: boolean;
};

type UnderstandShowOptions = {
  project: string;
  artifactDir?: string;
  sample?: number;
  json?: boolean;
};

type UnderstandContextOptions = {
  project: string;
  artifactDir?: string;
  sample?: number;
  files?: string[];
  json?: boolean;
};

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

const INSTALL_HINT = 'Install Understand Anything in Claude Code: `/plugin marketplace add Lum1104/Understand-Anything` then `/plugin install understand-anything`, then run `/understand` in the target project to generate .understand-anything/knowledge-graph.json.';

export function registerUnderstandCommands(program: Command, io: ProgramIO): void {
  const understand = program.command('understand').description('Inspect Understand Anything artifacts inside a project (read-only)');

  addJsonOption(
    understand
      .command('status')
      .description('Report whether Understand Anything has produced a knowledge graph in the target project')
      .requiredOption('--project <path>', 'target project root')
      .option('--artifact-dir <path>', 'override the default .understand-anything directory')
  ).action(async (options: UnderstandStatusOptions) => {
    try {
      const scanOptions: Parameters<typeof scanUnderstandAnything>[0] = { projectRoot: options.project };
      if (options.artifactDir !== undefined) {
        scanOptions.artifactDir = options.artifactDir;
      }
      const report = await scanUnderstandAnything(scanOptions);
      const nextActions: string[] = [];
      if (!report.exists) {
        nextActions.push(INSTALL_HINT);
      } else if (!report.graph.exists) {
        nextActions.push('Run `/understand` inside Claude Code on this project to generate .understand-anything/knowledge-graph.json.');
      } else if (report.graph.parseError !== undefined) {
        nextActions.push('Re-run `/understand` to regenerate the knowledge graph; the current file is not valid JSON.');
      }
      printResult(io, ok('understand.status', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('understand.status', 'UNDERSTAND_STATUS_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .understand-anything directory before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    understand
      .command('show')
      .description('Summarize the Understand Anything knowledge graph (counts, layers, tours, sample nodes) for RD/TXT consumption')
      .requiredOption('--project <path>', 'target project root')
      .option('--artifact-dir <path>', 'override the default .understand-anything directory')
      .option('--sample <n>', 'maximum number of sample node ids to return (default 5)', parsePositiveInteger)
  ).action(async (options: UnderstandShowOptions) => {
    try {
      const summaryOptions: Parameters<typeof summarizeKnowledgeGraph>[0] = { projectRoot: options.project };
      if (options.artifactDir !== undefined) {
        summaryOptions.artifactDir = options.artifactDir;
      }
      if (options.sample !== undefined) {
        summaryOptions.sampleSize = options.sample;
      }
      const summary = await summarizeKnowledgeGraph(summaryOptions);
      if (!summary.exists) {
        printResult(
          io,
          fail('understand.show', 'UNDERSTAND_GRAPH_MISSING', `No knowledge graph found at ${summary.path}`, summary, [INSTALL_HINT]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (summary.parseError !== undefined) {
        printResult(
          io,
          fail('understand.show', 'UNDERSTAND_GRAPH_PARSE_ERROR', `Knowledge graph at ${summary.path} is not valid JSON: ${summary.parseError}`, summary, ['Re-run `/understand` to regenerate the knowledge graph']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('understand.show', summary), options.json);
    } catch (error) {
      printResult(
        io,
        fail('understand.show', 'UNDERSTAND_SHOW_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .understand-anything directory before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // L3.1: opt-in UX subcommand. Returns the AskUserQuestion payload that
  // the LLM-side UX layer (peaks-code / peaks-ide) should surface when
  // uaPrompt === 'unset' and UA is absent. When uaPrompt is skip-this-session
  // or skip-forever, returns a no-op envelope (caller does not prompt).
  addJsonOption(
    understand
      .command('opt-in')
      .description('Returns the UA opt-in prompt payload (Slice L3.1) when uaPrompt is unset; no-op otherwise')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: UnderstandStatusOptions) => {
    try {
      const report = await scanUnderstandAnything({ projectRoot: options.project });
      const uaPrompt = report.uaPrompt ?? 'unset';
      if (report.exists || uaPrompt !== 'unset') {
        // No prompt needed: UA is installed OR user already decided.
        printResult(
          io,
          ok('understand.opt-in', { promptNeeded: false, uaPrompt, uaInstalled: report.exists }),
          options.json
        );
        return;
      }
      const prompt: UaOptInPrompt = {
        version: 1,
        tool: 'ua-opt-in',
        artifactDir: report.artifactDir,
        reason: 'ua-artifact-missing',
        options: [
          { id: 'install', label: 'Install UA in Claude Code', description: INSTALL_HINT },
          { id: 'fallback-this-session', label: 'Use codegraph fallback this session', description: 'Skip UA this run; do not write preferences.json' },
          { id: 'fallback-forever', label: 'Use codegraph fallback forever', description: 'Write preferences.json:uaPrompt=skip-forever; suppress future prompts' }
        ]
      };
      printResult(io, ok('understand.opt-in', { promptNeeded: true, uaPrompt, uaInstalled: false, prompt }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('understand.opt-in', 'UNDERSTAND_OPTIN_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice 2026-07-02-codegraph-ua-hybrid: hybrid context subcommand.
  // Routes UA-first / codegraph-fallback / hybrid in the service layer;
  // the CLI is a thin shell that surfaces the envelope and exit code.
  addJsonOption(
    understand
      .command('context')
      .description('Build a hybrid project-context envelope: UA knowledge graph when present, codegraph affected as fallback, or both in parallel')
      .requiredOption('--project <path>', 'target project root')
      .option('--artifact-dir <path>', 'override the default .understand-anything directory')
      .option('--sample <n>', 'maximum number of sample node ids to include (default 5)', parsePositiveInteger)
      .option('--files <file...>', 'file globs to feed `codegraph affected` (default: src/index.ts, package.json, README.md)')
  ).action(async (options: UnderstandContextOptions) => {
    try {
      const ctxOptions: Parameters<typeof buildUnderstandContext>[0] = { projectRoot: options.project };
      if (options.artifactDir !== undefined) ctxOptions.artifactDir = options.artifactDir;
      if (options.sample !== undefined) ctxOptions.sampleSize = options.sample;
      if (options.files !== undefined) ctxOptions.files = options.files;
      const result = await buildUnderstandContext(ctxOptions);
      const exitCode = result.source === 'both-missing' ? 2 : 0;
      if (exitCode !== 0) {
        printResult(
          io,
          fail('understand.context', 'UNDERSTAND_CONTEXT_NO_EVIDENCE', `No UA graph and codegraph affected produced no usable evidence`, result, [
            INSTALL_HINT,
            'Run `peaks codegraph index` in this project to populate the codegraph index, then retry'
          ]),
          options.json
        );
        process.exitCode = exitCode;
        return;
      }
      printResult(io, ok('understand.context', result, [], result.warnings.length > 0 ? result.warnings : undefined), options.json);
    } catch (error) {
      printResult(
        io,
        fail('understand.context', 'UNDERSTAND_CONTEXT_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and codegraph installation before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
