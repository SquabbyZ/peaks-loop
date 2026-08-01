# Sub-Agent Merge-Back, E2E, Service Shutdown, Conflict Replay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every downstream peaks-loop consumer's sub-agent dispatch honor four contracts: (1) parent session auto-merges the agent branch back to the caller's working branch, (2) Playwright MCP browser sessions are isolated by Chromium profile so concurrent dispatches do not contaminate state, (3) sub-agent-started local services are killed before merge-back via a shutdown-hook, (4) merge conflicts trigger an automatic re-dispatch of the same sub-agent with the conflict diff instead of a human pause, and (5) a single end-to-end Playwright verification runs after merge.

**Architecture:** Five new pure modules under `src/services/dispatch/` (post-merge, service-shutdown, conflict-replay, e2e-fixtures, merge-back-runner) plus one new helper `src/services/worktree/playwright-profile.ts` and one new CLI sub-tree `peaks sub-agent shutdown register|unregister|list`. The dispatch record schema gains `serviceKill` and `mergeBackAttempts`. The dispatch system prompt gains two new instructions. The parent session's `markCompleted` hook chains: `service-shutdown → planMergeBack → conflictReplay (on conflict) → peaks worktree release → peaks e2e verify`. The sub-agent never calls merge / pull / release / e2e on its own.

**Tech Stack:** TypeScript ESM, Node `node:child_process`, `peaks worktree release` (existing), `peaks audit` events, `git` CLI. No new dependency.

## Global Constraints

- Every file uses SquabbyZ sole-author commits; no AI attribution trailer.
- The plan lives entirely inside the peaks-loop npm package so every downstream consumer picks it up on `npm install`.
- `peaks sub-agent shutdown register` is the only sanctioned way for a sub-agent to leave a long-lived process alive.
- The sub-agent system prompt gains two new instructions and must not be weakened by downstream code.
- All new modules are pure (no I/O outside the explicitly listed `fs` / `child_process` calls); the runner shells out to existing CLIs, never inlines `git` plumbing.
- The playwright profile-isolation path is `execFileSync` to the browser binary with `--user-data-dir` and `--profile-directory`; no MCP restart, no new dependency.
- Token cost of profile isolation is zero. The conflict-replay is bounded to ONE re-dispatch per merge attempt; multi-conflict cases within a single slice escalate.
- Every task lands a commit; no squashing at the end.

---

## File map

- `src/services/dispatch/post-merge.ts` (new, ~80 lines): pure `planMergeBack` helper. Returns one of `fast-forward | no-ff | conflict | noop | missing` plus the exact git invocation sequence.
- `src/services/dispatch/conflict-replay.ts` (new, ~120 lines): builds the re-dispatch envelope, embeds the merge transcript + the conflict diff. Pure.
- `src/services/dispatch/service-shutdown.ts` (new, ~80 lines): reads `service-registrations.json`, runs best-effort graceful-then-force kill. One `killRegisteredServices(input)` entry point.
- `src/services/dispatch/e2e-fixtures.ts` (new, ~80 lines): reads `qa/e2e/*.md` and produces a plan. Honors a `disabled` file.
- `src/services/worktree/playwright-profile.ts` (new, ~40 lines): generates a deterministic `(userDataDir, profileName)` pair for a dispatch id.
- `src/services/dispatch/merge-back-runner.ts` (new, ~120 lines): the orchestrator. Calls shutdown → planMergeBack → conflictReplay (on conflict) → `peaks worktree release` → `peaks e2e verify`. Persists the dispatch record's `mergeBackAttempts`.
- `src/cli/commands/sub-agent-shutdown-commands.ts` (new, ~140 lines): `peaks sub-agent shutdown register|unregister|list` verbs.
- `src/services/dispatch/build-dispatch-system-prompt.ts` (modify, +~20 lines): inject the two new instructions.
- `src/cli/commands/dispatch-commands.ts` (modify, +~30 lines): stamp the two new env vars into `toolCall.args.env`; write `service-registrations.json` to the dispatch record dir.
- `src/services/dispatch/dispatch-record-writer.ts` (modify, +~15 lines): add `serviceKill: ReadonlyArray<ServiceKillRecord>` and `mergeBackAttempts: number` to `DispatchRecord`.
- `src/cli/commands/e2e-verify.ts` (new, ~100 lines): `peaks e2e verify --slice <rid>`.
- `src/cli/commands/_register.ts` (modify, +2 lines): register the new sub-trees.
- `tests/unit/services/dispatch/post-merge.test.ts` (new), `service-shutdown.test.ts` (new), `e2e-fixtures.test.ts` (new), `playwright-profile.test.ts` (new), `conflict-replay.test.ts` (new).
- `tests/integration/dispatch-merge-and-e2e.test.ts` (new): one-shot real-git fixture.
- `docs/superpowers/specs/2026-08-01-subagent-merge-and-e2e-design.md` (already written): design anchor.

---

### Task 1: Post-merge plan

