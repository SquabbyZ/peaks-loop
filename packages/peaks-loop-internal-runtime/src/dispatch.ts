import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { ProcessSupervisor } from './process-supervisor.js';
import { LifecycleOwner } from './lifecycle.js';
import { VendorAdapterRegistry } from './vendor/registry.js';
import { ClaudeAdapter } from './vendor/claude-adapter.js';
import { CodexAdapter } from './vendor/codex-adapter.js';
import { CopilotAdapter } from './vendor/copilot-adapter.js';
import { PromptBuilder } from './prompt-builder.js';
import { StatusProtocol } from './status-protocol.js';
import { AutoCompactAdapter } from './auto-compact-adapter.js';
import { ResourceBudgetGuard } from './guards/resource-budget.js';

export interface DispatchInput {
  sid: string;
  rid: string;
  role: 'rd' | 'qa' | 'ui' | 'txt' | 'general-purpose';
  vendor: 'claude' | 'codex' | 'copilot';
  userTask: string;
  files: string[];
  refs: string[];
  runtimeDir: string;
  subAgentsDir: string;
  verbatimBlocks?: string[];
}
export interface DispatchResult {
  pid: number;
  dispatchRecordPath: string;
  child?: ChildProcess;
  /**
   * Typed launch failure, or `null` when the vendor CLI started. A vendor CLI
   * that is not installed is an expected environment, not a crash: the ENOENT
   * used to surface as an unhandled 'error' event (see ProcessSupervisor.spawn)
   * and escape every awaiting caller's promise chain.
   */
  spawnError: NodeJS.ErrnoException | null;
}

export async function dispatchDetached(i: DispatchInput): Promise<DispatchResult> {
  const registry = new VendorAdapterRegistry([
    new ClaudeAdapter(),
    new CodexAdapter(),
    new CopilotAdapter()
  ]);
  const adapter = registry.get(i.vendor);
  if (!adapter) throw new Error(`vendor adapter not registered: ${i.vendor}`);

  const pb = new PromptBuilder();
  const ac = new AutoCompactAdapter();
  // E5 (rid 2026-09-13-defects-e): the marker used to carry
  // `adapter.maxPromptBytes / 40` as its `vendor-window` — 204.8 for the claude
  // adapter. That is not a context window (it is a prompt BYTE budget divided by
  // forty), and the child was then told to measure "85% of" it, with no way to
  // tell the number was fabricated. peaks-loop does not know the child's window
  // here — the child's own harness owns it — so the attribute is omitted rather
  // than invented.
  const marker = ac.marker({ rid: i.rid, sid: i.sid });
  const prompt = pb.assemble({
    rid: i.rid,
    role: i.role,
    vendor: i.vendor,
    files: i.files,
    refs: i.refs,
    userTask: i.userTask,
    verbatimBlocks: [marker, ...(i.verbatimBlocks ?? [])]
  });

  const args = adapter.headlessArgs(prompt, { autoCompactMarker: marker });

  const dir = join(i.runtimeDir, i.rid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'owner-session'), i.sid);

  const sup = new ProcessSupervisor({ runtimeDir: i.runtimeDir });
  const lo = new LifecycleOwner(i.runtimeDir);
  // F2: in-shell background subprocess. The `detach` field is retained
  // for backward compat with the public SpawnOpts surface but is now a
  // no-op (ProcessSupervisor forces detached:false). Pass `false` to
  // reflect the post-F2 contract explicitly.
  const handle = await sup.spawn(adapter.binary, args, { detach: false, rid: i.rid });
  // `settled` never rejects; it carries the launch outcome as a value. Awaiting
  // it here is what makes a missing vendor CLI an assertable result rather than
  // an exception thrown from outside this function's promise chain.
  const spawnError = (await handle.settled) ?? null;
  lo.register(handle.pid, i.rid, i.sid);

  // Write dispatch record (placeholder — final shape per Task 8 schema)
  const recPath = join(i.subAgentsDir, `dispatch-${i.rid}-${Date.now()}.json`);
  mkdirSync(i.subAgentsDir, { recursive: true });
  writeFileSync(
    recPath,
    JSON.stringify(
      {
        rid: i.rid,
        mode: 'detached',
        vendor: i.vendor,
        // The record must not claim a child is running when the launch failed —
        // that is the on-disk form of "looks green, checked nothing".
        status: spawnError ? 'failed' : 'running',
        ...(spawnError
          ? { spawnError: { code: spawnError.code, message: spawnError.message } }
          : {}),
        heartbeats: [],
        at: Date.now()
      },
      null,
      2
    )
  );

  return { pid: handle.pid, dispatchRecordPath: recPath, child: handle.child, spawnError };
}
