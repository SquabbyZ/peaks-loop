import Database from 'better-sqlite3';
import {
  CrystallizationIntegrityError,
  CrystallizationService,
  CrystallizationTaskStateSchema
} from '../../crystallization/crystallization-service.js';
import type { CrystallizationOptions } from '../../crystallization/crystallization-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

/** Test doubles: `assertReady` never reaches any of them. */
function probeService(): CrystallizationService {
  const noop = (): void => undefined;
  const opts = {
    loopReleaseSchema: { parse: (input: unknown) => input },
    loopBeeRelationSchema: { parse: (input: unknown) => input, omit: () => ({ parse: (input: unknown) => input }) },
    insertLoopRelease: noop,
    insertLoopBeeRelation: noop
  } as unknown as CrystallizationOptions;
  return new CrystallizationService(new Database(':memory:'), opts);
}

/**
 * Behavioural probe of the crystallization gate.
 *
 * Before this the contract only asserted that one of three candidate files
 * exists and mentions "crystalliz"/"sediment"/"promot" — the file it found is
 * named `crystallization-service.ts`, so the check restated its own filename.
 *
 * Here the real gate is driven with a completed and an incomplete task state:
 * a task whose `gates_passed` is false must be refused at the Zod boundary AND
 * again at the service boundary.
 */
export async function runJ08Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const ready = { task_id: 'guard-J08', task_status: 'completed' as const, gates_passed: true as const, evidence_collected: true as const };

  const schemaAcceptsReady = CrystallizationTaskStateSchema.safeParse(ready).success;
  const schemaRejectsGatesFalse = !CrystallizationTaskStateSchema.safeParse({ ...ready, gates_passed: false }).success;
  const schemaRejectsNotCompleted = !CrystallizationTaskStateSchema.safeParse({ ...ready, task_status: 'in_progress' }).success;
  const schemaRejectsNoEvidence = !CrystallizationTaskStateSchema.safeParse({ ...ready, evidence_collected: false }).success;

  const svc = probeService();
  let serviceAcceptsReady = false;
  try {
    serviceAcceptsReady = svc.assertReady(ready).task_id === 'guard-J08';
  } catch {
    serviceAcceptsReady = false;
  }

  const refused: string[] = [];
  const badStates: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['gates_passed=false', { ...ready, gates_passed: false }],
    ['task_status=in_progress', { ...ready, task_status: 'in_progress' }],
    ['evidence_collected=false', { ...ready, evidence_collected: false }]
  ];
  for (const [label, task] of badStates) {
    try {
      svc.assertReady(task as unknown as typeof ready);
    } catch (e) {
      if (e instanceof CrystallizationIntegrityError) refused.push(label);
    }
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(schemaAcceptsReady, 'a completed, gate-passed, evidenced task passes the schema'),
    probe(schemaRejectsGatesFalse, 'gates_passed=false is refused by the schema'),
    probe(schemaRejectsNotCompleted, 'task_status!=completed is refused by the schema'),
    probe(schemaRejectsNoEvidence, 'evidence_collected=false is refused by the schema'),
    probe(serviceAcceptsReady, 'the service accepts a ready task'),
    probe(refused.length === 3, `the service refuses every non-passing gate state with CrystallizationIntegrityError (refused: ${refused.join(', ') || 'none'})`)
  ]);

  const artifact = row.sourceFiles[0] ?? 'src/services/crystallization/crystallization-service.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'crystallization refuses any task whose gates are not in a passing state',
    result.detail,
    'J08 invariant broken: crystallization no longer enforces the pre-run gate'
  );
}
