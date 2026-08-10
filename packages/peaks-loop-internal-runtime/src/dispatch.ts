import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessSupervisor } from './process-supervisor';
import { LifecycleOwner } from './lifecycle';
import { VendorAdapterRegistry } from './vendor/registry';
import { ClaudeAdapter } from './vendor/claude-adapter';
import { CodexAdapter } from './vendor/codex-adapter';
import { CopilotAdapter } from './vendor/copilot-adapter';
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
  const registry = new VendorAdapterRegistry([new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter()]);
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