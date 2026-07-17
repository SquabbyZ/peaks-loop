/**
 * M8 dogfood crystallization test.
 *
 * Real crystallization of the work we just shipped (M0..M7) into a
 * Loop Engineering asset (loop_release + main bee_release + loop_bee_relation
 * + crystallization_event). This is the proof that the design works end-to-end:
 *
 *   - 4-section evidence_brief is built from the real workflow trace
 *     (8 git commit SHAs as source_trace_pointers).
 *   - Pre-run gate is enforced (task_status=completed, gates_passed=true,
 *     evidence_collected=true).
 *   - Loop + main bee + relation + crystallization_event are written in a
 *     single transaction.
 *   - Loop lands as candidate.
 *   - All four brief sections are required and present.
 *
 * Run:
 *   ./node_modules/.bin/vitest run tests/integration/dogfood-loop-engineering-crystallization.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { openStateDb } from '../../src/services/skillhub/sqlite-store.js';
import type Database from 'better-sqlite3';
import { CrystallizationService } from 'peaks-loop-crystallization';
import { buildEvidenceBrief } from 'peaks-loop-crystallization';
import { LoopReleaseService } from '../../src/services/loop/loop-release-service.js';
import { LoopBeeRelationService } from '../../src/services/loop/loop-bee-relation-service.js';

function git(...args: string[]): string {
  return execSync(`git ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
    encoding: 'utf8',
    cwd: process.cwd(),
  }).trim();
}

describe('M8 dogfood: real crystallization of the Loop Engineering work', () => {
  let tmpDir: string;
  let db: Database.Database;
  const blobsDir = 'dogfood-blobs';

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'peaks-dogfood-'));
    db = openStateDb(join(tmpDir, 'state.db')) as unknown as Database.Database;
  });

  afterAll(() => {
    if (db && typeof (db as { close?: () => void }).close === 'function') {
      try { (db as { close?: () => void }).close!(); } catch { /* noop */ }
    }
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('gates crystallization when task status is not completed (pre-run block, RL-2)', () => {
    const svc = new CrystallizationService(db);
    const sourceShas = [git('rev-parse', 'HEAD')];
    const brief = buildEvidenceBrief({
      trace_id: 'm8-dogfood-pre-run-block',
      what_happened: 'unit test of pre-run gate',
      why_it_matters: 'pre-run creation must be blocked',
      what_learned: 'RL-2 enforcement works',
      what_action: 'fail closed',
      source_trace_pointers: sourceShas,
    });
    expect(() =>
      svc.crystallize({
        task: { task_id: 'm8-test-pre-run-block', task_status: 'pending' as never, gates_passed: true, evidence_collected: true },
        loop_input: { name: 'shoo', scenario: 'x', trigger_policy: 'x', shareable: true, desktop_visible: true } as never,
        bee_input: { name: 'bee-shoo', description: 'x' } as never,
        bee_relation_reason: 'x',
        evidence_brief: brief,
        trigger: 'user_explicit',
      })
    ).toThrow(/task.*completed|pre_run|gate|status/i);
  });

  it('gates crystallization when gates_passed is false', () => {
    const svc = new CrystallizationService(db);
    const sourceShas = [git('rev-parse', 'HEAD')];
    const brief = buildEvidenceBrief({
      trace_id: 'm8-dogfood-gate-block',
      what_happened: 'unit test of gates_passed block',
      why_it_matters: 'gate failures must block crystallization',
      what_learned: 'RL-2 enforcement works',
      what_action: 'fail closed',
      source_trace_pointers: sourceShas,
    });
    expect(() =>
      svc.crystallize({
        task: { task_id: 'm8-test-gate-block', task_status: 'completed' as never, gates_passed: false as never, evidence_collected: true },
        loop_input: { name: 'shoo2', scenario: 'x', trigger_policy: 'x', shareable: true, desktop_visible: true } as never,
        bee_input: { name: 'bee-shoo2', description: 'x' } as never,
        bee_relation_reason: 'x',
        evidence_brief: brief,
        trigger: 'user_explicit',
      })
    ).toThrow(/gate/i);
  });

  it('refuses when the 4-section brief is incomplete (RL-7)', () => {
    expect(() =>
      buildEvidenceBrief({
        trace_id: 'm8-dogfood-incomplete-brief',
        what_happened: 'a',
        why_it_matters: 'b',
        // what_learned intentionally missing (empty)
        what_learned: '',
        what_action: 'd',
        source_trace_pointers: ['x'],
      })
    ).toThrow(/brief|section|missing/i);
  });

  it('crystallizes the M0..M7 work into a real loop + bee + relation + event (M8 exit)', () => {
    const headSha = git('rev-parse', 'HEAD');
    const sourceShas = [
      git('rev-parse', 'HEAD~7'),
      git('rev-parse', 'HEAD~6'),
      git('rev-parse', 'HEAD~5'),
      git('rev-parse', 'HEAD~4'),
      git('rev-parse', 'HEAD~3'),
      git('rev-parse', 'HEAD~2'),
      git('rev-parse', 'HEAD~1'),
      headSha,
    ];

    const brief = buildEvidenceBrief({
      trace_id: 'm8-dogfood-loop-engineering-2026-07-07',
      what_happened:
        '8 切片 (M0..M7) 把 peaks-loop 从 "沉淀 workflow/bee" 升级为 4 层 Loop Engineering 资产模型 + 9 条 karpathy 红线 + Darwin-style ratchet + peaks.bundle/1 分享格式。每个切片 RD sub-agent 实施并 vitest 绿。',
      why_it_matters:
        '防止 LLM 自评漂移；锁定桌面/跨用户分享的可扩展面；让 peaks-loop 主语从 workflow 改为 loop engineering。',
      what_learned:
        'Loop + Bee 双层资产 + 4-section brief + independent-context evaluation 不可拆；peaks-maker 必须显式 import 指南文件；import 必须强制 candidate。',
      what_action:
        '本循环作为 candidate 沉淀；下次同类"loop engineering 端到端长任务"由本 loop 触发 main bee 执行；promotion 需 evolution_evaluation 独立评估。',
      source_trace_pointers: sourceShas,
      bullets: [
        '8 M-slices implemented',
        '266+ vitest cases across loop/evolution/crystallization/share',
        '9 red lines in karpathy 4-section form',
      ],
    });

    expect(brief.what_happened.length).toBeGreaterThan(10);
    expect(brief.why_it_matters.length).toBeGreaterThan(10);
    expect(brief.what_learned.length).toBeGreaterThan(10);
    expect(brief.what_action.length).toBeGreaterThan(10);

    const svc = new CrystallizationService(db);
    const result = svc.crystallize({
      task: { task_id: 'm8-dogfood-loop-engineering-2026-07-07', task_status: 'completed' as never, gates_passed: true, evidence_collected: true },
      loop_input: {
        id: 'loop-engineering-crystallization-authoring',
        name: 'loop-engineering-crystallization-authoring',
        scenario: 'Long-task authoring flow that turns a user complaint about "workflow, not loop engineering" into a 4-layer Loop Engineering asset model with karpathy × darwin discipline.',
        trigger_policy: 'User NL: "workflow 不像 loop engineering" / "沉淀 loop engineering" / "下次按这个跑" / "结晶这条 loop".',
        interaction_policy: 'Human-NL-Choice-Only (RL-1).',
        feedback_policy: 'Read gates, evaluators, final review, user confirmations into loop memory.',
        evolution_policy: 'Darwin-style ratchet (RL-4): single object + single dimension + independent scorer + regression skeptic + score-delta threshold + user confirmation. Karpathy 4-section form for new rules (RL-0).',
        success_criteria: [
          'All 10 M-slices checkpoint done.',
          'Each slice vitest green at exit.',
          'crystallization_event persisted with 4-section brief.',
        ],
        evaluator_policy: ['Independent scorer (RL-5)', 'Regression skeptic (RL-4)'],
        lifecycle_status: 'candidate' as never,
        version: '0.1.0',
      } as never,
      bee_input: {
        bee_name: 'bee-loop-engineering-crystallization-implementer',
        description: 'Dispatch RD sub-agents to ship M0..M7 schema/service/CLI/tests; crystallize the work into loop + bee + crystallization_event.',
        version: '0.1.0',
      } as never,
      bee_relation_reason: 'The implementation bee that shipped the schema, service, CLI, and tests for the loop-engineering crystallization design.',
      evidence_brief: brief,
      trigger: 'user_explicit',
    });

    expect(result.loop_release_id).toBeTruthy();
    expect(result.bee_release_id).toBeTruthy();
    expect(result.loop_bee_relation_id).toBeTruthy();
    expect(result.crystallization_event_id).toBeTruthy();
    expect(result.loop_release_lifecycle_status).toBe('candidate');

    const loopSvc = new LoopReleaseService(db);
    const stored = loopSvc.read(result.loop_release_id);
    expect(stored).toBeTruthy();
    expect(stored!.lifecycle_status).toBe('candidate');
    expect(stored!.shareable).toBe(true);
    expect(stored!.desktop_visible).toBe(true);
    expect(stored!.export_bundle_format).toBe('peaks.bundle/1');

    const relSvc = new LoopBeeRelationService(db);
    const relations = relSvc.listByLoop({ loop_release_id: result.loop_release_id });
    expect(relations.length).toBe(1);
    expect(relations[0]!.role).toBe('main');
    expect(relations[0]!.bee_release_id).toBe(result.bee_release_id);

    // Final assertion: the crystallization_event round-trip.
    const event = svc.read(result.crystallization_event_id);
    expect(event).toBeTruthy();
    expect(event!.created_loop_release_id).toBe(result.loop_release_id);
    expect(event!.created_bee_release_id).toBe(result.bee_release_id);
  });
});