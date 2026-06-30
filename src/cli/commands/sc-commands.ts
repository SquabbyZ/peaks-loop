import { Command } from 'commander';
import { createArtifactRetentionReport, createChangeImpact, getChangeTraceabilityStatus, getScHelpText, recordCommitBoundary, validateArtifactRetention } from '../../services/sc/sc-service.js';
import { ok } from '../../shared/result.js';
import { addJsonOption, multipleOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerSCCommands(program: Command, io: ProgramIO): void {
  const sc = program.command('sc').description('Source control and change traceability (peaks-sc integration)');
  registerSCStatusCommands(sc, io);
  registerSCArtifactCommands(sc, io);
}

function registerSCStatusCommands(sc: Command, io: ProgramIO): void {
  addJsonOption(sc.command('status').description('Show change traceability status')).action((options: { json?: boolean }) => {
    printResult(io, ok('sc.status', getChangeTraceabilityStatus()), options.json);
  });

  addJsonOption(sc.command('help').description('Show peaks-sc help text')).action((options: { json?: boolean }) => {
    const helpText = getScHelpText().join('\n');
    if (options.json) {
      printResult(io, ok('sc.help', { helpText }), options.json);
    } else {
      io.stdout(helpText);
    }
  });
}

function registerSCArtifactCommands(sc: Command, io: ProgramIO): void {
  // Slice 2026-06-29-change-id-root-removal: `--change-id` is no
  // longer accepted on `peaks sc impact`. The CLI surfaces a
  // per-`(module, file)` impact report without a top-level
  // change-id binding.
  addJsonOption(sc.command('impact').description('Generate change impact artifact').option('--module <module>', 'affected module', multipleOption).option('--file <file>', 'affected file', multipleOption)).action((options: { module?: string[]; file?: string[]; json?: boolean }) => {
    const impactOptions: { sessionId: string; sourceArtifacts?: string[]; affectedModules?: string[]; affectedFiles?: string[] } = {
      sessionId: '',
      ...(options.module ? { affectedModules: options.module } : {}),
      ...(options.file ? { affectedFiles: options.file } : {})
    };
    printResult(io, ok('sc.impact', createChangeImpact(impactOptions)), options.json);
  });

  addJsonOption(sc.command('retention').description('Create artifact retention report').requiredOption('--slice-id <id>', 'slice identifier').option('--prd <artifact>', 'PRD artifact path', multipleOption).option('--rd <artifact>', 'RD artifact path', multipleOption).option('--qa <artifact>', 'QA artifact path', multipleOption).option('--coverage <artifact>', 'coverage artifact path', multipleOption).option('--review <artifact>', 'review artifact path', multipleOption).option('--code <file>', 'code file path', multipleOption)).action((options: { sliceId: string; prd?: string[]; rd?: string[]; qa?: string[]; coverage?: string[]; review?: string[]; code?: string[]; json?: boolean }) => {
    printResult(io, ok('sc.retention', createArtifactRetentionReport({ sliceId: options.sliceId, ...(options.prd ? { prdArtifacts: options.prd } : {}), ...(options.rd ? { rdArtifacts: options.rd } : {}), ...(options.qa ? { qaArtifacts: options.qa } : {}), ...(options.coverage ? { coverageArtifacts: options.coverage } : {}), ...(options.review ? { reviewArtifacts: options.review } : {}), ...(options.code ? { codeChanges: options.code } : {}) })), options.json);
  });

  addJsonOption(sc.command('validate').description('Validate artifact retention for a slice').requiredOption('--slice-id <id>', 'slice identifier')).action((options: { sliceId: string; json?: boolean }) => {
    printResult(io, ok('sc.validate', validateArtifactRetention(options.sliceId)), options.json);
  });

  addJsonOption(sc.command('boundary').description('Record retention boundary for a slice').requiredOption('--slice-id <id>', 'slice identifier').option('--artifact <path>', 'artifact path', multipleOption).option('--code <file>', 'code file path', multipleOption)).action((options: { sliceId: string; artifact?: string[]; code?: string[]; json?: boolean }) => {
    printResult(io, ok('sc.boundary', recordCommitBoundary({ sliceId: options.sliceId, ...(options.artifact ? { artifacts: options.artifact } : {}), ...(options.code ? { codeFiles: options.code } : {}) })), options.json);
  });
}
