// src/services/race/gate2-policy.ts
//
// THE ONE COMPUTATIONAL SOURCE of the race-lane gate-2 threshold policy.
//
// The tracked evidence file `.peaks/race/pilot-gate.json` carries a `policy`
// block too, but that is the RECORD of what was applied, written by the writer
// from this constant — never the authority. If the file's block were the source,
// weakening it in the tracked file would launder the gate.
//
// Changing the policy means changing RACE_GATE2_POLICY_VERSION with it, so a
// historical verdict is never re-interpreted under a policy it was not judged by.
//
// The rationale is quoted verbatim from §3 of the gate-2 threshold-policy PRD,
// because a threshold whose basis is dropped is a number nobody can re-derive.

export const RACE_GATE2_POLICY_VERSION = 'race-gate2-policy-v1';

export type RaceGate2Policy = {
  /** Floor: landed tasks only (§3.1). */
  readonly taskCountMin: number;
  /** Floor: landed tasks whose change reached the lane's core capability (§3.2). */
  readonly coreCapabilityTaskCountMin: number;
  /** Floor: distinct sessions among landed tasks. */
  readonly sessionCountMin: number;
  /** Floor: safety-arm hits over ALL records, escalated and stopped included (§3.1 exception). */
  readonly safetyArmExercisedMin: number;
  /** Hard zero: any rise is a failure, and it is never part of the "not enough sample" discussion. */
  readonly rollbackCountMax: number;
  readonly ciRedCountMax: number;
  readonly missedRiskSurfaceCountMax: number;
  readonly rationale: string;
};

const RATIONALE_LINES = [
  '>= 10 的依据是 rule of three：n 次全绿、零观测失败时，真实失败率的 95% 上界 ≈ 1 − 0.05^(1/n)。n=10 ⇒ ≈ 26%。这是保守但可达的档：按 2026-10-11 的速度（一天 4 条落地）约 3 个工作日。',
  '>= 3 条压核心的依据是前瞻的，不是回溯的：只数任务数的政策会让 10 条从未碰过硬阻断路径的任务通过一道从未测试过收益路径的门——这正是「散文判据」的翻版：数得到，但证明不了要证明的事。',
  '>= 1 安全臂的依据是本轮的实测：2026-10-11 的 4 条 landed 全部 riskSurfacesHit: []；唯一真命中过风险面的（row 7，rid-emit-helpers-escalated）是升级未落地的那条——所以这条泳道的安全承诺从未在任何一条落地的任务上被测过。因此这一条与 taskCount 的口径不同，统计所有记录（含 escalated）：升级本身就是安全臂正确开火的证据，只数 landed 会把它恰好排除掉。',
  '>= 2 个 session 的依据：单 session 的多条任务共享同一份上下文与同一个操作者状态（2026-10-11 的 4 条全在一个 session 里）。跨 session 是最便宜的「不是一次侥幸」证据。'
] as const;

export const RACE_GATE2_POLICY_V1: RaceGate2Policy = {
  taskCountMin: 10,
  coreCapabilityTaskCountMin: 3,
  sessionCountMin: 2,
  safetyArmExercisedMin: 1,
  rollbackCountMax: 0,
  ciRedCountMax: 0,
  missedRiskSurfaceCountMax: 0,
  rationale: RATIONALE_LINES.join('\n')
};
