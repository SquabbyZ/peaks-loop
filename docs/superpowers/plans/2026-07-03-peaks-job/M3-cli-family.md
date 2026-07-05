# M3 — CLI Family (9 subcommands)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the orchestrator to 9 `peaks job *` subcommands matching spec §4.1. After M3, the CLI surface is usable end-to-end (init → status → checkpoint → continue → block → resume → handoff → rotate-now [stub] → subagent-cleanup [stub]). Rotation and wrapper land in M4-M5; here the last two are stubbed enough to satisfy AC-1 (help-text + JSON envelope).

**Architecture:** New `src/cli/commands/job-commands.ts` registered into the existing Commander program (see how `src/cli/commands/dispatch-commands.ts` is wired). One file, ≤800 lines per the 800-line file cap (Karpathy #2). Reuse `addJsonOption` + `printResult` from `cli-helpers.ts`.

**Tech Stack:** Commander (already in deps), Zod (for CLI input validation, from M1).

---

## Global Constraints (from README)

Apply verbatim.

---

## Task 3.1: Bootstrap CLI file with init + status

**Files:**
- Create: `src/cli/commands/job-commands.ts` (~280 LoC target)
- Modify: `src/cli/index.ts` (program setup; add `registerJobCommands(prog)` call)
- Test: `tests/unit/cli/commands/job-commands.test.ts`

- [ ] **Step 1: Find the program-registration pattern**

Run: `grep -n "registerXxxCommands" src/cli/index.ts | head -20`

(Note the exact call sites — use the same style.)

- [ ] **Step 2: Write failing test**

```typescript
// tests/unit/cli/commands/job-commands.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerJobCommands } from '../../../../src/cli/commands/job-commands.js';
import { Command } from 'commander';

function freshProgram(): Command {
  const prog = new Command();
  prog.option('--project <p>');
  registerJobCommands(prog);
  return prog;
}

describe('peaks job CLI', () => {
  it('registers 9 subcommands', () => {
    const prog = freshProgram();
    const jobCmd = prog.commands.find(c => c.name() === 'job');
    expect(jobCmd).toBeTruthy();
    const names = jobCmd!.commands.map(c => c.name()).sort();
    expect(names).toEqual([
      'block', 'checkpoint', 'continue', 'handoff', 'init',
      'resume', 'rotate-now', 'status', 'subagent-cleanup',
    ]);
  });

  it('init requires --job-id and --slice-list', () => {
    const prog = freshProgram();
    const initCmd = prog.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'init')!;
    const required = (initCmd as any).options.filter((o: any) => o.required).map((o: any) => o.long);
    expect(required).toContain('--job-id');
    expect(required).toContain('--slice-list');
  });

  it('status --help mentions --watch and --show-cost', () => {
    const prog = freshProgram();
    const statusCmd = prog.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'status')!;
    const help = statusCmd.helpInformation();
    expect(help).toContain('--watch');
    expect(help).toContain('--show-cost');
  });
});
```

- [ ] **Step 3: Run (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/cli/commands/job-commands.test.ts`
Expected: FAIL "Cannot find module job-commands.js"

- [ ] **Step 4: Implement `job-commands.ts` (init + status only) — partial**

```typescript
// src/cli/commands/job-commands.ts
import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import {
  JobInitInputSchema, JobCheckpointInputSchema, JobBlockInputSchema,
} from '../../services/job/job-types.js';

// Stub stubs for M5/M4 — full impl in those milestones.
async function rotateNowImpl(_jobId: string, _project: string) { return ok({ note: 'rotate-now lands in M4' }); }
async function subagentCleanupImpl(_jobId: string, _batchId: string) { return ok({ note: 'subagent-cleanup lands in M5' }); }

function projectRoot(opts: any): string {
  // Reuse the workspace root resolver from peaks CLI; for now, CWD as a safe placeholder.
  return opts.project ?? process.cwd();
}

export function registerJobCommands(prog: ProgramIO): void {
  const job = new Command('job').description('Drive long multi-slice work as one Job (peaks-code Step 0.8+)');

  job
    .command('init')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-list <list>')
    .option('--parallelism-hint <serial|llm-decides>', 'llm-decides')
    .option('--exit-policy <strict|best-effort>', 'strict')
    .option('--main-loop-strategy <single|rotating>', 'rotating')
    .option('--rotate-every <n>', '3')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const parsed = JobInitInputSchema.safeParse({
        jobId: opts.jobId,
        sliceList: opts.sliceList.split(',').map((s: string) => s.trim()).filter(Boolean),
        parallelismHint: opts.parallelismHint,
        exitPolicy: opts.exitPolicy,
        mainLoopStrategy: opts.mainLoopStrategy,
        rotateEvery: Number(opts.rotateEvery),
        project: projectRoot(opts),
        json: opts.json,
      });
      if (!parsed.success) return printResult(prog, fail('invalid-init', parsed.error.message), opts);
      const store = new JobStateStore(parsed.data.project);
      const orch = new JobOrchestrator(store);
      const state = orch.init(parsed.data);
      printResult(prog, ok({ jobId: state.jobId, sliceCount: state.slices.length, statePath: `${parsed.data.project}/.peaks/_runtime/${state.sessionId}/job/${state.jobId}/state.json` }), opts);
    });

  job
    .command('status')
    .requiredOption('--job-id <jid>')
    .option('--watch', 'poll every 3s')
    .option('--show-cost', 'overlay cost from peaks budget')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      if (opts.watch) {
        // ANSI progress bar; short-lived loop
        const draw = () => {
          const bar = `[${'='.repeat(s.done)}${' '.repeat(s.total - s.done)}]`;
          process.stdout.write(`\rjob ${opts.jobId}: ${bar} ${s.done}/${s.total}${s.currentSlice ? ` next=${s.currentSlice}` : ''}    `);
        };
        draw();
        const iv = setInterval(() => { const u = orch.status(opts.jobId); Object.assign(s, u); draw(); if (u.done + u.failed + u.skipped + u.blocked >= u.total) clearInterval(iv); }, 3000);
        process.on('SIGINT', () => { clearInterval(iv); process.stdout.write('\n'); process.exit(0); });
        return;
      }
      printResult(prog, ok(s), opts);
    });

  // Stubs for now — implementation lands in M5 (subagent-cleanup) and M4 (rotate-now).
  job.command('rotate-now').requiredOption('--job-id <jid>').option('--project <repo>').addJsonOption().action(async (opts) => { const r = await rotateNowImpl(opts.jobId, projectRoot(opts)); printResult(prog, r, opts); });
  job.command('subagent-cleanup').requiredOption('--job-id <jid>').requiredOption('--batch-id <bid>').option('--force').option('--project <repo>').addJsonOption().action(async (opts) => { const r = await subagentCleanupImpl(opts.jobId, opts.batchId); printResult(prog, r, opts); });

  prog.registerCommand(job);
}
```

(Note: `prog.registerCommand(job)` — adjust to whatever pattern `src/cli/index.ts` uses; the dedicated test above reads via `prog.commands.find`, so the registration shape only needs to land `job` somewhere reachable through the program's commands array.)

- [ ] **Step 5: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/cli/commands/job-commands.test.ts`
Expected: PASS — 3 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/job-commands.ts tests/unit/cli/commands/job-commands.test.ts src/cli/index.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): CLI scaffolding for `peaks job` (init+status wired; 9 subcommand slots) (M3.1)"
```

---

## Task 3.2: Wire `checkpoint`, `block`, `continue`, `resume`, `handoff`

**Files:**
- Modify: `src/cli/commands/job-commands.ts` (+5 subcommand handlers)
- Test: `tests/unit/cli/commands/job-commands-2.test.ts` (extending coverage)

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/cli/commands/job-commands-2.test.ts
import { describe, it, expect } from 'vitest';
import { registerJobCommands } from '../../../../src/cli/commands/job-commands.js';
import { Command } from 'commander';

function freshProgram(): Command { const p = new Command(); registerJobCommands(p); return p; }

describe('peaks job — round-trip commands', () => {
  it('checkpoint --help documents --commit-sha and --reason', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'checkpoint')!;
    const h = cmd.helpInformation();
    expect(h).toContain('--commit-sha');
    expect(h).toContain('--reason');
    expect(h).toContain('<done|failed|skipped>');
  });

  it('block --reason is required (Commander marks it)', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'block')!;
    const required = (cmd as any).options.filter((o: any) => o.required).map((o: any) => o.long);
    expect(required).toContain('--reason');
  });

  it('handoff mentions --job-id', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'handoff')!;
    expect(cmd.helpInformation()).toContain('--job-id');
  });
});
```