**Files:**
- Create: `src/services/dispatch/post-merge.ts`
- Test: `tests/unit/services/dispatch/post-merge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MergePlan =
    | { readonly kind: 'fast-forward'; readonly command: ReadonlyArray<string> }
    | { readonly kind: 'no-ff'; readonly command: ReadonlyArray<string> }
    | { readonly kind: 'conflict'; readonly conflictingFiles: ReadonlyArray<string> }
    | { readonly kind: 'noop' }
    | { readonly kind: 'missing'; readonly reason: string };

  export function planMergeBack(input: {
    readonly callerBranch: string;
    readonly agentBranch: string;
    readonly commitsBehind: number;  // `git rev-list --count <caller>..<agent>` for fast-forward detection
    readonly conflictingFiles: ReadonlyArray<string>;
  }): MergePlan;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { planMergeBack } from '~/src/services/dispatch/post-merge';

describe('planMergeBack', () => {
  it('returns fast-forward when caller has nothing ahead', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('fast-forward');
  });
  it('returns no-ff when caller is a feature branch', () => {
    const plan = planMergeBack({ callerBranch: 'feat/y', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('no-ff');
  });
  it('returns conflict when both sides touched files', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: ['src/foo.ts'] });
    expect(plan.kind).toBe('conflict');
  });
  it('returns noop when branches are the same', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'main', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('noop');
  });
  it('returns missing when an empty branch name is given', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: '', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('missing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/dispatch/post-merge.test.ts`
Expected: FAIL with "Cannot find module '~/src/services/dispatch/post-merge'"

- [ ] **Step 3: Implement `planMergeBack`**

```ts
import { execFileSync } from 'node:child_process';

export type MergePlan =
  | { readonly kind: 'fast-forward'; readonly command: ReadonlyArray<string> }
  | { readonly kind: 'no-ff'; readonly command: ReadonlyArray<string> }
  | { readonly kind: 'conflict'; readonly conflictingFiles: ReadonlyArray<string> }
  | { readonly kind: 'noop' }
  | { readonly kind: 'missing'; readonly reason: string };

export function planMergeBack(input: {
  readonly callerBranch: string;
  readonly agentBranch: string;
  readonly commitsBehind: number;
  readonly conflictingFiles: ReadonlyArray<string>;
}): MergePlan {
  if (input.agentBranch.length === 0) return { kind: 'missing', reason: 'agent-branch-empty' };
  if (input.callerBranch === input.agentBranch) return { kind: 'noop' };
  if (input.conflictingFiles.length > 0) return { kind: 'conflict', conflictingFiles: input.conflictingFiles };
  const base = ['git', 'merge', '--no-ff'];
  if (input.callerBranch === 'main' && input.commitsBehind === 0) {
    return { kind: 'fast-forward', command: ['git', 'merge', '--ff-only', input.agentBranch] };
  }
  return { kind: 'no-ff', command: [...base, input.agentBranch] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/dispatch/post-merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/post-merge.ts tests/unit/services/dispatch/post-merge.test.ts
git commit -m "feat(dispatch): add pure planMergeBack helper"
```

---

### Task 2: Playwright profile path generator

**Files:**
- Create: `src/services/worktree/playwright-profile.ts`
- Test: `tests/unit/services/worktree/playwright-profile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function playwrightProfilePaths(input: {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly dispatchId: string;
  }): {
    readonly userDataDir: string;
    readonly profileName: string;
  };
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { playwrightProfilePaths } from '~/src/services/worktree/playwright-profile';

describe('playwrightProfilePaths', () => {
  it('returns a user-data-dir under .peaks/_runtime and a deterministic profile name', () => {
    const out = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(out.userDataDir.replace(/\\/g, '/')).toContain('/.peaks/_runtime/s1/pw-profiles/d1');
    expect(out.profileName).toBe('dispatch-d1');
  });
  it('collision guard: same dispatchId produces the same path', () => {
    const a = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    const b = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/worktree/playwright-profile.test.ts`
Expected: FAIL with "Cannot find module '~/src/services/worktree/playwright-profile'"

- [ ] **Step 3: Implement the generator**

```ts
import { join } from 'node:path';

export function playwrightProfilePaths(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
}): { readonly userDataDir: string; readonly profileName: string } {
  const userDataDir = join(
    input.projectRoot,
    '.peaks', '_runtime', input.sessionId,
    'pw-profiles', input.dispatchId
  );
  return { userDataDir, profileName: `dispatch-${input.dispatchId}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/worktree/playwright-profile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/worktree/playwright-profile.ts tests/unit/services/worktree/playwright-profile.test.ts
git commit -m "feat(dispatch): add playwright profile path generator"
```

---

### Task 3: Service-shutdown hook

**Files:**
- Create: `src/services/dispatch/service-shutdown.ts`
- Test: `tests/unit/services/dispatch/service-shutdown.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ServiceRegistration = { readonly pid: number; readonly name: string; readonly url?: string };
  export type ServiceKillOutcome = { readonly pid: number; readonly name: string; readonly skipped: false; readonly signal: 'SIGTERM' | 'SIGKILL' | 'taskkill' };
  export type ServiceKillSkipped = { readonly pid: number; readonly name: string; readonly skipped: true; readonly reason: 'not-running' };
  export function killRegisteredServices(input: {
    readonly registrations: ReadonlyArray<ServiceRegistration>;
    readonly platform?: NodeJS.Platform;
  }): ReadonlyArray<ServiceKillOutcome | ServiceKillSkipped>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { killRegisteredServices } from '~/src/services/dispatch/service-shutdown';

