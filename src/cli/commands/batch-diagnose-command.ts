// src/cli/commands/batch-diagnose-command.ts
//
// The `peaks batch diagnose` action: the batch lane's read-only diagnosis
// fan-out, and the batch record it writes.
//
// Split out of `batch-commands.ts` to honor the repo's file-size cap. The
// two files share no logic: this one is the ACTION, and the registrar beside
// it is the group.
//
// WHY THIS EXISTS. Batch mode is an ADDITION to the race lane, never a
// substitute for it, so this command is reached only when the user handed
// over two or more mutually independent items. With ONE item the lane takes
// exactly the path it takes today, and this command refuses rather than
// running the machinery on a single item — the machinery exists to amortize
// setup across several items, and on one item it costs what it saves.
//
// WHAT IT DOES, IN TWO HALVES THAT BELONG TOGETHER.
//   1. It produces one read-only diagnosis `toolCall` per item that still
//      needs a diagnosis, in the same dry-run envelope shape
//      `peaks sub-agent dispatch` produces: the CLI produces the toolCall and
//      the LLM executes it. The diagnostician only READS and REPORTS; the
//      file set it reports is the only input the topology step has, so a
//      diagnostician that also wrote files would be reporting a guess.
//   2. It records the batch in the progress record Task 6 wrote, and plans
//      the waves from the file sets the diagnosticians MEASURED.
//
// WHY THE ITEM LIST IS AN INPUT AND NOT A GUESS. The batch's items are
// facts about the user's request that only the caller holds, so the caller
// supplies them. That is also why the item's STATUS is explicit: a diagnosed
// item is one whose file set was measured, and a pending one is one that
// still needs a diagnostician. Nothing is inferred from an absent field,
// because an item whose diagnosis found NO files is still diagnosed.
//
// WHY THE PROGRESS RECORD IS WRITTEN HERE. The record is what survives a
// compaction: the batch's stage, its items, and their measured file sets.
// Without it a compaction mid-batch loses the measured file sets, and the
// topology step has nothing to plan from.

import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { recordBatch, readContextRatio } from './batch-diagnose-record.js';
import { printDiagnoseResult } from './batch-diagnose-envelope.js';
import { decideBatchMode } from '../../services/batch/batch-entry.js';
import { buildDiagnosisPrompt } from '../../services/batch/batch-diagnosis.js';
import type { BatchItem } from '../../services/batch/batch-progress-types.js';
import { REQUEST_ID_PATTERN } from '../../services/artifacts/request-artifact-service.js';
import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  hasSymptom,
  readItems,
  type BatchDiagnoseOptions,
  type BatchItemInput
} from './batch-item-input.js';
import { resolveAutoCompactProfile } from '../../services/mode/mode-status-service.js';

/** The role the diagnosticians are dispatched as: the lane's own RD role. */
const DIAGNOSIS_ROLE = 'rd';

/**
 * A refusal: the batch did not run, and why.
 *
 * Every refusal in this command is a REFUSAL, not a verdict. A caller that
 * read `ok: true` here would believe a batch was diagnosed when nothing was.
 */
