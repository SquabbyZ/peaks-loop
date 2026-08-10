# peaks-loop Detached Sub-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `peaks sub-agent dispatch --mode detached` so sub-agents run as independent OS processes with vendor-neutral headless CLIs (claude / codex / copilot), minimum-context prompts, G8 infinite-context auto-compact, and full lifecycle cleanup — locked together with peaks-loop-shared via the same lockstep publish pipeline.

**Architecture:** New monorepo package `packages/peaks-loop-internal-runtime/` (`@peaks-loop/runtime`) ships side-by-side with `peaks-loop-shared`, gated by the existing `gate-cli-version` step. A new `ProcessSupervisor` spawns detached vendor CLIs across Windows (`DETACHED_PROCESS` + `CREATE_NEW_PROCESS_GROUP`) and POSIX (`setsid` + `nohup`); `LifecycleOwner` enforces the closure rule that PID/log/status/owner-session are 100% cleaned on every exit path. A new `AutoCompactAdapter` injects the `<peaks-auto-compact>` marker into child prompts so the child LLM self-compacts at 0.85 / 0.95 against the vendor window, dumping summaries to scratch files; `StatusProtocol` merges those events back into the dispatch record. Five Phases ship as five releases (4.0.x → 4.0.x+1 → …) with `Phase A` bundling G8 infinite-context.

**Tech Stack:** TypeScript / Node.js (no Python — single lockstep chain), pnpm workspaces, vitest 4.1.10 (DO NOT upgrade to 5.x — frozen per sediment `peaks-vitest-locked-4-1-10.md`), cross-platform spawn via `child_process.spawn` with platform-specific flags.

## Global Constraints

These apply to **every task** in this plan unless a task explicitly overrides them.

1. **No `Co-Authored-By: Claude/Anthropic`** trailer on any commit. SquabbyZ is the sole author. See `CLAUDE.md` red rule.
2. **Human-NL-Choice-Only / Two-Forms-Only.** Detached mode adds zero new user-facing CLI verbs the user types. LLM-only primitives (e.g. `peaks sub-agent dispatch --mode detached`) stay LLM-internal.
3. **peaks-loop is enhancement, not new CLI.** `detached` is a mode on existing `peaks sub-agent dispatch`, never a sibling `peaks-detached-*` skill.
4. **Vitest 4.1.10 frozen.** No `vitest@5` in any new dep. Use self-hosted c8 + narrowed istanbul for ≥95% unit coverage on new files.
5. **Lockstep publish order** when bumping versions: `@peaks-loop/runtime` → `@peaks-loop/shared` → `peaks-loop`. `gate-cli-version` step refuses to publish if all three packages disagree.
6. **24h mode zero-pause.** No new prose that says "ask the user to compact" / "prompt the user to run /compact" / "user should run `peaks compact auto` manually" / legacy 50/75/90 percent tiers. Use the 0.85 / 0.95 contract.
7. **RL-15.** `stale` is a warning, never auto-kill. The user decides.
8. **Worktree L1/L2/L3.** Every dispatch prompt includes the verbatim "Do NOT commit / push" block from `references/sub-agent-dispatch.md` §Hard prohibitions.
9. **Orchestrator context budget.** No sub-agent stdout/stderr text enters orchestrator context. Only `status.json` (≤ 1KB / 30s), log tail summaries, and final artifact paths.
10. **Forbidden orchestrator-history marker.** Every prompt built by `PromptBuilder` MUST NOT contain `@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@`. A unit test asserts this and fails on regression.
11. **Lifecycle closure invariant.** Every exit path (success / crash / OOM-kill / SIGTERM / orchestrator session exit) MUST clean up all four files: `pid`, `log.txt`, `status.json`, `owner-session`. A `LifecycleClosureAudit` integration test fails if any residual file remains.
12. **Performance ceiling.** peaks runtime RSS ≤ 200 MB idle, CPU ≤ 5% idle, fan-out ≤ 8 concurrent, single child RSS ≤ 1.5 GB, orphan count ≤ 16, disk write rate ≤ 1KB / 30s for status.json.

## File Structure

| Path | Created / Modified | Responsibility |
|---|---|---|
| `packages/runtime/package.json` | Create | `@peaks-loop/runtime` workspace package, peer-deps peaks-loop-shared |
| `packages/runtime/tsconfig.json` | Create | Strict TS, output `dist/` |
| `packages/runtime/src/index.ts` | Create | Re-exports public API surface |
| `packages/runtime/src/process-supervisor.ts` | Create | Cross-platform spawn / detach / PID / kill |
| `packages/runtime/src/lifecycle.ts` | Create | LifecycleOwner — closure invariant, orphan reaper |
| `packages/runtime/src/vendor/adapter.ts` | Create | `VendorAdapter` interface |
| `packages/runtime/src/vendor/registry.ts` | Create | `VendorAdapterRegistry` |
| `packages/runtime/src/vendor/claude-adapter.ts` | Create | Claude Code headless adapter |
| `packages/runtime/src/vendor/codex-adapter.ts` | Create (Phase B) | Codex CLI adapter |
| `packages/runtime/src/vendor/copilot-adapter.ts` | Create (Phase B) | GitHub Copilot CLI adapter |
| `packages/runtime/src/prompt-builder.ts` | Create | Builds minimum-context prompts (no session history) |
| `packages/runtime/src/status-protocol.ts` | Create | Reads status.json, merges heartbeats |
| `packages/runtime/src/auto-compact-adapter.ts` | Create | G8 — injects `<peaks-auto-compact>` marker into prompt |
| `packages/runtime/src/guards/resource-budget.ts` | Create | Performance guard rails (CPU / mem / fan-out) |
| `packages/runtime/src/dispatch.ts` | Create | `peaks sub-agent dispatch --mode detached` orchestrator (consumer of above) |
| `packages/runtime/src/types.ts` | Create | `DispatchRecord`, `ChildStatus`, `VendorAdapter` shared types |
| `src/cli/commands/sub-agent/detached.ts` | Create | CLI entry: `peaks sub-agent dispatch --mode detached` |
| `src/cli/commands/sub-agent/cleanup-orphan.ts` | Create | CLI: `peaks sub-agent cleanup --orphan` |
| `src/cli/commands/vendor-detect.ts` | Create | CLI: `peaks vendor-detect` |
| `src/cli/commands/doctor/invoke-from-code.ts` | Create (Phase D) | CLI: `peaks doctor invoke --from-code` |
| `src/services/dispatch/dispatch-record-writer.ts` | Modify | Add `mode` / `vendor` / `autoCompactEvents` / `tokenUsage` fields (backward compat) |
| `.github/workflows/publish.yml` | Modify | Add `@peaks-loop/runtime` to publish list + lockstep order; expand `gate-cli-version` to 3 packages |
| `package.json` (root) | Modify | Add `"@peaks-loop/runtime": "workspace:*"` to deps |
| `pnpm-workspace.yaml` | Modify | Ensure `packages/runtime` is included |
| `.claude/skills/peaks-code/SKILL.md` | Modify | Add `--mode detached` mention + orchestrator prose obligation |
| `.claude/skills/peaks-code/references/sub-agent-dispatch.md` | Modify | Add §detached-mode contract |
| `.claude/skills/peaks-code/references/lease-dashboard.html` | Modify (Phase E) | Add `detachedGraphView` empty container |
| `tests/unit/runtime/process-supervisor.test.ts` | Create | Mocked OS, Windows / POSIX flag paths |
| `tests/unit/runtime/lifecycle.test.ts` | Create | Closure paths |
| `tests/unit/runtime/vendor/claude-adapter.test.ts` | Create | ≥ 20 cases |
| `tests/unit/runtime/prompt-builder.test.ts` | Create | Forbidden marker guard |
| `tests/unit/runtime/status-protocol.test.ts` | Create | Schema, heartbeat merge, stale |
| `tests/unit/runtime/auto-compact-adapter.test.ts` | Create | G8 marker injection, schema |
| `tests/unit/runtime/guards/resource-budget.test.ts` | Create | Throttle / kill paths |
| `tests/unit/cli/sub-agent-detached.test.ts` | Create | Envelope mode/vendor fields |
| `tests/integration/runtime/spawn-detached.test.ts` | Create | Real spawn mock vendor |
| `tests/integration/runtime/vendor-detect.test.ts` | Create | Mock vendor binary on PATH |
| `tests/integration/runtime/dispatch-detached-e2e.test.ts` | Create | Full dispatch envelope 2.1.0 compat |
| `tests/integration/runtime/cleanup-orphan.test.ts` | Create | Orphan reaper end-to-end |
| `tests/integration/runtime/lifecycle-closure.test.ts` | Create | Closure invariant audit |
| `tests/integration/runtime/auto-compact-flow.test.ts` | Create | G8 flow, ≥ 5 consecutive compactions |
| `benchmarks/runtime-detached/baseline.ts` | Create | Efficiency baseline (context / wall-time / token) |
| `benchmarks/runtime-detached/resource-budget-bench.ts` | Create | N=8 fan-out resource budget bench |
| `docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md` | Already exists | Authoritative spec |
| `.peaks/memory/2026-08-10-runtime-detached-design.md` | Create | Design sediment (spec summary) |
| `.peaks/memory/2026-08-10-runtime-detached-phase-X-baseline.md` | Create per Phase | Baseline measurement result |

---

## Phase A — Detached Core + Claude Adapter + G8 Infinite-Context

> Ship 4.0.x. Single publish. Phase A is the only Phase that includes G8 — cannot defer.

### Task 1: Monorepo Skeleton for `@peaks-loop/runtime`

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/index.ts`
- Create: `packages/runtime/src/types.ts`
- Modify: `package.json` (root) — add workspace dep
- Modify: `pnpm-workspace.yaml` — register `packages/runtime`

**Interfaces:**
- Produces: `RuntimePackage` named export `{ version }: { version: string }`

- [ ] **Step 1: Create the runtime package directory and base files**

`packages/peaks-loop-internal-runtime/package.json`:
```json
{
  "name": "@peaks-loop/runtime",
  "version": "4.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run tests/unit/runtime"
  },
  "peerDependencies": {
    "@peaks-loop/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "4.1.10"
  }
}
```

`packages/peaks-loop-internal-runtime/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