- [ ] **Step 2: Run (expect FAIL until implementation)**

Run: `pnpm vitest run tests/unit/cli/commands/job-commands-2.test.ts`
Expected: FAIL — checkpoint / block / handoff not yet registered.

- [ ] **Step 3: Add the 5 subcommand handlers**

Append to `src/cli/commands/job-commands.ts`:

```typescript
  job
    .command('checkpoint')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--state <done|failed|skipped>')
    .option('--commit-sha <sha>')
    .option('--reason <text>')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const parsed = JobCheckpointInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, state: opts.state,
        commitSha: opts.commitSha, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(prog, fail('invalid-checkpoint', parsed.error.message), opts);
      const store = new JobStateStore(parsed.data.project);
      const orch = new JobOrchestrator(store);
      let next;
      if (parsed.data.state === 'done') next = await orch.checkpointDone(parsed.data);
      else if (parsed.data.state === 'skipped') next = await orch.checkpointSkipped(parsed.data);
      else next = await orch.checkpointFailed(parsed.data);
      printResult(prog, ok({ sliceId: parsed.data.sliceId, status: parsed.data.state }), opts);
    });

  job
    .command('block')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--reason <text>')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const parsed = JobBlockInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(prog, fail('invalid-block', parsed.error.message), opts);
      const store = new JobStateStore(parsed.data.project);
      const orch = new JobOrchestrator(store);
      await orch.blockSlice(parsed.data);
      printResult(prog, ok({ blocked: parsed.data.sliceId, reason: parsed.data.reason }), opts);
    });

  job
    .command('continue')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const r = orch.continueNow(opts.jobId);
      printResult(prog, ok(r), opts);
    });

  job
    .command('resume')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(prog, ok({ resumed: opts.jobId, ...s }), opts);
    });

  job
    .command('handoff')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .addJsonOption()
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(prog, ok({ handoffFor: opts.jobId, ...s }), opts);
    });
```