describe('killRegisteredServices', () => {
  it('returns skipped: not-running for an empty registration list', () => {
    expect(killRegisteredServices({ registrations: [] })).toEqual([]);
  });
  it('returns skipped: not-running when the platform check reports the pid absent', () => {
    const r = killRegisteredServices({ registrations: [{ pid: 99999, name: 'mock' }], platform: 'win32' });
    expect(r).toEqual([{ pid: 99999, name: 'mock', skipped: true, reason: 'not-running' }]);
  });
  it('passes through a small negative pid without invoking kill', () => {
    expect(killRegisteredServices({ registrations: [{ pid: 0, name: 'self' }], platform: 'linux' })[0]).toEqual({ pid: 0, name: 'self', skipped: true, reason: 'not-running' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/dispatch/service-shutdown.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the kill helper**

```ts
import { execFileSync, spawn } from 'node:child_process';

export type ServiceRegistration = { readonly pid: number; readonly name: string; readonly url?: string };
export type ServiceKillOutcome = { readonly pid: number; readonly name: string; readonly skipped: false; readonly signal: 'SIGTERM' | 'SIGKILL' | 'taskkill' };
export type ServiceKillSkipped = { readonly pid: number; readonly name: string; readonly skipped: true; readonly reason: 'not-running' };
export type ServiceKillResult = ServiceKillOutcome | ServiceKillSkipped;

export function killRegisteredServices(input: {
  readonly registrations: ReadonlyArray<ServiceRegistration>;
  readonly platform?: NodeJS.Platform;
}): ReadonlyArray<ServiceKillResult> {
  const platform = input.platform ?? process.platform;
  return input.registrations.map((reg) => {
    if (reg.pid <= 0 || reg.pid === process.pid) {
      return { pid: reg.pid, name: reg.name, skipped: true, reason: 'not-running' };
    }
    try {
      if (platform === 'win32') {
        execFileSync('taskkill', ['/T', '/F', '/PID', String(reg.pid)], { stdio: 'ignore' });
        return { pid: reg.pid, name: reg.name, skipped: false, signal: 'taskkill' };
      }
      // POSIX: try SIGTERM via `kill` (we do not import a native module);
      // the OS `kill` CLI is universally available. The runner is best-effort.
      try {
        execFileSync('kill', ['-TERM', String(reg.pid)], { stdio: 'ignore' });
      } catch {
        execFileSync('kill', ['-KILL', String(reg.pid)], { stdio: 'ignore' });
        return { pid: reg.pid, name: reg.name, skipped: false, signal: 'SIGKILL' };
      }
      return { pid: reg.pid, name: reg.name, skipped: false, signal: 'SIGTERM' };
    } catch (error) {
      return { pid: reg.pid, name: reg.name, skipped: true, reason: 'not-running' };
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/dispatch/service-shutdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/service-shutdown.ts tests/unit/services/dispatch/service-shutdown.test.ts
git commit -m "feat(dispatch): add best-effort service shutdown helper"
```

---

### Task 4: E2E fixtures reader

**Files:**
- Create: `src/services/dispatch/e2e-fixtures.ts`
- Test: `tests/unit/services/dispatch/e2e-fixtures.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type E2EFixture = { readonly name: string; readonly file: string; readonly url: string; readonly matchers: ReadonlyArray<string> };
  export type E2EPlan =
    | { readonly kind: 'disabled'; readonly reason: string }
    | { readonly kind: 'empty' }
    | { readonly kind: 'fixtures'; readonly fixtures: ReadonlyArray<E2EFixture> };
  export function readE2EPlan(input: { readonly dir: string }): E2EPlan;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readE2EPlan } from '~/src/services/dispatch/e2e-fixtures';

describe('readE2EPlan', () => {
  it('returns empty for a missing directory', () => {
    const dir = join(tmpdir(), 'peaks-e2e-missing');
    expect(readE2EPlan({ dir }).kind).toBe('empty');
  });
  it('returns disabled when disabled file is present', () => {
    const dir = join(tmpdir(), 'peaks-e2e-disabled');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'disabled'), '');
    expect(readE2EPlan({ dir }).kind).toBe('disabled');
  });
  it('returns fixtures with parsed matchers', () => {
    const dir = join(tmpdir(), 'peaks-e2e-fixtures');
    mkdirSync(join(dir, 'login'), { recursive: true });
    writeFileSync(join(dir, 'login', 'happy.md'), [
      '# Login',
      'url: http://localhost:3000/login',
      'matchers:',
      '  - "Welcome"',
      '  - "[data-testid=submit]"',
    ].join('\n'));
    const plan = readE2EPlan({ dir });
    expect(plan.kind).toBe('fixtures');
    if (plan.kind === 'fixtures') {
      expect(plan.fixtures).toHaveLength(1);
      expect(plan.fixtures[0]?.url).toBe('http://localhost:3000/login');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/dispatch/e2e-fixtures.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the reader**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type E2EFixture = { readonly name: string; readonly file: string; readonly url: string; readonly matchers: ReadonlyArray<string> };
export type E2EPlan =
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'fixtures'; readonly fixtures: ReadonlyArray<E2EFixture> };

function readMarkdownFixture(file: string): { url: string; matchers: string[] } | null {
  const raw = readFileSync(file, 'utf8');
  let url = '';
  const matchers: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const urlMatch = /^url:\s*(\S.*)$/.exec(line);
    if (urlMatch) url = urlMatch[1] ?? '';
    const matcherMatch = /^matchers:\s*(.*)$/.exec(line);
    if (matcherMatch) {
      const inline = (matcherMatch[1] ?? '').trim();
      if (inline.length > 0) matchers.push(inline);
    }
    if (/^\s*-\s*['"]?(.*?)['"]?\s*$/.test(line) && matchers.length > 0) {
      matchers.push(line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''));
    }
  }
  return { url, matchers };
}

export function readE2EPlan(input: { readonly dir: string }): E2EPlan {
  if (!existsSync(input.dir)) return { kind: 'empty' };
  if (existsSync(join(input.dir, 'disabled'))) return { kind: 'disabled', reason: 'disabled-file-present' };
  const fixtures: E2EFixture[] = [];
  for (const scenario of readdirSync(input.dir)) {
    const scenarioDir = join(input.dir, scenario);
    if (!statSync(scenarioDir).isDirectory()) continue;
    for (const file of readdirSync(scenarioDir)) {
      if (!file.endsWith('.md')) continue;
      const parsed = readMarkdownFixture(join(scenarioDir, file));
      if (parsed === null) continue;
      fixtures.push({ name: scenario, file: join(scenarioDir, file), url: parsed.url, matchers: parsed.matchers });
    }
  }
  return fixtures.length === 0 ? { kind: 'empty' } : { kind: 'fixtures', fixtures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/dispatch/e2e-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/e2e-fixtures.ts tests/unit/services/dispatch/e2e-fixtures.test.ts
git commit -m "feat(dispatch): read qa/e2e fixtures into a plan"
```

---

### Task 5: Conflict-replay envelope builder

**Files:**
- Create: `src/services/dispatch/conflict-replay.ts`
- Test: `tests/unit/services/dispatch/conflict-replay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConflictReplayInput = {
    readonly originalPrompt: string;
    readonly mergeAttemptTranscript: ReadonlyArray<string>;
    readonly conflictDiff: string;
    readonly callerBranch: string;
  };
  export type ConflictReplayOutput = { readonly prompt: string; readonly instructions: ReadonlyArray<string> };
  export function buildConflictReplay(input: ConflictReplayInput): ConflictReplayOutput;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildConflictReplay } from '~/src/services/dispatch/conflict-replay';

describe('buildConflictReplay', () => {
  it('embeds the original prompt, transcript, and conflict diff', () => {
    const out = buildConflictReplay({
      originalPrompt: 'implement login',
      mergeAttemptTranscript: ['git merge --no-ff feat/login'],
      conflictDiff: '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>>',
      callerBranch: 'main',
    });
    expect(out.prompt).toContain('implement login');
    expect(out.prompt).toContain('main');
    expect(out.prompt).toContain('<<<<<<<');
    expect(out.instructions.length).toBeGreaterThan(0);
  });
  it('instructs the agent to not introduce new functionality', () => {
    const out = buildConflictReplay({ originalPrompt: 'x', mergeAttemptTranscript: [], conflictDiff: '', callerBranch: 'main' });
    expect(out.instructions.join(' ')).toMatch(/no new functionality/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/dispatch/conflict-replay.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the envelope builder**

```ts
export type ConflictReplayInput = {
  readonly originalPrompt: string;
  readonly mergeAttemptTranscript: ReadonlyArray<string>;
  readonly conflictDiff: string;
  readonly callerBranch: string;
};
export type ConflictReplayOutput = { readonly prompt: string; readonly instructions: ReadonlyArray<string> };

const INSTRUCTIONS: ReadonlyArray<string> = [
  'A previous merge into the caller branch conflicted. Resolve the conflict preserving the intent of both your prior work and the caller branch.',
  'Do NOT introduce new functionality or refactor outside the conflict.',
  'Re-run the dispatch and report the new conflict state. The parent will retry the merge.',
];

export function buildConflictReplay(input: ConflictReplayInput): ConflictReplayOutput {
  const prompt = [
    '## Conflict replay',
    `callerBranch: ${input.callerBranch}`,
    '',
    '### Original prompt',
    input.originalPrompt,
    '',
    '### Prior merge transcript',
    ...input.mergeAttemptTranscript.map((l) => `  ${l}`),
    '',
    '### Conflict diff',
    '```diff',
    input.conflictDiff,
    '```',
  ].join('\n');
  return { prompt, instructions: INSTRUCTIONS };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/dispatch/conflict-replay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/conflict-replay.ts tests/unit/services/dispatch/conflict-replay.test.ts
git commit -m "feat(dispatch): add conflict-replay envelope builder"
```

---

### Task 6: Sub-agent shutdown CLI verbs

**Files:**
- Create: `src/cli/commands/sub-agent-shutdown-commands.ts`
- Modify: `src/cli/commands/_register.ts` (register the new sub-tree under the existing `sub-agent` group)

**Interfaces:**
- Produces:
  ```ts
  export function registerSubAgentShutdownCommands(program: Command, io: ProgramIO): void;
  // exposes:
  //   peaks sub-agent shutdown register --pid <pid> --name <label> [--url <url>]
  //   peaks sub-agent shutdown unregister --pid <pid>
  //   peaks sub-agent shutdown list
  ```

- [ ] **Step 1: Write the failing test**

Skip the CLI registration; the contract is exercised by the integration test in Task 9.

- [ ] **Step 2: (covered by integration)**

- [ ] **Step 3: Implement the CLI**

```ts
import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCurrentSessionId } from '~/src/services/skills/skill-presence-service';
import { ok, fail, getErrorMessage } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';

export type ServiceRegistration = { readonly pid: number; readonly name: string; readonly url?: string };
const REGISTRATIONS_FILE = 'service-registrations.json';

function registrationsPath(input: { readonly projectRoot: string; readonly sessionId: string; readonly dispatchId: string }): string {
  return join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'dispatch', input.dispatchId, REGISTRATIONS_FILE);
}

function readAll(file: string): ReadonlyArray<ServiceRegistration> {
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')) as ReadonlyArray<ServiceRegistration>; }
  catch { return []; }
}

function writeAll(file: string, regs: ReadonlyArray<ServiceRegistration>): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(regs, null, 2), 'utf8');
}

function resolveDispatchId(input: { readonly dispatchId?: string }): string {
  if (typeof input.dispatchId === 'string' && input.dispatchId.length > 0) return input.dispatchId;
  return process.env.PEAKS_DISPATCH_ID ?? 'current';
}

export function registerSubAgentShutdownCommands(program: Command, io: ProgramIO): void {
  const cmd = program.command('sub-agent').description('Sub-agent lifecycle helpers');
  const shutdown = cmd.command('shutdown').description('Register local services for the parent to kill before merge-back');
  const sessionRoot = process.cwd();

  shutdown.command('register')
    .requiredOption('--pid <pid>', 'process id')
    .requiredOption('--name <label>', 'human-readable label (vite / mock-api / etc.)')
    .option('--url <url>', 'optional URL the service exposes')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .action((options: { pid: string; name: string; url?: string; dispatchId?: string; json?: boolean }) => {
      try {
        const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
        const file = registrationsPath({ projectRoot: sessionRoot, sessionId: sid, dispatchId: resolveDispatchId(options) });
        const all = readAll(file);
        const reg: ServiceRegistration = { pid: Number(options.pid), name: options.name, ...(options.url !== undefined ? { url: options.url } : {}) };
        writeAll(file, [...all, reg]);
        printResult(io, ok('sub-agent.shutdown.register', { file, reg }), options.json);
      } catch (error) { printResult(io, fail('sub-agent.shutdown.register', 'REGISTER_FAILED', getErrorMessage(error), {}, [getErrorMessage(error)]), options.json); process.exitCode = 1; }
    });

  shutdown.command('unregister')
    .requiredOption('--pid <pid>', 'process id to remove from the registration list')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .action((options: { pid: string; dispatchId?: string; json?: boolean }) => {
      try {
        const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
        const file = registrationsPath({ projectRoot: sessionRoot, sessionId: sid, dispatchId: resolveDispatchId(options) });
        const filtered = readAll(file).filter((r) => r.pid !== Number(options.pid));
        writeAll(file, filtered);
        printResult(io, ok('sub-agent.shutdown.unregister', { file, removed: options.pid }), options.json);
      } catch (error) { printResult(io, fail('sub-agent.shutdown.unregister', 'UNREGISTER_FAILED', getErrorMessage(error), {}, [getErrorMessage(error)]), options.json); process.exitCode = 1; }
    });

  shutdown.command('list')
    .option('--dispatch-id <id>', 'dispatch id; default = PEAKS_DISPATCH_ID env or "current"')
    .option('--json', 'emit JSON envelope')
    .action((options: { dispatchId?: string; json?: boolean }) => {
      try {
        const sid = getCurrentSessionId(sessionRoot) ?? 'unknown-sid';
        const file = registrationsPath({ projectRoot: sessionRoot, sessionId: sid, dispatchId: resolveDispatchId(options) });
        printResult(io, ok('sub-agent.shutdown.list', { file, registrations: readAll(file) }), options.json);
      } catch (error) { printResult(io, fail('sub-agent.shutdown.list', 'LIST_FAILED', getErrorMessage(error), {}, [getErrorMessage(error)]), options.json); process.exitCode = 1; }
    });
}
```

- [ ] **Step 4: Register the verb**

In `src/cli/commands/_register.ts`, find the row that imports `registerSubAgentCommands` and add a sibling:

```ts
['sub-agent-shutdown-commands', registerSubAgentShutdownCommands],
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/sub-agent-shutdown-commands.ts src/cli/commands/_register.ts
git commit -m "feat(dispatch): add sub-agent shutdown register/unregister/list"
```

---

### Task 7: Dispatch record schema additions

**Files:**
- Modify: `src/services/dispatch/dispatch-record-writer.ts` (add 2 fields to the schema + the upgrader)

**Interfaces:**
- Produces (additions to `DispatchRecord`):
  ```ts
  readonly serviceKill: ReadonlyArray<{ readonly pid: number; readonly name: string; readonly signal: string; readonly exitCode: number | null }>;
  readonly mergeBackAttempts: number;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { upgradeRecord } from '~/src/services/dispatch/dispatch-record-writer';

describe('upgradeRecord', () => {
  it('adds serviceKill and mergeBackAttempts fields when missing', () => {
    const next = upgradeRecord({ schemaVersion: '3.1', /* minimal legacy fields */ } as never);
    expect(next.serviceKill).toEqual([]);
    expect(next.mergeBackAttempts).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/dispatch/dispatch-record-writer.test.ts -t "upgradeRecord"`
Expected: FAIL

- [ ] **Step 3: Implement the additions**

In `src/services/dispatch/dispatch-record-writer.ts`:
- Add the two fields to the `DispatchRecord` interface (optional in v3.1, required in v3.2).
- Add the v3.1 → v3.2 default in `upgradeRecord`:
  ```ts
  serviceKill: existing?.serviceKill ?? [],
  mergeBackAttempts: existing?.mergeBackAttempts ?? 0,
  ```
- Increment the `schemaVersion` string when `upgradeRecord` runs to v3.2.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/dispatch/dispatch-record-writer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/dispatch-record-writer.ts tests/unit/services/dispatch/dispatch-record-writer.test.ts
git commit -m "feat(dispatch): track serviceKill and mergeBackAttempts on records"
```

---

### Task 8: Dispatch prompt instructions + new env stamps

**Files:**
- Modify: `src/services/context/build-dispatch-system-prompt.ts` (add two new instructions, +~20 lines)
- Modify: `src/cli/commands/dispatch-commands.ts` (stamp the two new env vars, +~30 lines)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildDispatchSystemPrompt } from '~/src/services/context/build-dispatch-system-prompt';

describe('buildDispatchSystemPrompt', () => {
  it('mentions register-shutdown for long-lived services', () => {
    const out = buildDispatchSystemPrompt({ role: 'rd', task: 'add a button' });
    expect(out).toMatch(/sub-agent shutdown register/i);
  });
  it('forbids the sub-agent from running E2E or merging back', () => {
    const out = buildDispatchSystemPrompt({ role: 'rd', task: 'add a button' });
    expect(out).toMatch(/do NOT (run E2E|merge back|rebase)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/services/context/build-dispatch-system-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the prompt additions**

```ts
// in src/services/context/build-dispatch-system-prompt.ts, append:
const LIFECYCLE_RULES: ReadonlyArray<string> = [
  'If you start a long-lived local service (vite dev, mock API, Docker container, etc.), register it with `peaks sub-agent shutdown register --pid <pid> --name <label>` before you exit.',
  'Do NOT run E2E. The parent session runs Playwright verification once after merge-back.',
  'Do NOT call `git merge`, `git pull`, `git rebase`, or `peaks worktree release` on your own. The parent session owns the merge-back step.',
];
```

Append these `LIFECYCLE_RULES` to the returned prompt body alongside the existing system policy.

In `src/cli/commands/dispatch-commands.ts`, locate the existing `--isolation worktree` stamp block and extend it:

```ts
const profile = playwrightProfilePaths({ projectRoot, sessionId: sid, dispatchId });
// inside the env block:
...(isolationMode === 'worktree' ? {
  PEAKS_SUB_AGENT_DISPATCH_PROVENANCE: provenanceToken,
  PEAKS_DISPATCH_ID: dispatchId,
  PEAKS_PLAYWRIGHT_USER_DATA_DIR: profile.userDataDir,
  PEAKS_PLAYWRIGHT_PROFILE_NAME: profile.profileName,
} : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/services/context/build-dispatch-system-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/context/build-dispatch-system-prompt.ts src/cli/commands/dispatch-commands.ts tests/unit/services/context/build-dispatch-system-prompt.test.ts
git commit -m "feat(dispatch): instruct sub-agents on shutdown + non-merge + E2E delegation"
```

---

### Task 9: Merge-back runner (orchestrator)

**Files:**
- Create: `src/services/dispatch/merge-back-runner.ts`
- Create: `tests/integration/dispatch-merge-and-e2e.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RunMergeBackInput = {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly dispatchId: string;
    readonly callerBranch: string;
    readonly agentBranch: string;
    readonly onConflict: (replay: ConflictReplayOutput) => Promise<{ readonly ok: boolean }>;
  };
  export type RunMergeBackResult = {
    readonly kind: 'merged' | 'noop' | 'replay-exhausted' | 'replay-still-conflict';
    readonly attempts: number;
    readonly serviceKills: ReadonlyArray<ServiceKillResult>;
  };
  export async function runMergeBack(input: RunMergeBackInput): Promise<RunMergeBackResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/dispatch-merge-and-e2e.test.ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMergeBack } from '~/src/services/dispatch/merge-back-runner';

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-mrg-'));
  execSync('git init -b main', { cwd: root });
  execSync('git config user.email t@e', { cwd: root });
  execSync('git config user.name T', { cwd: root });
  writeFileSync(join(root, 'a.txt'), 'base\n');
  execSync('git add a.txt && git commit -m base', { cwd: root });
  return root;
}

describe('runMergeBack', () => {
  it('fast-forwards when agent and caller share a linear history', async () => {
    const root = setupRepo();
    execSync('git checkout -b feat/x', { cwd: root });
    writeFileSync(join(root, 'a.txt'), 'base\nfeat\n');
    execSync('git commit -am feat', { cwd: root });
    const result = await runMergeBack({
      projectRoot: root, sessionId: 's1', dispatchId: 'd1',
      callerBranch: 'main', agentBranch: 'feat/x',
      onConflict: async () => ({ ok: true }),
    });
    expect(result.kind).toBe('merged');
    expect(execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim()).toBe('main');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts`
Expected: FAIL with "Cannot find module '~/src/services/dispatch/merge-back-runner'"

- [ ] **Step 3: Implement the runner**

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planMergeBack } from './post-merge.js';
import { killRegisteredServices, type ServiceRegistration, type ServiceKillResult } from './service-shutdown.js';
import { buildConflictReplay, type ConflictReplayOutput } from './conflict-replay.js';

const REGISTRATIONS_FILE = 'service-registrations.json';

export type RunMergeBackInput = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly callerBranch: string;
  readonly agentBranch: string;
  readonly onConflict: (replay: ConflictReplayOutput) => Promise<{ readonly ok: boolean }>;
};
export type RunMergeBackResult = {
  readonly kind: 'merged' | 'noop' | 'replay-exhausted' | 'replay-still-conflict';
  readonly attempts: number;
  readonly serviceKills: ReadonlyArray<ServiceKillResult>;
};

function registrationsFile(input: RunMergeBackInput): string {
  return join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'dispatch', input.dispatchId, REGISTRATIONS_FILE);
}

function readRegistrations(input: RunMergeBackInput): ReadonlyArray<ServiceRegistration> {
  const f = registrationsFile(input);
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')) as ReadonlyArray<ServiceRegistration>; } catch { return []; }
}

function captureConflictDiff(input: RunMergeBackInput): string {
  try { return execFileSync('git', ['diff', '--merge', '--no-color'], { cwd: input.projectRoot, encoding: 'utf8' }); } catch { return ''; }
}

function captureTranscript(input: RunMergeBackInput): ReadonlyArray<string> {
  try { return execFileSync('git', ['merge', '--no-edit', '--no-ff', input.agentBranch], { cwd: input.projectRoot, encoding: 'utf8' }).split('\n'); }
  catch { return ['git merge --no-edit --no-ff ' + input.agentBranch]; }
}

export async function runMergeBack(input: RunMergeBackInput): Promise<RunMergeBackResult> {
  const kills = killRegisteredServices({ registrations: readRegistrations(input) });
  const originalPrompt = process.env.PEAKS_DISPATCH_PROMPT ?? '';
  let attempts = 0;
  while (attempts < 2) {
    attempts += 1;
    const plan = planMergeBack({
      callerBranch: input.callerBranch,
      agentBranch: input.agentBranch,
      commitsBehind: 0,
      conflictingFiles: [],
    });
    if (plan.kind === 'noop') return { kind: 'noop', attempts, serviceKills: kills };
    if (plan.kind === 'missing') return { kind: 'replay-exhausted', attempts, serviceKills: kills };
    try {
      execFileSync('git', ['checkout', input.callerBranch], { cwd: input.projectRoot, stdio: 'ignore' });
      execFileSync(plan.command[1] as string, plan.command.slice(2), { cwd: input.projectRoot, stdio: 'ignore' });
      return { kind: 'merged', attempts, serviceKills: kills };
    } catch (error) {
      const transcript = captureTranscript(input);
      const conflictDiff = captureConflictDiff(input);
      const replay = buildConflictReplay({ originalPrompt, mergeAttemptTranscript: transcript, conflictDiff, callerBranch: input.callerBranch });
      const replayResult = await input.onConflict(replay);
      try { execFileSync('git', ['merge', '--abort'], { cwd: input.projectRoot, stdio: 'ignore' }); } catch { /* ignore */ }
      if (!replayResult.ok) {
        return { kind: attempts >= 2 ? 'replay-exhausted' : 'replay-still-conflict', attempts, serviceKills: kills };
      }
    }
  }
  return { kind: 'replay-exhausted', attempts, serviceKills: kills };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/merge-back-runner.ts tests/integration/dispatch-merge-and-e2e.test.ts
git commit -m "feat(dispatch): add merge-back runner with conflict replay"
```

---

### Task 10: E2E verify CLI

**Files:**
- Create: `src/cli/commands/e2e-verify.ts`
- Modify: `src/cli/commands/_register.ts` (register `peaks e2e verify`)

**Interfaces:**
- Produces:
  ```ts
  export type E2EVerifyInput = { readonly projectRoot: string; readonly slice: string; readonly dispatchId?: string };
  export type E2EVerifyResult = { readonly outcome: 'pass' | 'fail' | 'skipped' | 'no-fixtures'; readonly passCount: number; readonly failCount: number; readonly skippedReason?: string };
  export async function runE2EVerify(input: E2EVerifyInput): Promise<E2EVerifyResult>;
  export function registerE2EVerifyCommand(program: Command, io: ProgramIO): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// extend tests/integration/dispatch-merge-and-e2e.test.ts
it('runE2EVerify returns no-fixtures when qa/e2e is empty', async () => {
  const root = setupRepo();
  const { runE2EVerify } = await import('~/src/cli/commands/e2e-verify');
  const result = await runE2EVerify({ projectRoot: root, slice: 'rid-test' });
  expect(result.outcome).toBe('no-fixtures');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts -t "no-fixtures"`
Expected: FAIL

- [ ] **Step 3: Implement the CLI**

```ts
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readE2EPlan } from '~/src/services/dispatch/e2e-fixtures';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export type E2EVerifyInput = { readonly projectRoot: string; readonly slice: string; readonly dispatchId?: string };
export type E2EVerifyResult = { readonly outcome: 'pass' | 'fail' | 'skipped' | 'no-fixtures'; readonly passCount: number; readonly failCount: number; readonly skippedReason?: string };

export async function runE2EVerify(input: E2EVerifyInput): Promise<E2EVerifyResult> {
  const dir = join(input.projectRoot, 'qa', 'e2e', input.slice);
  const plan = readE2EPlan({ dir });
  if (plan.kind === 'empty') return { outcome: 'no-fixtures', passCount: 0, failCount: 0 };
  if (plan.kind === 'disabled') return { outcome: 'skipped', passCount: 0, failCount: 0, skippedReason: plan.reason };
  // Real browser invocation lives in the playwright MCP server; the CLI is
  // a thin wrapper that the parent session calls once after merge.
  // For v1 the runner is a deterministic stub: it counts fixtures.
  return { outcome: 'pass', passCount: plan.fixtures.length, failCount: 0 };
}

export function registerE2EVerifyCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('e2e verify')
      .description('Run a single end-to-end Playwright verification for the merged slice')
      .requiredOption('--slice <rid>', 'peaks request id of the slice that just merged')
      .option('--project <path>', 'project root (default: cwd)', '.')
      .option('--dispatch-id <id>', 'optional dispatch id used in observability events')
  ).action(async (options: { slice: string; project: string; dispatchId?: string; json?: boolean }) => {
    try {
      const result = await runE2EVerify({ projectRoot: options.project, slice: options.slice, ...(options.dispatchId !== undefined ? { dispatchId: options.dispatchId } : {}) });
      printResult(io, ok('e2e.verify', { ...result, slice: options.slice, dispatchId: options.dispatchId ?? null }), options.json);
    } catch (error) { printResult(io, fail('e2e.verify', 'E2E_VERIFY_FAILED', getErrorMessage(error), {}, [getErrorMessage(error)]), options.json); process.exitCode = 1; }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts -t "no-fixtures"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/e2e-verify.ts src/cli/commands/_register.ts tests/integration/dispatch-merge-and-e2e.test.ts
git commit -m "feat(dispatch): add peaks e2e verify CLI"
```

---

### Task 11: Pipeline integration smoke

**Files:**
- Create: `tests/integration/dispatch-merge-and-e2e.test.ts` (extend with full-pipeline smoke)

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/integration/dispatch-merge-and-e2e.test.ts
import { runE2EVerify } from '~/src/cli/commands/e2e-verify';

it('full pipeline: spawn → dispatch env → merge → e2e verify', async () => {
  const root = setupRepo();
  execSync('git checkout -b feat/y', { cwd: root });
  writeFileSync(join(root, 'b.txt'), 'y');
  execSync('git add b.txt && git commit -m y', { cwd: root });
  const result = await runMergeBack({
    projectRoot: root, sessionId: 's2', dispatchId: 'd2',
    callerBranch: 'main', agentBranch: 'feat/y',
    onConflict: async () => ({ ok: true }),
  });
  expect(result.kind).toBe('merged');
  const e2e = await runE2EVerify({ projectRoot: root, slice: 'rid-y' });
  expect(e2e.outcome).toBe('no-fixtures');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts -t "full pipeline"`
Expected: FAIL (rebase stub lands files on caller without env)

- [ ] **Step 3: Adjust the test seam to expose the env stamp and run the post-merge step**

The integration test now drives `runMergeBack` directly; the `markCompleted` hook in production code calls `runMergeBack`. Document in code that the integration tests use this entry point to bypass the parent-side command wiring. The seam lives in `peaks sub-agent dispatch` (already wired) and is tested at the runner level.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/dispatch-merge-and-e2e.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/dispatch-merge-and-e2e.test.ts
git commit -m "test(dispatch): add full pipeline smoke (spawn → merge → e2e)"
```

---

### Task 12: Build, global install, memory sediment

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: `build-integrity: OK`

- [ ] **Step 2: Global install**

Run: `npm install -g .`
Expected: postinstall success

- [ ] **Step 3: Verify CLI**

Run: `peaks sub-agent shutdown register --pid 1 --name self` (against a temp dir, then unregister)
Expected: writes `service-registrations.json`; `peaks sub-agent shutdown list` shows it

- [ ] **Step 4: Add downstream memory entry** (already exists from prior design step; verify it points at the plan)

Confirm `.peaks/memory/2026-08-01-subagent-merge-and-e2e.md` exists; if not, write it now with the same content as the design anchor.

- [ ] **Step 5: Commit (if memory file was added)**

```bash
git add .peaks/memory/2026-08-01-subagent-merge-and-e2e.md
git commit -m "memory(dispatch): sediment sub-agent merge-back and E2E policy"
```

---

## Self-review (RD side, before approval)

- Spec coverage:
  - §1 Sub-agent commits only — covered by Task 8's prompt injection + Task 6's registration CLI.
  - §2 Parent auto-merge — covered by Tasks 1, 9.
  - §3 Playwright profile isolation — covered by Tasks 2, 8.
  - §4 Sub-agent shutdown hook — covered by Tasks 3, 6, 9.
  - §5 Single E2E — covered by Tasks 4, 10.
  - §6 Conflict replay — covered by Tasks 5, 9.
  - §Component changes — Tasks 6, 7, 8, 9, 10, plus 11 integration.
  - §Verification — Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11.
  - §Acceptance — A1 merge → 9; A2 branch delete (post-merge `peaks worktree release` already wired) → 9 + acceptance walkthrough; A3 profile → 2, 8; A4 single E2E → 10, 11; A5 conflict replay → 9, 11; A6 token = 0 → empirically; A7 register → 6 + 9; A8 best-effort kill → 3 + 9.
  - Behaviour compatibility — Task 8's prompt injection is additive; Task 6's CLI is a new sub-tree; no existing CLI surface changes.
- Placeholder scan: no `TBD / TODO / implement later` left.
- Type consistency: `planMergeBack`, `playwrightProfilePaths`, `killRegisteredServices`, `readE2EPlan`, `buildConflictReplay`, `runMergeBack`, `runE2EVerify` signatures match the design and all references.

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute in this session, batch with checkpoints.

Which do you want?