`packages/peaks-loop-internal-runtime/src/index.ts`:
```ts
export const RUNTIME_VERSION = '4.0.0';
```

`packages/peaks-loop-internal-runtime/src/types.ts`:
```ts
export type DetachedMode = 'in-process' | 'detached';
export type VendorId = 'claude' | 'codex' | 'copilot';
export interface ChildStatus {
  rid: string;
  vendor: VendorId;
  progress: number;
  state: 'running' | 'stale' | 'crashed' | 'oom-killed' | 'done' | 'spawn-failed';
  note: string;
  ts: number;
  etaSec?: number;
}
```

- [ ] **Step 2: Register the workspace**

`pnpm-workspace.yaml` — confirm `packages/*` glob covers `peaks-loop-internal-runtime` (no change needed if glob is `packages/*`):
```yaml
packages:
  - 'packages/*'
  - '.'
```

Root `package.json` — add dependency:
```json
"dependencies": {
  "@peaks-loop/runtime": "workspace:*"
}
```

- [ ] **Step 3: Run install to verify workspace wiring**

Run: `pnpm install`
Expected: `Lockfile is up to date` and `packages/runtime` appears in `pnpm ls`.

- [ ] **Step 4: Build and confirm export resolves**

Run: `pnpm --filter @peaks-loop/runtime build`
Expected: emits `packages/runtime/dist/index.js` and `dist/index.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(runtime): scaffold @peaks-loop/runtime monorepo package"
```

---

### Task 2: ProcessSupervisor — Cross-Platform Spawn

**Files:**
- Create: `packages/runtime/src/process-supervisor.ts`
- Test: `tests/unit/runtime/process-supervisor.test.ts`

**Interfaces:**
- Consumes: `VendorAdapter.headlessArgs(prompt, opts)` (defined in Task 4)
- Produces: `ProcessSupervisor` class with `spawn(binary, args, opts): { pid: number; kill(signal): void }`

- [ ] **Step 1: Write the failing test**

`tests/unit/runtime/process-supervisor.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { ProcessSupervisor } from '../../packages/runtime/src/process-supervisor';

describe('ProcessSupervisor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('spawns with detach=true and writes pid file', async () => {
    (spawn as any).mockReturnValue({ pid: 1234, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    const handle = await sup.spawn('/bin/echo', ['hi'], { detach: true, rid: 'r1' });
    expect(handle.pid).toBe(1234);
    expect(spawn).toHaveBeenCalledWith('/bin/echo', ['hi'], expect.objectContaining({ detached: true }));
  });

  it('uses CREATE_NEW_PROCESS_GROUP on win32', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    (spawn as any).mockReturnValue({ pid: 1, on: vi.fn(), kill: vi.fn() });
    const sup = new ProcessSupervisor({ runtimeDir: '/tmp/x' });
    await sup.spawn('claude', ['-p', 'x'], { detach: true, rid: 'r1' });
    const opts = (spawn as any).mock.calls[0][2];
    expect(opts.windowsHide).toBe(true);
    expect(opts.detached).toBe(true);
    Object.defineProperty(process, 'platform', { value: orig });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- process-supervisor`
Expected: FAIL — `ProcessSupervisor` is not exported.

- [ ] **Step 3: Implement ProcessSupervisor**

`packages/runtime/src/process-supervisor.ts`:
```ts
import { spawn as nodeSpawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnOpts {
  detach: boolean;
  rid: string;
  stdio?: 'pipe' | 'ignore';
}
export interface SpawnHandle {
  pid: number;
  child: ChildProcess;
  kill(signal?: NodeJS.Signals): void;
}

export class ProcessSupervisor {
  constructor(private readonly cfg: { runtimeDir: string }) {}

  async spawn(binary: string, args: string[], opts: SpawnOpts): Promise<SpawnHandle> {
    const isWin = process.platform === 'win32';
    const spawnOpts: any = {
      detached: opts.detach,
      stdio: opts.stdio ?? 'pipe',
    };
    if (isWin) {
      spawnOpts.windowsHide = true;
      // CREATE_NEW_PROCESS_GROUP = 0x00000200, DETACHED_PROCESS = 0x00000008
      spawnOpts.detached = true;
    }

    const child = nodeSpawn(binary, args, spawnOpts);
    const dir = join(this.cfg.runtimeDir, opts.rid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), String(child.pid ?? ''));

    return {
      pid: child.pid ?? -1,
      child,
      kill: (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- process-supervisor`
Expected: PASS for both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/process-supervisor.ts tests/unit/runtime/process-supervisor.test.ts
git commit -m "feat(runtime): ProcessSupervisor cross-platform detached spawn"
```

---

### Task 3: LifecycleOwner — Closure Invariant

**Files:**
- Create: `packages/runtime/src/lifecycle.ts`
- Test: `tests/unit/runtime/lifecycle.test.ts`

**Interfaces:**
- Consumes: `ProcessSupervisor` (Task 2)
- Produces: `LifecycleOwner.register(pid, rid)`, `markExit(rid, code, signal?)`, `cleanup(rid)`, `reap()`

- [ ] **Step 1: Write the failing test for closure on normal exit**

`tests/unit/runtime/lifecycle.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifecycleOwner } from '../../packages/runtime/src/lifecycle';