- [ ] **Step 4: Run both CLI test files (expect PASS)**

Run:
```bash
pnpm vitest run tests/unit/cli/commands/job-commands.test.ts tests/unit/cli/commands/job-commands-2.test.ts
```
Expected: PASS — 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/job-commands.ts tests/unit/cli/commands/job-commands-2.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): CLI checkpoint / block / continue / resume / handoff (M3.2)"
```

---

## Task 3.3: Enable help-text snapshot (M1.2)

**Files:**
- Modify: `tests/unit/cli/commands/job-help-snapshot.test.ts` (remove `it.skip`)
- Add: `tests/unit/cli/commands/__snapshots__/job-help.txt` (generated)

- [ ] **Step 1: Generate help text snapshot**

Run:
```bash
pnpm tsx src/cli/index.ts job --help > tests/unit/cli/commands/__snapshots__/job-help.txt 2>&1 || true
pnpm tsx src/cli/index.ts job init --help >> tests/unit/cli/commands/__snapshots__/job-help.txt 2>&1 || true
pnpm tsx src/cli/index.ts job status --help >> tests/unit/cli/commands/__snapshots__/job-help.txt 2>&1 || true
```

Expected: three well-formed help blocks in the file.

- [ ] **Step 2: Remove `it.skip` from M1.2**

Edit `tests/unit/cli/commands/job-help-snapshot.test.ts` to remove `it.skip` (use `it(...)`). Re-run the assertions.

- [ ] **Step 3: Run (expect PASS)**

Run: `pnpm vitest run tests/unit/cli/commands/job-help-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/cli/commands/job-help-snapshot.test.ts tests/unit/cli/commands/__snapshots__/job-help.txt
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "test(job): enable CLI help-text snapshot (M3.3)"
```

---

## M3 done

Outputs:
- `src/cli/commands/job-commands.ts` (~280 LoC)
- 9 subcommands wired (5 full + 2 stubs)
- 9 cases of CLI tests
- Help snapshot enabled

Verification: AC-1 (9 subcommands callable + help), AC-14 partial (--watch renders ANSI). Onward to M4 (Solo SKILL.md integration + rotation).
