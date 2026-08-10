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