interface BatchRefusal {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

/** The batch is ready to run: the request, the session, and the items. */
interface BatchReady {
  readonly kind: 'ready';
  readonly projectRoot: string;
  readonly rid: string;
  readonly sessionId: string;
  readonly items: readonly BatchItemInput[];
  readonly mode: 'single' | 'batch';
}

/**
 * The request the batch belongs to, or the refusal for it.
 *
 * A batch is not a free-standing thing: it is one request's worth of
 * independent items, so the request id has to be nameable and has to be a
 * real one — it becomes a path segment in the batch record.
 */
function resolveRid(options: BatchDiagnoseOptions): string | BatchRefusal {
  const rid = options.rid;
  if (rid === undefined || rid === '') {
    return {
      kind: 'refused',
      code: 'MISSING_RID',
      message: 'a batch belongs to a request, so --rid is required',
      data: { rid: null, itemCount: 0, toolCalls: [] },
      nextActions: ['Re-run with --rid <rid> naming the request this batch belongs to.']
    };
  }
  if (!REQUEST_ID_PATTERN.test(rid)) {
    return {
      kind: 'refused',
      code: 'INVALID_RID',
      message: `the request id "${rid}" is not a valid request id`,
      data: { rid: null, itemCount: 0, toolCalls: [] },
      nextActions: [
        'A request id is letters, digits, dots, dashes and underscores (see REQUEST_ID_PATTERN).'
      ]
    };
  }
  return rid;
}

/**
 * Resolve the batch's preconditions.
 *
 * The checks live here rather than inside the action so the action stays
 * one thing: dispatch the diagnosis fan-out. Every refusal names the
 * precondition that was missing, so a caller can fix it and re-run.
 */
function resolveBatch(options: BatchDiagnoseOptions): BatchReady | BatchRefusal {
  const projectRoot = options.project ?? process.cwd();
  const rid = resolveRid(options);
  if (typeof rid !== 'string') return rid;
  const parsed = readItems(options);
  if (parsed.kind === 'invalid') {
    return {
      kind: 'refused',
      code: 'INVALID_ITEMS',
      message: parsed.message,
      data: { rid, itemCount: 0, toolCalls: [] },
      nextActions: [
        'Supply the items as {"items":[{"id":"i1","label":"...","symptom":"...","status":"pending"}]}',
        'via --items <file> or --items-json <json>.'
      ]
    };
  }
  const items = parsed.items;
  const mode = decideBatchMode(items.length);
  if (mode === 'single') {
    return {
      kind: 'refused',
      code: 'BATCH_MODE_NOT_APPLICABLE',
      message: `one item is not a batch: ${items.length} item supplied`,
      data: { rid, itemCount: items.length, toolCalls: [] },
      nextActions: [
        'Run the single-task path instead — a single task takes exactly the path it takes today.',
        'Batch mode needs two or more mutually independent items.'
      ]
    };
  }
  const sessionId = getCurrentSessionId(projectRoot);
  if (sessionId === null) {
    return {
      kind: 'refused',
      code: 'NO_SESSION',
      message: `no peaks session is bound to ${projectRoot}, so the batch cannot be recorded`,
      data: { rid, itemCount: items.length, toolCalls: [] },
      nextActions: ['Run `peaks workspace init --project .` first, then re-run this command.']
    };
  }
  return { kind: 'ready', projectRoot, rid, sessionId, items, mode };
}

/**
 * Build one read-only diagnosis toolCall per pending item.
 *
 * The RECORD is the source of the prompt, not the caller's input: the
 * record accumulates across runs, so an item that a previous run left
 * pending is dispatched here even when this run's input did not repeat it —
 * and the symptom it carries is the one the record kept, not a label
 * standing in for it.
 */
function buildDiagnosisToolCalls(
  projectRoot: string,
  rid: string,
  sessionId: string,
  pending: readonly BatchItem[]
): { readonly toolCalls: readonly SubAgentToolCall[]; readonly undiagnosable: readonly string[] } {
  const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
  const dispatcher = getAdapter(ide).subAgentDispatcher;
  const toolCalls = pending.filter(hasSymptom).map((item) =>
    dispatcher.buildToolCall({
      role: DIAGNOSIS_ROLE,
      prompt: buildDiagnosisPrompt({
        id: item.id,
        label: item.label,
        symptom: item.symptom
      }),
      requestId: `${rid}-${item.id}`,
      sessionId
    })
  );
  const undiagnosable = pending.filter((item) => !hasSymptom(item)).map((item) => item.id);
  return { toolCalls, undiagnosable };
}

/**
 * Run the batch's diagnosis stage.
 *
 * The envelope is dry-run by design, exactly like `peaks sub-agent dispatch`:
 * the CLI produces the toolCall descriptors and the LLM executes them in its
 * own environment.
 */
export function runBatchDiagnose(options: BatchDiagnoseOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  const resolved = resolveBatch(options);
  if (resolved.kind === 'refused') {
    printResult(
      io,
      fail('batch.diagnose', resolved.code, resolved.message, resolved.data as never, [
        ...resolved.nextActions
      ]),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  const { projectRoot, rid, sessionId, items, mode } = resolved;
  const compactMode = resolveAutoCompactProfile(projectRoot);
  const ratio = readContextRatio(projectRoot, sessionId);
  const { progress, compaction } = recordBatch({
    projectRoot,
    sessionId,
    batchId: rid,
    items,
    ratio,
    mode: compactMode
  });
  const pending = progress.items.filter((item) => item.status === 'pending');
  const { toolCalls, undiagnosable } = buildDiagnosisToolCalls(
    projectRoot,
    rid,
    sessionId,
    pending
  );
  printDiagnoseResult({
    io,
    asJson,
    mode,
    rid,
    sessionId,
    progress,
    pendingCount: pending.length,
    toolCalls,
    undiagnosable,
    compaction
  });
}
