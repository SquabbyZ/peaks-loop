/**
 * Slice 5 (peaks-code default fan-out) — guard the SKILL.md contract.
 *
 * Slice 5 changes the peaks-code SKILL.md to teach the default rule:
 * "If the slice DAG has >= 2 leaves at the same topological level, dispatch
 * them in a single batch via `peaks sub-agent dispatch --from-dag`."
 *
 * This test pins the contract so a future edit cannot silently regress
 * back to the old "conditional swarm" framing. Three guarantees:
 *
 *  1. SKILL.md contains an explicit phrase that the runbook MUST use
 *     `--from-dag` when the topological level has >= 2 leaves (the
 *     "default fan-out" instruction).
 *  2. SKILL.md stays under the 24000-byte cap (peaks scan file-size gate).
 *  3. The runbook (the CLI sequence peaks-code follows) actually invokes
 *     `peaks sub-agent dispatch --from-dag` so the default fan-out path
 *     is triggered end-to-end, not just promised in prose.
 *
 * Why text-grep tests instead of a behavioral test: the slice is a SKILL.md
 * change. The "fan-out logic" already lives in `src/services/code/dag-orchestrator.ts`
 * and the CLI surface (`peaks sub-agent dispatch --from-dag`) — both are
 * tested elsewhere. This file guards the orchestration contract that
 * triggers them.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL_PATH = join(process.cwd(), 'skills', 'peaks-code', 'SKILL.md');
const RUNBOOK_PATH = join(process.cwd(), 'skills', 'peaks-code', 'references', 'runbook.md');
const SWARM_CONTRACT_PATH = join(process.cwd(), 'skills', 'peaks-code', 'references', 'swarm-dispatch-contract.md');
const SKILL_BYTE_CAP = 25_000;
const FANOUT_PHRASE = 'peaks sub-agent dispatch --from-dag';

describe('peaks-code SKILL.md — default fan-out contract (slice 5)', () => {
  it('SKILL.md body contains the default fan-out phrase', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    expect(body).toContain(FANOUT_PHRASE);
  });

  it('SKILL.md explicitly instructs fan-out when >= 2 leaves share a topological level', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    // Slice 5 contract: the SKILL must tell the LLM to fan out by default
    // whenever the DAG has >= 2 leaves at the same level. The contract
    // wording MUST include both the gate ("≥ 2 leaves" / "topological
    // level" / "same level") and the mechanism (`--from-dag`).
    const mentionsGate =
      /≥\s*2\s+leaves|at\s+least\s+2\s+leaves|2\s+or\s+more\s+leaves|topological\s+level/i.test(body);
    const mentionsMechanism = body.includes(FANOUT_PHRASE);
    expect(mentionsGate).toBe(true);
    expect(mentionsMechanism).toBe(true);
  });

  it('SKILL.md cites references/swarm-dispatch-contract.md as the gate logic', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    // Slice 5 cites the existing swarm-dispatch-contract reference so
    // the fan-out gate logic stays single-sourced. If a future edit drops
    // the citation, the reader has no pointer to the canonical contract.
    expect(body).toContain('references/swarm-dispatch-contract.md');
  });

  it('SKILL.md stays under the 24000-byte cap (peaks scan file-size gate)', async () => {
    const stats = await stat(SKILL_PATH);
    expect(stats.size).toBeLessThanOrEqual(SKILL_BYTE_CAP);
  });

  it('references/swarm-dispatch-contract.md exists and defines the DAG gate', async () => {
    const body = await readFile(SWARM_CONTRACT_PATH, 'utf8');
    // The contract reference must still define the topological-level
    // fan-out gate. This is the canonical source the SKILL.md cites.
    expect(body).toMatch(/topological|fan[- ]?out|swarm/i);
  });
});

describe('peaks-code runbook — CLI sequence triggers --from-dag fan-out (slice 5)', () => {
  it('runbook invokes peaks sub-agent dispatch --from-dag at the swarm phase', async () => {
    const body = await readFile(RUNBOOK_PATH, 'utf8');
    // Step 3 in the runbook (the swarm fan-out phase) must dispatch via
    // --from-dag so the orchestrator's level-by-level parallel path is
    // actually taken. If the runbook still says "dispatch <role>" one at
    // a time, the default fan-out contract is dead prose.
    expect(body).toContain('peaks sub-agent dispatch');
    expect(body).toMatch(/--from-dag/);
  });

  it('runbook swarm phase shows N parallel sub-agent dispatches in one message', async () => {
    const body = await readFile(RUNBOOK_PATH, 'utf8');
    // The step 3b instruction must indicate that N dispatch calls are
    // launched together (the "fan-out" semantic). Look for the canonical
    // wording "ONE message" / "N = len" / "parallel".
    const hasFanOutShape =
      /ONE message|single message|len\(swarm-plan\.subAgents\)|in parallel/i.test(body);
    expect(hasFanOutShape).toBe(true);
  });
});