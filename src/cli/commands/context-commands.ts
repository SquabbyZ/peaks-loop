/**
 * peaks context * CLI (Slice #3 L1c) — context 4-layer loader.
 *
 * Per docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §4 L1c:
 *   - L0: full read (every SKILL.md in full)
 *   - L1: summary (one paragraph per skill + the skill list)
 *   - L2: index (just names + paths)
 *   - L3: fuzzy search by query (delegates to peaks memory search)
 *
 * The LLM-side UX layer (peaks-solo / peaks-ide) picks the layer based
 * on the L1a task level:
 *   - typo:     L0 only (a few lines)
 *   - bug:     L0 + L1
 *   - feature: L0 + L1 + L2 + L3(按需)
 *   - refactor: L0 + L1 + L2 + L3
 *   - migration: L0 + L1 + L2 + L3 + codegraph
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { searchMemory, loadMemoryIndex } from '../../services/memory/memory-search-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { emitObservabilityEvent } from '../../services/observability/observability-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import {
  evaluateMainSessionThreshold,
  pickMainSessionTrigger,
  formatMainSessionTriggerLogLine,
  detectIdeFromEnv
} from '../../services/context/main-session-monitor.js';

export type ContextLayer = 'L0' | 'L1' | 'L2' | 'L3';

const SKILLS_DIR = 'skills';

type LayerOptions = {
  project: string;
  query?: string;
  json?: boolean;
};

interface LayerPayload {
  readonly layer: ContextLayer;
  readonly description: string;
  readonly files: readonly { path: string; bytes: number }[];
  readonly content: string;
  readonly byteSize: number;
  readonly warnings: readonly string[];
}

function readSkillsDir(projectRoot: string): readonly string[] {
  const skillsRoot = join(projectRoot, SKILLS_DIR);
  if (!existsSync(skillsRoot)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = join(skillsRoot, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) {
      out.push(`skills/${entry.name}/SKILL.md`);
    }
  }
  return out;
}

function readSkillFile(projectRoot: string, relPath: string): string {
  const abs = join(projectRoot, relPath);
  try {
    return readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}

async function fetchL0(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const warnings: string[] = [];
  let content = '';
  let byteSize = 0;
  const sizes: { path: string; bytes: number }[] = [];
  for (const rel of files) {
    const body = readSkillFile(projectRoot, rel);
    if (body.length === 0) {
      warnings.push(`failed to read ${rel}`);
      continue;
    }
    content += `## ${rel}\n\n${body}\n\n`;
    sizes.push({ path: rel, bytes: body.length });
    byteSize += body.length;
  }
  return { layer: 'L0', description: 'full read: every SKILL.md concatenated', files: sizes, content, byteSize, warnings };
}

async function fetchL1(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const warnings: string[] = [];
  let content = '';
  let byteSize = 0;
  const sizes: { path: string; bytes: number }[] = [];
  for (const rel of files) {
    const body = readSkillFile(projectRoot, rel);
    if (body.length === 0) {
      warnings.push(`failed to read ${rel}`);
      continue;
    }
    const firstPara = body.split(/\r?\n\r?\n/, 2)[0] ?? body.slice(0, 400);
    content += `## ${rel}\n\n${firstPara}\n\n`;
    sizes.push({ path: rel, bytes: firstPara.length });
    byteSize += firstPara.length;
  }
  return { layer: 'L1', description: 'summary: first paragraph per skill', files: sizes, content, byteSize, warnings };
}

async function fetchL2(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const content = files.map((f) => `- ${f}`).join('\n') + '\n';
  const byteSize = content.length;
  return {
    layer: 'L2',
    description: 'index: skill paths only (no body)',
    files: files.map((f) => ({ path: f, bytes: 0 })),
    content,
    byteSize,
    warnings: [],
  };
}

async function fetchL3(projectRoot: string, query: string): Promise<LayerPayload> {
  const warnings: string[] = [];
  if (query.trim().length === 0) {
    warnings.push('empty query; L3 requires a --query string for fuzzy search');
    return { layer: 'L3', description: 'fuzzy search (empty query)', files: [], content: '', byteSize: 0, warnings };
  }
  try {
    const hits = searchMemory({ projectRoot, query, limit: 10 });
    const lines: string[] = [];
    for (const hit of hits) {
      lines.push(`- [${hit.score.toFixed(2)}] ${hit.sourcePath}: ${hit.description.slice(0, 120)}`);
    }
    const content = lines.join('\n') + '\n';
    return {
      layer: 'L3',
      description: 'fuzzy search: top 10 hits from memory index',
      files: hits.map((h) => ({ path: h.sourcePath, bytes: h.description.length })),
      content,
      byteSize: content.length,
      warnings,
    };
  } catch (error) {
    return {
      layer: 'L3',
      description: 'fuzzy search (failed)',
      files: [],
      content: '',
      byteSize: 0,
      warnings: [`L3 search failed: ${getErrorMessage(error)}`],
    };
  }
}

export function registerContextCommands(program: Command, io: ProgramIO): void {
  const context = program
    .command('context')
    .description('Slice L1c: context 4-layer loader (L0 full / L1 summary / L2 index / L3 fuzzy)');

  addJsonOption(
    context
      .command('layer')
      .description('Fetch a context layer (L0 = full SKILL.md; L1 = first paragraph; L2 = index; L3 = fuzzy search by --query)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--level <L0|L1|L2|L3>', 'context layer to load')
      .option('--query <text>', 'fuzzy search query (required for L3)')
  ).action(async (options: LayerOptions) => {
    try {
      const level = (options as unknown as { level: string }).level;
      if (level !== 'L0' && level !== 'L1' && level !== 'L2' && level !== 'L3') {
        printResult(
          io,
          fail('context.layer', 'INVALID_LEVEL', `level must be one of L0, L1, L2, L3 (got ${level})`, { provided: level }, ['Pass --level L0|L1|L2|L3']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      let payload: LayerPayload;
      if (level === 'L0') payload = await fetchL0(options.project);
      else if (level === 'L1') payload = await fetchL1(options.project);
      else if (level === 'L2') payload = await fetchL2(options.project);
      else payload = await fetchL3(options.project, options.query ?? '');
      printResult(io, ok('context.layer', payload, [], [
        `${payload.layer} loaded: ${payload.byteSize} bytes across ${payload.files.length} file(s)`,
        payload.warnings.length > 0 ? `${payload.warnings.length} warning(s); see envelope.warnings` : null
      ].filter((x): x is string => typeof x === 'string')), options.json);
    } catch (error) {
      printResult(
        io,
        fail('context.layer', 'CONTEXT_LAYER_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path and --level value']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    context
      .command('status')
      .description('v2.11.0 D6: report main-session threshold tier for a given prompt size (no trigger dispatched). Useful for `--json` probes before invoking `peaks context check --auto-trigger`.')
      .requiredOption('--prompt-size <bytes>', 'estimated prompt size in bytes')
      .option('--capacity <bytes>', 'override the 256K default capacity (test seam)', '262144')
  ).action(
    (opts: { promptSize: string; capacity?: string; json?: boolean }) => {
      try {
        const promptSize = Number(opts.promptSize);
        const capacity = opts.capacity !== undefined ? Number(opts.capacity) : undefined;
        if (!Number.isFinite(promptSize) || promptSize < 0) {
          printResult(
            io,
            fail('context.status', 'INVALID_PROMPT_SIZE', `prompt-size must be a non-negative number (got "${opts.promptSize}")`, { provided: opts.promptSize }, ['Pass --prompt-size <bytes>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const evaluation = evaluateMainSessionThreshold(promptSize, capacity);
        printResult(
          io,
          ok('context.status', { ...evaluation, ide: detectIdeFromEnv() }, [...evaluation.warnings], [
            `Main-session tier=${evaluation.tier} (${(evaluation.ratio * 100).toFixed(0)}%)`
          ]),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('context.status', 'CONTEXT_STATUS_FAILED', getErrorMessage(err), null, ['Verify --prompt-size is a non-negative number']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    context
      .command('check')
      .description('v2.11.0 D6: threshold check + IDE-aware trigger dispatch. With --auto-trigger, returns the trigger path the LLM should follow; without, returns a dry-run recommendation. The LLM is responsible for actually invoking the trigger (slash command, self-compress, or escalation).')
      .requiredOption('--prompt-size <bytes>', 'estimated prompt size in bytes')
      .option('--capacity <bytes>', 'override the 256K default capacity (test seam)', '262144')
      .option('--in-flight-batch', 'a sub-agent batch is in flight (defer trigger per D6.e)', false)
      .option('--auto-trigger', 'return the trigger path the LLM should follow', false)
  ).action(
    (opts: { promptSize: string; capacity?: string; inFlightBatch?: boolean; autoTrigger?: boolean; json?: boolean }) => {
      try {
        const promptSize = Number(opts.promptSize);
        const capacity = opts.capacity !== undefined ? Number(opts.capacity) : undefined;
        if (!Number.isFinite(promptSize) || promptSize < 0) {
          printResult(
            io,
            fail('context.check', 'INVALID_PROMPT_SIZE', `prompt-size must be a non-negative number (got "${opts.promptSize}")`, { provided: opts.promptSize }, ['Pass --prompt-size <bytes>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const trigger = pickMainSessionTrigger({
          promptSize,
          capacityBytes: capacity,
          inFlightBatch: opts.inFlightBatch === true ? { hasInFlightBatch: true, sharedChannelEntries: 1 } : undefined
        });
        // Slice C of v2.11.1 — observability hook #5/7. Fire-and-forget
        // per PRD Q4. The synchronous emit never throws.
        const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
        const sid = getSessionIdCanonical(projectRoot) ?? '';
        if (sid.length > 0) {
          emitObservabilityEvent({
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
          }, { projectRoot });
        }
        const logLine = formatMainSessionTriggerLogLine(trigger, 'main');
        const payload = {
          ...trigger,
          autoTrigger: opts.autoTrigger === true,
          logLine
        };
        printResult(
          io,
          ok('context.check', payload, [], [
            trigger.kind === 'compact'
              ? `Tier reached → trigger ${trigger.path} on ${trigger.ide} (code=${trigger.code})`
              : trigger.kind === 'defer'
                ? `Deferred: ${trigger.reason}`
                : trigger.kind === 'soft-warn'
                  ? `Soft warning at ${(trigger.ratio * 100).toFixed(0)}% (no trigger yet)`
                  : 'Below threshold; no trigger'
          ]),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('context.check', 'CONTEXT_CHECK_FAILED', getErrorMessage(err), null, ['Verify --prompt-size is a non-negative number']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}