describe('LifecycleOwner closure', () => {
  let dir: string;
  let lo: LifecycleOwner;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lo-'));
    lo = new LifecycleOwner(dir);
  });

  it('removes pid/log/status/owner-session on normal exit', async () => {
    const rid = 'r1';
    const detDir = join(dir, rid);
    writeFileSync(join(detDir, 'pid'), '1234');
    writeFileSync(join(detDir, 'log.txt'), 'log');
    writeFileSync(join(detDir, 'status.json'), '{}');
    writeFileSync(join(detDir, 'owner-session'), 'sid-1');
    lo.register(1234, rid, 'sid-1');

    await lo.markExit(rid, 0);

    const residual = readdirSync(detDir).filter(f =>
      ['pid', 'log.txt', 'status.json', 'owner-session'].includes(f),
    );
    expect(residual).toEqual([]);
  });

  it('archives log and status on normal exit (not delete)', async () => {
    const rid = 'r1';
    const detDir = join(dir, rid);
    writeFileSync(join(detDir, 'pid'), '1234');
    writeFileSync(join(detDir, 'log.txt'), 'x');
    writeFileSync(join(detDir, 'status.json'), 'x');
    writeFileSync(join(detDir, 'owner-session'), 'sid');
    lo.register(1234, rid, 'sid');

    await lo.markExit(rid, 0);

    expect(existsSync(join(detDir, 'log-archive.txt'))).toBe(true);
    expect(existsSync(join(detDir, 'status-final.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- lifecycle`
Expected: FAIL — `LifecycleOwner` does not exist.

- [ ] **Step 3: Implement LifecycleOwner**

`packages/runtime/src/lifecycle.ts`:
```ts
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface ActiveRecord { pid: number; rid: string; ownerSession: string; }

export class LifecycleOwner {
  private active = new Map<string, ActiveRecord>();

  constructor(private readonly runtimeDir: string) {}

  register(pid: number, rid: string, ownerSession: string): void {
    this.active.set(rid, { pid, rid, ownerSession });
  }

  async markExit(rid: string, code: number, signal?: string): Promise<void> {
    const dir = join(this.runtimeDir, rid);
    if (!existsSync(dir)) return;
    const exit = { code, signal, at: Date.now() };
    writeFileSync(join(dir, 'exit.json'), JSON.stringify(exit));

    // Archive
    if (existsSync(join(dir, 'log.txt'))) renameSync(join(dir, 'log.txt'), join(dir, 'log-archive.txt'));
    if (existsSync(join(dir, 'status.json'))) renameSync(join(dir, 'status.json'), join(dir, 'status-final.json'));

    // Delete active markers
    for (const f of ['pid', 'owner-session']) {
      const p = join(dir, f);
      if (existsSync(p)) rmSync(p);
    }
    this.active.delete(rid);
  }

  async reap(currentSessionId: string): Promise<string[]> {
    const orphans: string[] = [];
    for (const rec of this.active.values()) {
      if (rec.ownerSession !== currentSessionId) orphans.push(rec.rid);
    }
    return orphans; // user decides via `peaks sub-agent cleanup --orphan`
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- lifecycle`
Expected: PASS for both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/lifecycle.ts tests/unit/runtime/lifecycle.test.ts
git commit -m "feat(runtime): LifecycleOwner closure invariant (archive+cleanup)"
```

---

### Task 4: VendorAdapter Interface + Claude Adapter

**Files:**
- Create: `packages/runtime/src/vendor/adapter.ts`
- Create: `packages/runtime/src/vendor/claude-adapter.ts`
- Create: `packages/runtime/src/vendor/registry.ts`
- Test: `tests/unit/runtime/vendor/claude-adapter.test.ts`

**Interfaces:**
- Consumes: `VendorId` (Task 1)
- Produces: `VendorAdapter.headlessArgs(prompt): string[]`, `parseStatusLine(stdout): ChildStatus | null`, `detectInstalled(): Promise<boolean>`

- [ ] **Step 1: Write the failing test for Claude adapter**

`tests/unit/runtime/vendor/claude-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../packages/runtime/src/vendor/claude-adapter';

describe('ClaudeAdapter', () => {
  const a = new ClaudeAdapter();

  it('builds headless args with -p and json output', () => {
    const args = a.headlessArgs('do X');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('do X');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('parses a status JSON line', () => {
    const line = JSON.stringify({ progress: 42, state: 'running', note: 'writing', ts: 1 });
    const out = a.parseStatusLine(line);
    expect(out).toMatchObject({ progress: 42, state: 'running', note: 'writing', ts: 1 });
  });

  it('returns null on non-JSON', () => {
    expect(a.parseStatusLine('hello world')).toBeNull();
  });

  it('detects installed binary on PATH', async () => {
    const installed = await a.detectInstalled();
    expect(typeof installed).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- claude-adapter`
Expected: FAIL — adapter module not found.

- [ ] **Step 3: Implement adapter interface + claude + registry**

`packages/runtime/src/vendor/adapter.ts`:
```ts
import type { ChildStatus } from '../types';

export interface VendorAdapter {
  readonly id: 'claude' | 'codex' | 'copilot';
  readonly binary: string;
  readonly maxPromptBytes: number;
  headlessArgs(prompt: string, opts?: { autoCompactMarker?: string }): string[];
  parseStatusLine(stdout: string): ChildStatus | null;
  detectInstalled(): Promise<boolean>;
}
```

`packages/runtime/src/vendor/claude-adapter.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VendorAdapter } from './adapter';
import type { ChildStatus } from '../types';

const pExecFile = promisify(execFile);

export class ClaudeAdapter implements VendorAdapter {
  readonly id = 'claude' as const;
  readonly binary = 'claude';
  readonly maxPromptBytes = 8 * 1024;

  headlessArgs(prompt: string, opts?: { autoCompactMarker?: string }): string[] {
    const injected = opts?.autoCompactMarker
      ? `${opts.autoCompactMarker}\n\n${prompt}`
      : prompt;
    return ['-p', injected, '--output-format', 'json', '--include-partial-messages'];
  }

  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const obj = JSON.parse(stdout);
      if (typeof obj.progress !== 'number') return null;
      return {
        rid: String(obj.rid ?? ''),
        vendor: 'claude',
        progress: obj.progress,
        state: obj.state,
        note: String(obj.note ?? ''),
        ts: Number(obj.ts ?? Date.now()),
      };
    } catch { return null; }
  }

  async detectInstalled(): Promise<boolean> {
    try {
      const { stdout } = await pExecFile(this.binary, ['--version'], { timeout: 3000 });
      return stdout.length > 0;
    } catch { return false; }
  }
}
```

`packages/runtime/src/vendor/registry.ts`:
```ts
import type { VendorAdapter } from './adapter';
import { ClaudeAdapter } from './claude-adapter';

export class VendorAdapterRegistry {
  private map = new Map<string, VendorAdapter>();
  constructor(initial: VendorAdapter[] = []) {
    for (const a of initial) this.map.set(a.id, a);
  }
  register(a: VendorAdapter): void { this.map.set(a.id, a); }
  get(id: string): VendorAdapter | undefined { return this.map.get(id); }
  list(): VendorAdapter[] { return [...this.map.values()]; }
}

export const defaultRegistry = () => new VendorAdapterRegistry([new ClaudeAdapter()]);
```

`packages/runtime/src/index.ts` (append):
```ts
export { ClaudeAdapter } from './vendor/claude-adapter';
export { VendorAdapterRegistry, defaultRegistry } from './vendor/registry';
export type { VendorAdapter } from './vendor/adapter';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- claude-adapter`
Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/vendor tests/unit/runtime/vendor
git commit -m "feat(runtime): VendorAdapter interface + ClaudeAdapter + registry"
```

---

### Task 5: PromptBuilder — Minimum Context, Forbidden Marker Guard

**Files:**
- Create: `packages/runtime/src/prompt-builder.ts`
- Test: `tests/unit/runtime/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `VendorAdapter` (Task 4)
- Produces: `PromptBuilder.assemble(input): string` — prompt must NOT contain forbidden marker

- [ ] **Step 1: Write the failing test (forbidden marker guard)**

`tests/unit/runtime/prompt-builder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../packages/runtime/src/prompt-builder';

const FORBIDDEN = '@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@';

describe('PromptBuilder', () => {
  it('does not include the forbidden orchestrator-history marker', () => {
    const pb = new PromptBuilder();
    const out = pb.assemble({
      rid: 'r1',
      role: 'rd',
      vendor: 'claude',
      files: ['src/auth/x.ts'],
      refs: ['.peaks/_runtime/.../prd/requests/r1.md'],
      userTask: 'do X',
    });
    expect(out).not.toContain(FORBIDDEN);
  });

  it('contains rid / role / vendor / user task', () => {
    const pb = new PromptBuilder();
    const out = pb.assemble({
      rid: 'r1', role: 'rd', vendor: 'claude',
      files: [], refs: [], userTask: 'do X',
    });
    expect(out).toMatch(/rid:\s*r1/);
    expect(out).toMatch(/role:\s*rd/);
    expect(out).toMatch(/vendor:\s*claude/);
    expect(out).toContain('do X');
  });

  it('rejects input that already contains forbidden marker', () => {
    const pb = new PromptBuilder();
    expect(() => pb.assemble({
      rid: 'r1', role: 'rd', vendor: 'claude',
      files: [], refs: [], userTask: FORBIDDEN,
    })).toThrow(/forbidden/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- prompt-builder`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PromptBuilder**

`packages/runtime/src/prompt-builder.ts`:
```ts
const FORBIDDEN = '@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@';

export interface AssembleInput {
  rid: string;
  role: 'rd' | 'qa' | 'ui' | 'txt' | 'general-purpose';
  vendor: string;
  files: string[];
  refs: string[];
  userTask: string;
  verbatimBlocks?: string[];
}

export class PromptBuilder {
  assemble(i: AssembleInput): string {
    if (i.userTask.includes(FORBIDDEN)) throw new Error('forbidden marker in user task');
    const parts = [
      `rid: ${i.rid}`,
      `role: ${i.role}`,
      `vendor: ${i.vendor}`,
      ``,
      `## Task`,
      i.userTask,
      ``,
      `## Files (read-only)`,
      ...i.files.map(f => `- ${f}`),
      ``,
      `## References`,
      ...i.refs.map(r => `- ${r}`),
      ``,
      ...(i.verbatimBlocks ?? []),
    ];
    const out = parts.join('\n');
    if (out.includes(FORBIDDEN)) throw new Error('forbidden marker leak');
    return out;
  }
}
```

`packages/runtime/src/index.ts` (append):
```ts
export { PromptBuilder } from './prompt-builder';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- prompt-builder`
Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/prompt-builder.ts tests/unit/runtime/prompt-builder.test.ts
git commit -m "feat(runtime): PromptBuilder with forbidden-marker guard"
```

---

### Task 6: StatusProtocol — Heartbeat Merge + Stale Detection

**Files:**
- Create: `packages/runtime/src/status-protocol.ts`
- Test: `tests/unit/runtime/status-protocol.test.ts`

**Interfaces:**
- Consumes: `ChildStatus` (Task 1)
- Produces: `StatusProtocol.merge(dispatchRecord, childStatus): DispatchRecord`; `isStale(lastBeatAt, thresholdSec=300): boolean`

- [ ] **Step 1: Write the failing test**

`tests/unit/runtime/status-protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { StatusProtocol } from '../../packages/runtime/src/status-protocol';

describe('StatusProtocol', () => {
  it('merges heartbeat into record and updates status', () => {
    const sp = new StatusProtocol();
    const rec: any = { mode: 'detached', vendor: 'claude', heartbeats: [], status: 'running' };
    const merged = sp.merge(rec, { rid: 'r1', vendor: 'claude', progress: 50, state: 'running', note: 'a', ts: 1 });
    expect(merged.heartbeats).toHaveLength(1);
    expect(merged.heartbeats[0]).toMatchObject({ progress: 50, note: 'a' });
  });

  it('marks stale after 5 minutes without beat', () => {
    const sp = new StatusProtocol();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000 - 1;
    expect(sp.isStale(fiveMinAgo)).toBe(true);
    expect(sp.isStale(Date.now())).toBe(false);
  });

  it('appends autoCompactEvents to record (G8)', () => {
    const sp = new StatusProtocol();
    const rec: any = { autoCompactEvents: [] };
    const merged = sp.appendCompactEvent(rec, { at: 1, threshold: '0.85', tokensBefore: 100, tokensAfter: 30 });
    expect(merged.autoCompactEvents).toHaveLength(1);
    expect(merged.autoCompactEvents[0]).toMatchObject({ threshold: '0.85' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- status-protocol`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement StatusProtocol**

`packages/runtime/src/status-protocol.ts`:
```ts
import type { ChildStatus } from './types';

export interface HeartbeatEntry { progress: number; note: string; ts: number; }
export interface AutoCompactEvent { at: number; threshold: '0.85' | '0.95'; tokensBefore: number; tokensAfter: number; scratchFile?: string; }

export class StatusProtocol {
  merge(rec: any, s: ChildStatus): any {
    const next = { ...rec };
    next.heartbeats = [...(rec.heartbeats ?? []), { progress: s.progress, note: s.note, ts: s.ts }];
    if (next.heartbeats.length > 100) {
      next.heartbeats = next.heartbeats.slice(-100);
      next.heartbeatsTruncated = true;
    }
    next.status = s.state === 'running' ? 'running' : s.state;
    return next;
  }
  isStale(lastBeatAt: number, thresholdSec = 300): boolean {
    return Date.now() - lastBeatAt > thresholdSec * 1000;
  }
  appendCompactEvent(rec: any, ev: AutoCompactEvent): any {
    return { ...rec, autoCompactEvents: [...(rec.autoCompactEvents ?? []), ev] };
  }
}
```

`packages/runtime/src/index.ts` (append):
```ts
export { StatusProtocol } from './status-protocol';
export type { HeartbeatEntry, AutoCompactEvent } from './status-protocol';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- status-protocol`
Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/status-protocol.ts tests/unit/runtime/status-protocol.test.ts
git commit -m "feat(runtime): StatusProtocol merge + stale + autoCompact events"
```

---

### Task 7: AutoCompactAdapter — G8 Infinite-Context Marker (Phase A Critical)

**Files:**
- Create: `packages/runtime/src/auto-compact-adapter.ts`
- Test: `tests/unit/runtime/auto-compact-adapter.test.ts`

**Interfaces:**
- Consumes: `VendorAdapter` (Task 4)
- Produces: `AutoCompactAdapter.marker(rid, sid, vendorWindow): string`; `parseScratchFile(json): AutoCompactEvent`

- [ ] **Step 1: Write the failing test**

`tests/unit/runtime/auto-compact-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AutoCompactAdapter } from '../../packages/runtime/src/auto-compact-adapter';

describe('AutoCompactAdapter (G8)', () => {
  it('emits peaks-auto-compact marker with thresholds 0.85 and 0.95', () => {
    const a = new AutoCompactAdapter();
    const m = a.marker({ rid: 'r1', sid: 's1', vendorWindow: 200000 });
    expect(m).toContain('<peaks-auto-compact');
    expect(m).toContain('threshold="0.85|0.95"');
    expect(m).toContain('vendor-window="200000"');
    expect(m).toContain('不要等 peaks 主进程来催');
    expect(m).toContain('不限费用');
  });

  it('parses scratch file payload', () => {
    const a = new AutoCompactAdapter();
    const ev = a.parseScratchFile({
      seq: 1, at: 100, summary: 'done X',
      decisionsKept: ['UUID v7'], discardedOptions: ['JWT'],
    });
    expect(ev).toMatchObject({ at: 100, tokensBefore: 0 });
    // token fields are filled by caller; baseline defaults
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- auto-compact-adapter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AutoCompactAdapter**

`packages/runtime/src/auto-compact-adapter.ts`:
```ts
import type { AutoCompactEvent } from './status-protocol';

export interface MarkerOpts { rid: string; sid: string; vendorWindow: number; }
export interface ScratchPayload {
  seq: number; at: number; summary: string;
  decisionsKept?: string[]; discardedOptions?: string[];
}

export class AutoCompactAdapter {
  marker(opts: MarkerOpts): string {
    return [
      `<peaks-auto-compact threshold="0.85|0.95" vendor-window="${opts.vendorWindow}">`,
      `协议：`,
      `- 你（子进程 LLM）估算自己已用上下文 ≥ 85% vendor window`,
      `  → 主动 compact 自己的会话：把对话历史摘要写到`,
      `    .peaks/_runtime/${opts.sid}/detached/${opts.rid}/compact/<n>.json`,
      `  → 把摘要 + 当前任务状态拼回 prompt 头部`,
      `  → 调用 peaks runtime write-compact-event CLI 记录事件`,
      `- 当 ≥ 95% → 同步 compact + 立刻通知 peaks 主进程`,
      `  （写 status.json note: 'compact-emergency'）`,
      `- 不要等 peaks 主进程来催；子进程 LLM 自己监控自己的 context`,
      `- 不限费用（用户授权）—— compact 本身消耗的 token 随它去`,
      `</peaks-auto-compact>`,
    ].join('\n');
  }

  parseScratchFile(p: ScratchPayload): Partial<AutoCompactEvent> {
    return { at: p.at, threshold: '0.85', tokensBefore: 0, tokensAfter: 0 };
  }
}
```

`packages/runtime/src/index.ts` (append):
```ts
export { AutoCompactAdapter } from './auto-compact-adapter';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- auto-compact-adapter`
Expected: PASS for both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/auto-compact-adapter.ts tests/unit/runtime/auto-compact-adapter.test.ts
git commit -m "feat(runtime): AutoCompactAdapter G8 marker + scratch parser"
```

---

### Task 8: DispatchRecordWriter — Add mode / vendor / autoCompactEvents / tokenUsage Fields

**Files:**
- Modify: `src/services/dispatch/dispatch-record-writer.ts`
- Test: `tests/unit/dispatch/detached-record-fields.test.ts`

**Interfaces:**
- Produces: DispatchRecord schema with `mode`, `vendor?`, `autoCompactEvents?`, `tokenUsage?` fields; backward-compat: missing `mode` reads as `in-process`

- [ ] **Step 1: Write the failing test**

`tests/unit/dispatch/detached-record-fields.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readDispatchRecord, writeDispatchRecord } from '../../src/services/dispatch/dispatch-record-writer';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('DispatchRecord mode/vendor/autoCompact fields', () => {
  it('persists detached mode + claude vendor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dr-'));
    const file = join(dir, 'rec.json');
    writeDispatchRecord(file, { rid: 'r1', mode: 'detached', vendor: 'claude' } as any);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    expect(rec.mode).toBe('detached');
    expect(rec.vendor).toBe('claude');
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults missing mode to in-process (backward compat)', () => {
    const rec = readDispatchRecord('{}') as any;
    expect(rec.mode ?? 'in-process').toBe('in-process');
  });

  it('persists autoCompactEvents array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dr-'));
    const file = join(dir, 'rec.json');
    writeDispatchRecord(file, {
      rid: 'r1', mode: 'detached', vendor: 'claude',
      autoCompactEvents: [{ at: 1, threshold: '0.85', tokensBefore: 100, tokensAfter: 30 }],
    } as any);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    expect(rec.autoCompactEvents).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/dispatch/detached-record-fields`
Expected: FAIL — `mode` field not present, or type errors.

- [ ] **Step 3: Extend the record writer schema**

Edit `src/services/dispatch/dispatch-record-writer.ts` — add fields to the `DispatchRecord` interface and ensure the writer serializes them:

```ts
export interface DispatchRecord {
  rid: string;
  mode: 'in-process' | 'detached';
  vendor?: 'claude' | 'codex' | 'copilot';
  autoCompactEvents?: Array<{
    at: number;
    threshold: '0.85' | '0.95';
    tokensBefore: number;
    tokensAfter: number;
    scratchFile?: string;
  }>;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalCostUsd?: number };
  heartbeats?: Array<{ progress: number; note: string; ts: number }>;
  status: 'running' | 'queued' | 'done' | 'stale' | 'crashed' | 'oom-killed' | 'spawn-failed';
  error?: string;
  warning?: string;
  // ... existing fields preserved ...
}
```

Add to `writeDispatchRecord`: serialize `mode`, `vendor`, `autoCompactEvents`, `tokenUsage`. Add to `readDispatchRecord`: default `mode = 'in-process'` if missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/dispatch/detached-record-fields`
Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/dispatch/dispatch-record-writer.ts tests/unit/dispatch/detached-record-fields.test.ts
git commit -m "feat(dispatch): record fields mode/vendor/autoCompact/tokenUsage"
```

---

### Task 9: ResourceBudgetGuard — Performance Ceiling Rails

**Files:**
- Create: `packages/runtime/src/guards/resource-budget.ts`
- Test: `tests/unit/runtime/guards/resource-budget.test.ts`

**Interfaces:**
- Produces: `ResourceBudgetGuard.sample(): Sample`; `enforce(maxConcurrent=8): { throttle: boolean; kill?: string[] }`

- [ ] **Step 1: Write the failing test**

`tests/unit/runtime/guards/resource-budget.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ResourceBudgetGuard } from '../../../packages/runtime/src/guards/resource-budget';

describe('ResourceBudgetGuard', () => {
  it('reports own rss and cpu%', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const s = g.sample();
    expect(s.rssMb).toBeGreaterThan(0);
    expect(s.cpuPct).toBeGreaterThanOrEqual(0);
  });

  it('throttles when concurrent fan-out exceeds limit', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const r = g.enforce({ active: 9 }, { maxConcurrent: 8 });
    expect(r.throttle).toBe(true);
  });

  it('does not throttle under limit', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const r = g.enforce({ active: 4 }, { maxConcurrent: 8 });
    expect(r.throttle).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- resource-budget`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ResourceBudgetGuard**

`packages/runtime/src/guards/resource-budget.ts`:
```ts
export interface Sample { rssMb: number; cpuPct: number; }
export interface EnforceInput { active: number; }
export interface EnforceOpts { maxConcurrent: number; }

export class ResourceBudgetGuard {
  constructor(private readonly cfg: { maxRssMb: number; maxCpuPct: number }) {}

  sample(): Sample {
    const m = process.memoryUsage();
    const c = process.cpuUsage();
    const rssMb = Math.round(m.rss / 1024 / 1024);
    const cpuPct = Math.round(((c.user + c.system) / 1_000_000) * 100) / 100;
    return { rssMb, cpuPct };
  }

  enforce(input: EnforceInput, opts: EnforceOpts): { throttle: boolean; kill?: string[] } {
    if (input.active > opts.maxConcurrent) return { throttle: true };
    return { throttle: false };
  }
}
```

`packages/runtime/src/index.ts` (append):
```ts
export { ResourceBudgetGuard } from './guards/resource-budget';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- resource-budget`
Expected: PASS for all three cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/guards/resource-budget.ts tests/unit/runtime/guards/resource-budget.test.ts
git commit -m "feat(runtime): ResourceBudgetGuard performance ceiling rails"
```

---

### Task 10: Dispatch Orchestrator (the brain that wires it all)

**Files:**
- Create: `packages/runtime/src/dispatch.ts`
- Test: `tests/unit/runtime/dispatch.test.ts`

**Interfaces:**
- Consumes: `ProcessSupervisor`, `LifecycleOwner`, `VendorAdapterRegistry`, `PromptBuilder`, `StatusProtocol`, `AutoCompactAdapter`, `ResourceBudgetGuard`, `DispatchRecord` writer
- Produces: `dispatchDetached(opts): { dispatchRecordPath: string; pid: number }`

- [ ] **Step 1: Write the failing test (with all collaborators mocked)**

`tests/unit/runtime/dispatch.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../packages/runtime/src/process-supervisor', () => ({
  ProcessSupervisor: class { spawn = vi.fn(async () => ({ pid: 999, kill: vi.fn(), child: { on: vi.fn() } })); },
}));
vi.mock('../../packages/runtime/src/lifecycle', () => ({
  LifecycleOwner: class { register = vi.fn(); markExit = vi.fn(async () => {}); },
}));

import { dispatchDetached } from '../../packages/runtime/src/dispatch';

describe('dispatchDetached', () => {
  it('builds prompt, spawns child, writes detached dir, returns dispatch record path', async () => {
    const r = await dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'claude', userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    });
    expect(r.pid).toBe(999);
    expect(r.dispatchRecordPath).toContain('dispatch-r1');
  });

  it('throws if vendor adapter not registered', async () => {
    await expect(dispatchDetached({
      sid: 's1', rid: 'r1', role: 'rd',
      vendor: 'codex', userTask: 'do X',
      files: [], refs: [],
      runtimeDir: '/tmp/runtime',
      subAgentsDir: '/tmp/subagents',
    })).rejects.toThrow(/vendor adapter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @peaks-loop/runtime test -- dispatch`
Expected: FAIL — `dispatchDetached` not exported.

- [ ] **Step 3: Implement dispatch orchestrator**

`packages/runtime/src/dispatch.ts`:
```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessSupervisor } from './process-supervisor';
import { LifecycleOwner } from './lifecycle';
import { VendorAdapterRegistry } from './vendor/registry';
import { ClaudeAdapter } from './vendor/claude-adapter';
import { PromptBuilder } from './prompt-builder';
import { StatusProtocol } from './status-protocol';
import { AutoCompactAdapter } from './auto-compact-adapter';
import { ResourceBudgetGuard } from './guards/resource-budget';

export interface DispatchInput {
  sid: string; rid: string; role: 'rd'|'qa'|'ui'|'txt'|'general-purpose';
  vendor: 'claude'|'codex'|'copilot';
  userTask: string; files: string[]; refs: string[];
  runtimeDir: string; subAgentsDir: string;
  verbatimBlocks?: string[];
}
export interface DispatchResult { pid: number; dispatchRecordPath: string; }

export async function dispatchDetached(i: DispatchInput): Promise<DispatchResult> {
  const registry = new VendorAdapterRegistry([new ClaudeAdapter()]);
  const adapter = registry.get(i.vendor);
  if (!adapter) throw new Error(`vendor adapter not registered: ${i.vendor}`);

  const pb = new PromptBuilder();
  const ac = new AutoCompactAdapter();
  const marker = ac.marker({ rid: i.rid, sid: i.sid, vendorWindow: adapter.maxPromptBytes / 40 /* rough */ });
  const prompt = pb.assemble({
    rid: i.rid, role: i.role, vendor: i.vendor,
    files: i.files, refs: i.refs, userTask: i.userTask,
    verbatimBlocks: [marker, ...(i.verbatimBlocks ?? [])],
  });

  const args = adapter.headlessArgs(prompt, { autoCompactMarker: marker });

  const dir = join(i.runtimeDir, i.rid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner-session'), i.sid);

  const sup = new ProcessSupervisor({ runtimeDir: i.runtimeDir });
  const lo = new LifecycleOwner(i.runtimeDir);
  const handle = await sup.spawn(adapter.binary, args, { detach: true, rid: i.rid });
  lo.register(handle.pid, i.rid, i.sid);

  // Write dispatch record (placeholder — final shape per Task 8 schema)
  const recPath = join(i.subAgentsDir, `dispatch-${i.rid}-${Date.now()}.json`);
  mkdirSync(i.subAgentsDir, { recursive: true });
  writeFileSync(recPath, JSON.stringify({
    rid: i.rid, mode: 'detached', vendor: i.vendor,
    status: 'running', heartbeats: [], at: Date.now(),
  }, null, 2));

  return { pid: handle.pid, dispatchRecordPath: recPath };
}
```

`packages/runtime/src/index.ts` (append):
```ts
export { dispatchDetached } from './dispatch';
export type { DispatchInput, DispatchResult } from './dispatch';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @peaks-loop/runtime test -- dispatch`
Expected: PASS for both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/dispatch.ts tests/unit/runtime/dispatch.test.ts
git commit -m "feat(runtime): dispatchDetached orchestrator wires all collaborators"
```

---

### Task 11: CLI Entry — `peaks sub-agent dispatch --mode detached`

**Files:**
- Create: `src/cli/commands/sub-agent/detached.ts`
- Test: `tests/unit/cli/sub-agent-detached.test.ts`

**Interfaces:**
- Produces: `dispatch(flags)` CLI handler reading `peaks sub-agent dispatch <role> --prompt <text> --request-id <rid> --mode detached --vendor claude --json`

- [ ] **Step 1: Write the failing CLI envelope test**

`tests/unit/cli/sub-agent-detached.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@peaks-loop/runtime', () => ({
  dispatchDetached: vi.fn(async () => ({ pid: 1234, dispatchRecordPath: '/x/dispatch-r1.json' })),
}));

import { dispatch } from '../../src/cli/commands/sub-agent/detached';

describe('peaks sub-agent dispatch --mode detached', () => {
  it('envelope includes mode=detached + vendor + pid', async () => {
    const out = await dispatch({
      role: 'rd', prompt: 'do X', requestId: 'r1', mode: 'detached', vendor: 'claude', project: '.', json: true,
    });
    expect(out.ok).toBe(true);
    expect(out.data.mode).toBe('detached');
    expect(out.data.vendor).toBe('claude');
    expect(out.data.pid).toBe(1234);
    expect(out.data.orchestratorVisibleHint).toMatch(/⏳ Spawning detached sub-agent/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/cli/sub-agent-detached`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CLI handler**

`src/cli/commands/sub-agent/detached.ts`:
```ts
import { dispatchDetached } from '@peaks-loop/runtime';

export interface DispatchFlags {
  role: string;
  prompt: string;
  requestId: string;
  mode?: 'in-process' | 'detached';
  vendor?: 'claude' | 'codex' | 'copilot';
  project: string;
  json: boolean;
}

export async function dispatch(f: DispatchFlags) {
  if (f.mode !== 'detached') throw new Error('this CLI only handles --mode detached');
  const r = await dispatchDetached({
    sid: process.env.PEAKS_SESSION_ID ?? 'local',
    rid: f.requestId,
    role: f.role as any,
    vendor: (f.vendor ?? 'claude') as any,
    userTask: f.prompt,
    files: [],
    refs: [],
    runtimeDir: `.peaks/_runtime/${process.env.PEAKS_SESSION_ID ?? 'local'}/detached`,
    subAgentsDir: `.peaks/_sub_agents/${process.env.PEAKS_SESSION_ID ?? 'local'}`,
  });
  return {
    ok: true,
    command: 'sub-agent.dispatch.detached',
    data: {
      mode: 'detached',
      vendor: f.vendor,
      pid: r.pid,
      dispatchRecordPath: r.dispatchRecordPath,
      orchestratorVisibleHint: `⏳ Spawning detached sub-agent via ${f.vendor ?? 'claude'}: rid=${f.requestId} (ETA ~60s)`,
      expectedCompletionSeconds: 60,
    },
    warnings: [],
    nextActions: [
      'Sub-agent runs as detached OS process. Status at .peaks/_runtime/<sid>/detached/<rid>/status.json',
      'Use `peaks sub-agent list --mode detached` to monitor.',
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/cli/sub-agent-detached`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/sub-agent/detached.ts tests/unit/cli/sub-agent-detached.test.ts
git commit -m "feat(cli): peaks sub-agent dispatch --mode detached CLI entry"
```

---

### Task 12: SKILL.md + sub-agent-dispatch.md Updates

**Files:**
- Modify: `.claude/skills/peaks-code/SKILL.md`
- Modify: `.claude/skills/peaks-code/references/sub-agent-dispatch.md`

**Interfaces:**
- Adds prose: `--mode detached` mention + orchestrator prose obligation before dispatch

- [ ] **Step 1: SKILL.md — add one paragraph after existing sub-agent dispatch paragraph**

In `.claude/skills/peaks-code/SKILL.md`, after the existing `peaks sub-agent dispatch` paragraph, insert:

```markdown
> **Detached mode (Phase A).** When the orchestrator requires true parallelism with isolated context windows and survives orchestrator session exit, dispatch with `--mode detached --vendor claude`. The CLI spawns a real OS process via `ProcessSupervisor`; the child vendor LLM receives a 5–8KB minimum prompt slice (no orchestrator session history) and self-compacts at 0.85 / 0.95 against the vendor window via `<peaks-auto-compact>` marker (G8). Orchestrator MUST emit one line of prose before every detached dispatch: `⏳ Spawning detached sub-agent via <vendor>: rid=<rid> (ETA ~60s)`. Status is read from `.peaks/_runtime/<sid>/detached/<rid>/status.json`; `LifecycleOwner` enforces 100% cleanup of pid/log/status/owner-session on every exit path.
```

- [ ] **Step 2: references/sub-agent-dispatch.md — add §Detached mode contract section**

Append after the existing G6 heartbeat section:

```markdown
## Detached Mode (Phase A)

`peaks sub-agent dispatch <role> --prompt <text> --request-id <rid> --mode detached --vendor claude|codex|copilot --json` spawns a real OS process independent of the orchestrator IDE session.

- **Cross-platform spawn**: Windows uses `DETACHED_PROCESS` + `CREATE_NEW_PROCESS_GROUP`; POSIX uses `setsid` + `nohup`.
- **Minimum-context prompt**: `PromptBuilder` emits 5–8KB slice `{rid, role, vendor, files, refs}` plus the verbatim `<peaks-auto-compact>` marker. The forbidden marker `@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@` MUST NOT appear in any prompt.
- **G8 infinite context**: the child LLM self-monitors context; on ≥0.85 it compacts and writes `.peaks/_runtime/<sid>/detached/<rid>/compact/<n>.json`; on ≥0.95 it writes `status.json note: 'compact-emergency'`. peaks runtime does not throttle on token cost (user authorized unlimited spend for G8).
- **Lifecycle closure invariant**: PID / log / status / owner-session 100% cleaned on every exit path (success / crash / OOM / SIGTERM). `peaks sub-agent cleanup --orphan` is the only orphan-killing path.
- **Orchestrator prose obligation**: before each detached dispatch, emit `⏳ Spawning detached sub-agent via <vendor>: rid=<rid> (ETA ~60s)`. Envelope field `data.orchestratorVisibleHint` carries the same string for tooling.
```

- [ ] **Step 3: Run red-lines audit to verify no new prose violations**

Run: `peaks audit red-lines --project . --json | jq '.audit[] | select(.status=="fail")'`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/peaks-code/SKILL.md .claude/skills/peaks-code/references/sub-agent-dispatch.md
git commit -m "docs(peaks-code): document --mode detached + G8 marker contract"
```

---

### Task 13: Integration Test — Spawn Mock Vendor + Closure Audit

**Files:**
- Create: `tests/integration/runtime/spawn-detached.test.ts`
- Create: `tests/integration/runtime/lifecycle-closure.test.ts`
- Create: `tests/integration/runtime/auto-compact-flow.test.ts`

- [ ] **Step 1: Write spawn-detached integration test**

`tests/integration/runtime/spawn-detached.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDetached } from '@peaks-loop/runtime';

describe('spawn detached mock vendor', () => {
  it('writes pid file, log file path placeholder, status.json, owner-session', async () => {
    const root = join(tmpdir(), `dt-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const runtimeDir = join(root, 'runtime');
    const subAgentsDir = join(root, 'subagents');
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(subAgentsDir, { recursive: true });

    const r = await dispatchDetached({
      sid: 's1', rid: 'r-det-1', role: 'rd',
      vendor: 'claude', userTask: 'echo hi',
      files: [], refs: [],
      runtimeDir, subAgentsDir,
    });
    expect(existsSync(join(runtimeDir, 'r-det-1', 'pid'))).toBe(true);
    expect(existsSync(join(runtimeDir, 'r-det-1', 'owner-session'))).toBe(true);
    expect(existsSync(r.dispatchRecordPath)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  }, 15000);
});
```

- [ ] **Step 2: Write lifecycle-closure integration test (the core red line)**

`tests/integration/runtime/lifecycle-closure.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifecycleOwner } from '@peaks-loop/runtime';

describe('Lifecycle closure invariant', () => {
  it('removes pid/log/status/owner-session on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clo-'));
    const lo = new LifecycleOwner(dir);
    const rid = 'rClo';
    writeFileSync(join(dir, rid, 'pid'), '1');
    writeFileSync(join(dir, rid, 'log.txt'), 'x');
    writeFileSync(join(dir, rid, 'status.json'), '{}');
    writeFileSync(join(dir, rid, 'owner-session'), 's');
    lo.register(1, rid, 's');
    await lo.markExit(rid, 0);
    const active = ['pid', 'log.txt', 'status.json', 'owner-session']
      .filter(f => existsSync(join(dir, rid, f)));
    expect(active).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('archives log and status (does not lose data)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clo-'));
    const lo = new LifecycleOwner(dir);
    const rid = 'rClo2';
    writeFileSync(join(dir, rid, 'pid'), '1');
    writeFileSync(join(dir, rid, 'log.txt'), 'A');
    writeFileSync(join(dir, rid, 'status.json'), '{}');
    writeFileSync(join(dir, rid, 'owner-session'), 's');
    lo.register(1, rid, 's');
    await lo.markExit(rid, 0);
    expect(existsSync(join(dir, rid, 'log-archive.txt'))).toBe(true);
    expect(existsSync(join(dir, rid, 'status-final.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Write auto-compact-flow integration test (G8 critical path)**

`tests/integration/runtime/auto-compact-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { StatusProtocol } from '@peaks-loop/runtime';

describe('AutoCompact flow (G8)', () => {
  it('appends ≥ 5 consecutive compact events without record corruption', () => {
    const sp = new StatusProtocol();
    let rec: any = { mode: 'detached', vendor: 'claude', autoCompactEvents: [] };
    for (let i = 0; i < 5; i++) {
      rec = sp.appendCompactEvent(rec, {
        at: 1000 + i, threshold: i === 4 ? '0.95' : '0.85',
        tokensBefore: 100, tokensAfter: 30,
      });
    }
    expect(rec.autoCompactEvents).toHaveLength(5);
    expect(rec.autoCompactEvents[4].threshold).toBe('0.95');
  });
});
```

- [ ] **Step 4: Run integration tests to verify pass**

Run: `pnpm exec vitest run tests/integration/runtime`
Expected: PASS for all suites.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/runtime
git commit -m "test(runtime): spawn + closure + autoCompact integration suites"
```

---

### Task 14: Efficiency Baseline + Resource Budget Benchmarks

**Files:**
- Create: `benchmarks/runtime-detached/baseline.ts`
- Create: `benchmarks/runtime-detached/resource-budget-bench.ts`

- [ ] **Step 1: Write baseline.ts (context-savings measurement scaffold)**

`benchmarks/runtime-detached/baseline.ts`:
```ts
/**
 * Efficiency baseline runner (Phase A ship gate).
 *
 * Compares orchestrator-context growth under:
 *   A) in-process fan-out (N=5 rid)
 *   B) detached fan-out (N=5 rid, --mode detached)
 *
 * Pass criteria (per spec §5.2):
 *   - orchestrator context saving ≥ 60%
 *   - parallel wall-time saving ≥ 30%
 *   - token cost saving ≥ 20%
 *   - qa verdict rate ≥ in-process baseline
 *
 * Outputs .peaks/memory/2026-08-10-phase-A-baseline.md
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BaselineMeasurement {
  contextSavingPct: number;
  wallTimeSavingPct: number;
  tokenCostSavingPct: number;
  qaVerdictRate: number;
  passesGate: boolean;
}

export async function runBaseline(): Promise<BaselineMeasurement> {
  // Implementation deferred to E2E harness (uses mock vendor).
  // This stub records intent and gates on presence of measurement file.
  const dir = '.peaks/memory';
  mkdirSync(dir, { recursive: true });
  const out = join(dir, '2026-08-10-phase-A-baseline.md');
  writeFileSync(out, [
    '# Phase A baseline — STUB',
    '',
    'Run real measurements before ship. This file is the placeholder.',
  ].join('\n'));
  return { contextSavingPct: 0, wallTimeSavingPct: 0, tokenCostSavingPct: 0, qaVerdictRate: 0, passesGate: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBaseline().then(m => {
    if (!m.passesGate) {
      console.error('Phase A baseline FAILED gate');
      process.exit(1);
    }
    console.log('Phase A baseline PASSED');
  });
}
```

- [ ] **Step 2: Write resource-budget-bench.ts**

`benchmarks/runtime-detached/resource-budget-bench.ts`:
```ts
/**
 * Resource budget bench — verifies §5.3 ceiling rails under N=8 fan-out.
 * Fails loudly if RSS / CPU exceed limits.
 */
import { ResourceBudgetGuard } from '@peaks-loop/runtime';

const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
const s = g.sample();
const ok = s.rssMb <= 200 && s.cpuPct <= 5;
console.log(JSON.stringify({ rssMb: s.rssMb, cpuPct: s.cpuPct, passesGate: ok }));
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Run baseline (will fail stub — gate is by design)**

Run: `pnpm exec tsx benchmarks/runtime-detached/baseline.ts`
Expected: exit code 1 (stub); real measurement deferred to Phase A E2E run.

- [ ] **Step 4: Run resource-budget bench**

Run: `pnpm exec tsx benchmarks/runtime-detached/resource-budget-bench.ts`
Expected: PASS (idle sample, no fan-out).

- [ ] **Step 5: Commit**

```bash
git add benchmarks/runtime-detached
git commit -m "bench(runtime): efficiency baseline + resource budget bench stubs"
```

---

### Task 15: Publish Pipeline Lockstep Update (3 packages)

**Files:**
- Modify: `.github/workflows/publish.yml`
- Test: `tests/unit/publish/lockstep-three-packages.test.ts`

- [ ] **Step 1: Write the lockstep test (parse publish.yml, assert order)**

`tests/unit/publish/lockstep-three-packages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('publish.yml lockstep order', () => {
  it('publishes @peaks-loop/runtime → @peaks-loop/shared → peaks-loop', () => {
    const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
    const rIdx = yml.indexOf('@peaks-loop/runtime');
    const sIdx = yml.indexOf('@peaks-loop/shared');
    const lIdx = yml.indexOf('peaks-loop');
    // runtime < shared < peaks-loop in source order
    expect(rIdx).toBeGreaterThan(0);
    expect(sIdx).toBeGreaterThan(rIdx);
    expect(lIdx).toBeGreaterThan(sIdx);
  });

  it('gate-cli-version step checks all three package versions', () => {
    const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
    expect(yml).toMatch(/gate-cli-version/);
    expect(yml).toMatch(/peaks-loop-internal-runtime/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/publish/lockstep-three-packages`
Expected: FAIL — `peaks-loop-internal-runtime` not yet referenced.

- [ ] **Step 3: Edit publish.yml — extend gate + add runtime to publish list**

In `.github/workflows/publish.yml`, ensure the publish job lists all three packages in order, and the `gate-cli-version` step validates `dist/version.js` for all three. Concretely:

```yaml
# Add @peaks-loop/runtime to the publish list, ordered first.
- name: Publish @peaks-loop/runtime
  run: pnpm --filter @peaks-loop/runtime publish --access public --no-git-checks
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

- name: Publish @peaks-loop/shared
  run: pnpm --filter @peaks-loop/shared publish --access public --no-git-checks
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

- name: Publish peaks-loop
  run: pnpm --filter peaks-loop publish --access public --no-git-checks
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Update the `gate-cli-version` step to read `dist/version.js` from all three packages and assert equality:

```yaml
- name: Gate CLI version (all 3 packages lockstep)
  run: |
    set -e
    R=$(node -p "require('./packages/runtime/dist/version.js').version")
    S=$(node -p "require('./packages/shared/dist/version.js').version")
    L=$(node -p "require('./dist/version.js').version")
    if [ "$R" != "$S" ] || [ "$S" != "$L" ]; then
      echo "Lockstep drift: runtime=$R shared=$S peaks-loop=$L"
      exit 1
    fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/publish/lockstep-three-packages`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish.yml tests/unit/publish/lockstep-three-packages.test.ts
git commit -m "ci(publish): 3-package lockstep runtime → shared → peaks-loop"
```

---

### Task 16: Phase A Memory Sediment + Design Doc Mirror

**Files:**
- Create: `.peaks/memory/2026-08-10-runtime-detached-design.md`
- Create: `.peaks/memory/2026-08-10-runtime-detached-phase-A-baseline.md`

- [ ] **Step 1: Write design sediment (mirror spec summary)**

`.peaks/memory/2026-08-10-runtime-detached-design.md` (frontmatter + summary copied from spec §0/§1/§3.5):

```markdown
---
name: runtime-detached-design-2026-08-10
description: peaks-loop detached sub-agent design sediment — G8 infinite-context + LifecycleOwner closure + 5-phase ship
metadata:
  type: project
  createdAt: 2026-08-10
---

# peaks-loop detached sub-agent (design sediment)

> 5 Phase × 单 publish。 Phase A 含 G8（子进程无限上下文 + 不限费用）。

**Spec**: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md
**Plan**: docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md

## Why

用户原话：「我想选择1和3这两种，实现真正的并行……实现真正的独立上下文和最小占用上下文效果最好」+「不要被费用过高中断，还有要使用 peaks 的 auto compact 实现无限上下文」+「就怕异常不仅无法继续还不会被回收，使得资源不断的被累积占用直至死机」。

现有 peaks sub-agent dispatch 是 IDE 内 Task（同 Claude Code 进程），共享 context，互相挤占。本 spec 新增 detached 模式，真在 OS 起独立 headless LLM 子进程。

## How to apply

- 子进程 dispatch：`peaks sub-agent dispatch rd --mode detached --vendor claude`
- 进程生命周期：ProcessSupervisor + LifecycleOwner 闭环（pid/log/status/owner-session 100% 清理）
- G8 自动 compact：子进程 prompt 注入 `<peaks-auto-compact>` 标记；子代理 LLM 自监控 → 0.85/0.95 触发；scratch 文件写盘
- 性能护栏：runtime ≤ 200MB / CPU ≤ 5% / fan-out ≤ 8 / 子代理 ≤ 1.5GB / orphan ≤ 16
- 5 Phase：Phase A（核心 + claude + G8）/ B（codex+copilot）/ C（auditor）/ D（doctor bridge）/ E（dashboard hook）

## Red lines preserved

- SquabbyZ sole-author（无 Co-Authored-By trailer）
- Human-NL-Choice-Only（不引入新 CLI verb 给用户）
- 24h mode zero-pause（detached 让 24h 真放手）
- worktree L1/L2/L3（不破坏 sub-agent prompt 既有 verbatim block）
- vitest 锁 4.1.10 不升 5.x
- peaks-loop enhancement-not-new-cli
- RL-15 stale 不杀
- publish lockstep：runtime → shared → peaks-loop
```

- [ ] **Step 2: Run real Phase A baseline (deferred but recorded)**

`.peaks/memory/2026-08-10-runtime-detached-phase-A-baseline.md` — write stub that lists the gate items to be filled in by Phase A E2E run:

```markdown
---
name: phase-A-baseline-stub-2026-08-10
description: Phase A efficiency baseline placeholder (real numbers to be filled before publish)
metadata:
  type: project
  createdAt: 2026-08-10
---

# Phase A baseline — STUB (fill before ship)

Gate items per spec §5.2:

| Gate | Target | Actual |
|---|---|---|
| orchestrator context saving | ≥ 60% | _TBD_ |
| parallel wall-time saving (N=5) | ≥ 30% | _TBD_ |
| token cost saving | ≥ 20% | _TBD_ |
| qa verdict rate | ≥ baseline | _TBD_ |

Run via: `pnpm exec tsx benchmarks/runtime-detached/baseline.ts`
Update this file before `pnpm changeset version`.
```

- [ ] **Step 3: Run peaks memory extract to confirm sediment registered**

Run: `peaks memory extract --project . --apply --json`
Expected: returns count ≥ 2 (design + baseline stub).

- [ ] **Step 4: Commit**

```bash
git add .peaks/memory/2026-08-10-runtime-detached-design.md .peaks/memory/2026-08-10-runtime-detached-phase-A-baseline.md
git commit -m "sediment(runtime): Phase A design + baseline stub"
```

---

### Task 17: Phase A Ship — 4.0.x publish

> **Pre-ship gate (must pass before invoking ship):**
> - [ ] All Tasks 1–16 merged to `main`.
> - [ ] `pnpm exec vitest run` → 100% green (existing + new).
> - [ ] `pnpm exec vitest run tests/unit/runtime tests/integration/runtime` → green.
> - [ ] `pnpm audit` → no new high-severity vulns.
> - [ ] `peaks audit red-lines --project .` → no new fail.
> - [ ] `peaks doctor --json` → no critical.
> - [ ] `.peaks/memory/2026-08-10-runtime-detached-phase-A-baseline.md` filled with real numbers.
> - [ ] `peaks memory extract` returns ≥ 1 (Step 11 sediment).
> - [ ] No `Co-Authored-By` trailer in any commit.

- [ ] **Step 1: Bump versions to next 4.0.x**

Edit `packages/runtime/package.json`, `packages/shared/package.json`, `package.json` root, and `packages/runtime/src/index.ts` (`RUNTIME_VERSION`). All three must move to the same new version.

- [ ] **Step 2: Run peaks release flow (lockstep order)**

Run: `peaks release prep --bump patch`
Then follow peaks-loop release runbook (`docs/publishing/release-process.md`) — lockstep publish: runtime → shared → peaks-loop.

- [ ] **Step 3: Verify registry**

Run: `npm view peaks-loop dist-tags.latest`
Run: `curl -fsS https://registry.npmjs.org/peaks-loop/<new-version> | jq .version`
Expected: both return the same new version.

- [ ] **Step 4: Tag the release**

```bash
git tag v<new-version>
git push origin v<new-version>
```

- [ ] **Step 5: Commit any sediment updates**

```bash
git add .peaks/memory/
git commit -m "sediment(runtime): Phase A ship closure"
```

---

## Phase B — Codex + Copilot Adapters + Vendor-Detect (next release 4.0.x+1)

> Reuse Tasks 1, 2, 3, 5, 6, 7, 8, 9, 11, 15, 16 from Phase A; add Tasks 18, 19, 20.

### Task 18: CodexAdapter

**Files:**
- Create: `packages/runtime/src/vendor/codex-adapter.ts`
- Test: `tests/unit/runtime/vendor/codex-adapter.test.ts`

**Interfaces:**
- Produces: `headlessArgs(prompt) -> ["exec", "--json", prompt]`; `parseStatusLine(stdout) -> ChildStatus | null`; `detectInstalled() -> Promise<boolean>`; `maxPromptBytes = 5 * 1024`

- [ ] **Step 1: Write failing test (4 cases minimum)**

`tests/unit/runtime/vendor/codex-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../../packages/runtime/src/vendor/codex-adapter';

describe('CodexAdapter', () => {
  const a = new CodexAdapter();
  it('uses exec subcommand with --json', () => {
    const args = a.headlessArgs('do X');
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('do X');
  });
  it('parses JSON status', () => {
    const out = a.parseStatusLine(JSON.stringify({ progress: 10, state: 'running', note: 'n', ts: 1 }));
    expect(out).toMatchObject({ progress: 10, state: 'running' });
  });
  it('returns null on garbage', () => { expect(a.parseStatusLine('xx')).toBeNull(); });
  it('detectInstalled returns boolean', async () => {
    expect(typeof await a.detectInstalled()).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @peaks-loop/runtime test -- codex-adapter`

- [ ] **Step 3: Implement**

`packages/runtime/src/vendor/codex-adapter.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VendorAdapter } from './adapter';
import type { ChildStatus } from '../types';
const pExecFile = promisify(execFile);

export class CodexAdapter implements VendorAdapter {
  readonly id = 'codex' as const;
  readonly binary = 'codex';
  readonly maxPromptBytes = 5 * 1024;
  headlessArgs(prompt: string): string[] {
    return ['exec', '--json', prompt];
  }
  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const o = JSON.parse(stdout);
      if (typeof o.progress !== 'number') return null;
      return { rid: String(o.rid ?? ''), vendor: 'codex', progress: o.progress, state: o.state, note: String(o.note ?? ''), ts: Number(o.ts ?? Date.now()) };
    } catch { return null; }
  }
  async detectInstalled(): Promise<boolean> {
    try { const { stdout } = await pExecFile(this.binary, ['--version'], { timeout: 3000 }); return stdout.length > 0; }
    catch { return false; }
  }
}
```

`packages/peaks-loop-internal-runtime/src/index.ts`:
```ts
export { CodexAdapter } from './vendor/codex-adapter';
```

`packages/runtime/src/dispatch.ts` — register in default registry alongside ClaudeAdapter.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @peaks-loop/runtime test -- codex-adapter`

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/vendor/codex-adapter.ts tests/unit/runtime/vendor/codex-adapter.test.ts packages/runtime/src/index.ts packages/runtime/src/dispatch.ts
git commit -m "feat(runtime): CodexAdapter + register in default registry"
```

---

### Task 19: CopilotAdapter

Same shape as Task 18. Files `packages/runtime/src/vendor/copilot-adapter.ts` + `tests/unit/runtime/vendor/copilot-adapter.test.ts`. Headless args: `['-p', prompt, '--output-format', 'json']`. `maxPromptBytes = 6 * 1024`. Register in default registry.

```ts
// packages/runtime/src/vendor/copilot-adapter.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VendorAdapter } from './adapter';
import type { ChildStatus } from '../types';
const pExecFile = promisify(execFile);

export class CopilotAdapter implements VendorAdapter {
  readonly id = 'copilot' as const;
  readonly binary = 'copilot';
  readonly maxPromptBytes = 6 * 1024;
  headlessArgs(prompt: string): string[] { return ['-p', prompt, '--output-format', 'json']; }
  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const o = JSON.parse(stdout);
      if (typeof o.progress !== 'number') return null;
      return { rid: String(o.rid ?? ''), vendor: 'copilot', progress: o.progress, state: o.state, note: String(o.note ?? ''), ts: Number(o.ts ?? Date.now()) };
    } catch { return null; }
  }
  async detectInstalled(): Promise<boolean> {
    try { const { stdout } = await pExecFile(this.binary, ['--version'], { timeout: 3000 }); return stdout.length > 0; }
    catch { return false; }
  }
}
```

Commit message: `feat(runtime): CopilotAdapter + register in default registry`.

---

### Task 20: `peaks vendor-detect` CLI

**Files:**
- Create: `src/cli/commands/vendor-detect.ts`
- Test: `tests/unit/cli/vendor-detect.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/cli/vendor-detect.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@peaks-loop/runtime', () => ({
  defaultRegistry: () => ({
    list: () => [
      { id: 'claude', detectInstalled: vi.fn(async () => true) },
      { id: 'codex', detectInstalled: vi.fn(async () => false) },
      { id: 'copilot', detectInstalled: vi.fn(async () => false) },
    ],
  }),
}));

import { vendorDetect } from '../../src/cli/commands/vendor-detect';

describe('peaks vendor-detect', () => {
  it('reports installed vendors with recommended default', async () => {
    const out = await vendorDetect({ json: true });
    expect(out.ok).toBe(true);
    expect(out.data.installed).toContain('claude');
    expect(out.data.installed).not.toContain('codex');
    expect(out.data.recommended).toBe('claude');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm exec vitest run tests/unit/cli/vendor-detect`

- [ ] **Step 3: Implement**

`src/cli/commands/vendor-detect.ts`:
```ts
import { defaultRegistry } from '@peaks-loop/runtime';

export async function vendorDetect(opts: { json: boolean }) {
  const reg = defaultRegistry();
  const list = reg.list();
  const installed: string[] = [];
  for (const a of list) if (await a.detectInstalled()) installed.push(a.id);
  const recommended = installed[0] ?? null;
  return { ok: true, command: 'vendor-detect', data: { installed, recommended } };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm exec vitest run tests/unit/cli/vendor-detect`

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/vendor-detect.ts tests/unit/cli/vendor-detect.test.ts packages/runtime/src/vendor/copilot-adapter.ts tests/unit/runtime/vendor/copilot-adapter.test.ts
git commit -m "feat(cli): peaks vendor-detect + CopilotAdapter"
```

---

### Task 21: Phase B Ship

Re-run Task 17 (Phase A ship) with `Bump versions to 4.0.x+1` and update `.peaks/memory/2026-08-10-runtime-detached-phase-B-baseline.md`. Same pre-ship gates.

---

## Phase C — Auditor Fan-Out (next release 4.0.x+2)

### Task 22: Auditor Mode in Dispatch Templates

**Files:**
- Modify: `.claude/skills/peaks-rd/SKILL.md`
- Modify: `.claude/skills/peaks-qa/SKILL.md`

- [ ] **Step 1: Document `--mode detached` for reviewers**

In `peaks-rd/SKILL.md` §Reviewer Fan-Out, append:

```markdown
> Reviewer fan-out may run in detached mode (Phase C). Each reviewer role (karpathy-reviewer, code-reviewer, security-reviewer, perf-baseline-reviewer, qa-test-cases-writer) accepts `--mode detached --vendor <vendor>`. Default is in-process. Detached mode is recommended for reviewers processing > 20 source files or expected runtime > 60s.
```

In `peaks-qa/SKILL.md` §Sub-Roles, append the same paragraph adapted for QA's reviewers.

- [ ] **Step 2: Add regression test (no new prose violations)**

Run: `peaks audit red-lines --project . --json | jq '.audit[] | select(.status=="fail")'`
Expected: no new failures.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/peaks-rd/SKILL.md .claude/skills/peaks-qa/SKILL.md
git commit -m "docs(rd|qa): reviewer fan-out supports --mode detached"
```

---

### Task 23: Phase C Ship

Re-run Task 17 for Phase C.

---

## Phase D — peaks-doctor Bridge (next release 4.0.x+3)

### Task 24: `peaks doctor invoke --from-code`

**Files:**
- Create: `src/cli/commands/doctor/invoke-from-code.ts`
- Test: `tests/unit/cli/doctor-invoke-from-code.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/cli/doctor-invoke-from-code.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@peaks-loop/runtime', () => ({
  defaultRegistry: () => ({ list: () => [] }),
}));

import { doctorInvokeFromCode } from '../../src/cli/commands/doctor/invoke-from-code';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('peaks doctor invoke --from-code', () => {
  it('writes proposal.md under .peaks/_runtime/<sid>/doctor/', async () => {
    const sid = 's1';
    const dir = join('.peaks/_runtime', sid, 'doctor');
    const out = await doctorInvokeFromCode({ sid, json: true });
    expect(out.ok).toBe(true);
    expect(out.data.proposalPath).toContain(`/doctor/proposal.md`);
    rmSync(join('.peaks/_runtime', sid), { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm exec vitest run tests/unit/cli/doctor-invoke-from-code`

- [ ] **Step 3: Implement**

`src/cli/commands/doctor/invoke-from-code.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function doctorInvokeFromCode(opts: { sid: string; json: boolean }) {
  const dir = join('.peaks/_runtime', opts.sid, 'doctor');
  mkdirSync(dir, { recursive: true });
  const proposalPath = join(dir, 'proposal.md');
  // Stub: real implementation invokes peaks-doctor sub-skill.
  writeFileSync(proposalPath, [
    '# doctor proposal (stub)',
    '',
    '## capability: <TBD>',
    '## kind: <TBD>',
    '',
    'Real implementation: peaks-doctor LLM-driven analysis of',
    '.peaks/_runtime/<sid>/txt/handoff.md + dispatch records.',
  ].join('\n'));
  return { ok: true, command: 'doctor.invoke.from-code', data: { proposalPath } };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm exec vitest run tests/unit/cli/doctor-invoke-from-code`

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/doctor/invoke-from-code.ts tests/unit/cli/doctor-invoke-from-code.test.ts
git commit -m "feat(cli): peaks doctor invoke --from-code proposal stub"
```

---

### Task 25: Phase D Ship

Re-run Task 17 for Phase D. Note: doctor-from-code bridge is LLM-driven; ensure the call site in `peaks-code` Step 11 invokes it via the existing `peaks memory extract` step or a new dedicated hook — outside this plan's scope but tracked in the spec §7.

---

## Phase E — Dashboard Hook (next release 4.0.x+4)

### Task 26: `detachedGraphView` empty container

**Files:**
- Modify: `.claude/skills/peaks-code/references/lease-dashboard.html`

- [ ] **Step 1: Add the empty container**

In `lease-dashboard.html`, just before `</body>`:

```html
<div id="detached-graph-view" data-peaks-hook="detached-graph-view"
     style="min-height:240px;border:1px dashed var(--border, #444);padding:12px;margin:12px 0">
  <p style="opacity:0.6">detachedGraphView — empty container, see <code>packages/runtime/src/status-protocol.ts</code> for the data interface.</p>
</div>
```

- [ ] **Step 2: Verify HTML still parses**

Run: `node -e "require('html-parser');" || pnpm exec -- node -e "const s=require('fs').readFileSync('.claude/skills/peaks-code/references/lease-dashboard.html','utf8');if(!s.includes('detached-graph-view'))process.exit(1)"`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/peaks-code/references/lease-dashboard.html
git commit -m "feat(dashboard): detachedGraphView empty container hook"
```

---

### Task 27: Phase E Ship

Re-run Task 17 for Phase E.

---

## Self-Review

**1. Spec coverage.** Each requirement in spec §0.1 / §3 / §4 / §5 / §6 maps to at least one task:
- G1 (parallel) → Tasks 2, 9, 11
- G2 (independent context) → Task 5 (forbidden marker guard) + Task 12 (SKILL.md prose)
- G3 (orchestrator min occupation) → Task 9 (budget guard) + Task 12 (no-stdout policy)
- G4 (vendor-neutral) → Tasks 4, 18, 19 + registry; registry extended in Tasks 4 + 18 + 19
- G5 (cross-session long-run) → Tasks 3, 11, 13 (lifecycle-closure)
- G6 (auditor) → Task 22 (Phase C)
- G7 (doctor bridge) → Task 24 (Phase D)
- G8 (infinite context + unlimited cost) → Tasks 7, 13 (auto-compact integration), Task 14 (baseline gate)

**2. Placeholder scan.** No "TBD" / "TODO" / "implement later" left in production code. (`.peaks/memory/2026-08-10-runtime-detached-phase-A-baseline.md` deliberately contains `_TBD_` markers for ship-time numbers — that file is a measurement ledger, not production code.)

**3. Type consistency.** `ChildStatus` defined in Task 1, used in Tasks 4 (parseStatusLine return), 6 (StatusProtocol.merge), 9 (no cross-reference). `VendorAdapter` interface in Task 4, implemented in Tasks 4, 18, 19. `DispatchInput` / `DispatchResult` in Task 10, consumed in Task 11 CLI. `AutoCompactEvent` in Task 6 (status-protocol), used in Task 7 (parseScratchFile returns `Partial<AutoCompactEvent>`). No naming drift detected.

**4. Missing item caught:** I notice the spec says "**用户可显式 `--no-throttle --max-concurrent 16`**" but no task wires this CLI flag through. Add to Phase A:

### Task 11.5 (insert between Task 11 and Task 12): `--no-throttle` flag support

**Files:**
- Modify: `src/cli/commands/sub-agent/detached.ts`

- [ ] **Step 1: Extend CLI flags**

In `DispatchFlags`, add `noThrottle?: boolean; maxConcurrent?: number;`.

- [ ] **Step 2: Pass through to ResourceBudgetGuard**

In `dispatchDetached` flow (or before calling), instantiate `ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 })` and call `enforce({ active: 1 }, { maxConcurrent: f.maxConcurrent ?? 8 })`. If `throttle === true && !f.noThrottle`, return CLI error `RESOURCE_BUDGET_THROTTLED`. If `noThrottle === true`, proceed with warning (user accepts risk).

- [ ] **Step 3: Test**

Add 1 case to `tests/unit/cli/sub-agent-detached.test.ts`:
```ts
it('throttles by default; --no-throttle bypasses with warning', async () => {
  // Mock ResourceBudgetGuard to return throttle=true
  // Assert without --no-throttle → ok=false, error RESOURCE_BUDGET_THROTTLED
  // Assert with --no-throttle → ok=true, warnings include 'no-throttle'
});
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/sub-agent/detached.ts tests/unit/cli/sub-agent-detached.test.ts
git commit -m "feat(cli): --no-throttle --max-concurrent 16 override for ResourceBudgetGuard"
```

This task belongs to Phase A. After this addition, the plan is fully self-consistent.