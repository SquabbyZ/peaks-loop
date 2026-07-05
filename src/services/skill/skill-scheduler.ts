/**
 * G6 — skill-level heartbeat scheduler config.
 *
 * Slice 2026-06-07-sub-agent-dispatch-decouple (G6): the SKILL.md front
 * matter for a Dispatcher (peaks-code / peaks-rd / peaks-qa) can opt
 * into a non-default heartbeat interval by including a line like:
 *
 *   heartbeatIntervalSec: 15
 *
 * The default is 30 s (RL-13 empirical sweet spot). The poller
 * cadence is fixed at 10 s (sub-agent 30 s / poller 10 s is the
 * jitter-resistant offset).
 *
 * This module is a pure-key parser — it takes a SKILL.md body and
 * returns the effective config. The Dispatcher's prompt template
 * for sub-agents is then responsible for inlining the chosen value
 * into the sub-agent prompt so that the LLM knows how often to
 * call `peaks sub-agent heartbeat`.
 *
 * Note: the heartbeat *cadence* the LLM uses is enforced socially
 * (via the prompt), not via any hook. R-1 / R-8 boundary — LLM
 * behaviour is not observable. The user has been explicit about
 * this: "心跳是 sub-agent 主动写, peaks CLI 不观测 LLM 行为".
 */

export const DEFAULT_HEARTBEAT_INTERVAL_SEC = 30;
export const MIN_HEARTBEAT_INTERVAL_SEC = 5;
export const MAX_HEARTBEAT_INTERVAL_SEC = 600;

export type SkillHeartbeatConfig = {
  readonly intervalSec: number;
  /** Source of the chosen value (useful for debugging). */
  readonly source: 'default' | 'skill-frontmatter';
};

/** Parse a SKILL.md body for a `heartbeatIntervalSec: <N>` line. */
export function parseHeartbeatConfig(skillBody: string): SkillHeartbeatConfig {
  const match = skillBody.match(/^\s*heartbeatIntervalSec\s*:\s*(\d+)\s*$/m);
  if (!match) {
    return { intervalSec: DEFAULT_HEARTBEAT_INTERVAL_SEC, source: 'default' };
  }
  const value = Number.parseInt(match[1] as string, 10);
  if (!Number.isInteger(value) || value < MIN_HEARTBEAT_INTERVAL_SEC || value > MAX_HEARTBEAT_INTERVAL_SEC) {
    return { intervalSec: DEFAULT_HEARTBEAT_INTERVAL_SEC, source: 'default' };
  }
  return { intervalSec: value, source: 'skill-frontmatter' };
}

/**
 * Build the heartbeat-instruction paragraph to inline in a sub-agent
 * prompt. The LLM reads this and adjusts its `peaks sub-agent
 * heartbeat` cadence accordingly.
 */
export function heartbeatInstructionParagraph(config: SkillHeartbeatConfig): string {
  return (
    `While running, call ` +
    `\`peaks sub-agent heartbeat --record <dispatchRecordPath> --status <state> --progress <pct> --note "<text>"\` ` +
    `at least every ${config.intervalSec} seconds (the Dispatcher expects ` +
    `${config.intervalSec}s cadence; default 30s, your SKILL.md overrides to ${config.intervalSec}s). ` +
    `On completion, call \`--status done --progress 100 --note "completed"\`. ` +
    `On failure, \`--status failed\`. Do not skip heartbeats; the parent ` +
    `Dispatcher uses them to keep the user informed during the wait.`
  );
}
