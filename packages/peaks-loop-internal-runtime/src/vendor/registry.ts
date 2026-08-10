import type { VendorAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { CopilotAdapter } from './copilot-adapter.js';

export class VendorAdapterRegistry {
  private map = new Map<string, VendorAdapter>();
  constructor(initial: VendorAdapter[] = []) {
    for (const a of initial) this.map.set(a.id, a);
  }
  register(a: VendorAdapter): void { this.map.set(a.id, a); }
  get(id: string): VendorAdapter | undefined { return this.map.get(id); }
  list(): VendorAdapter[] { return [...this.map.values()]; }
}

export const defaultRegistry = () => new VendorAdapterRegistry([new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter()]);