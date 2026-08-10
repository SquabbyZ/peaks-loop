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