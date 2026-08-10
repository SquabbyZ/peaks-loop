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