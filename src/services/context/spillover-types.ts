export type SpillId = string;

export type SpillState = 'pending' | 'hydrated' | 'expired';

export interface SpillRecord {
  readonly spillId: SpillId;
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly createdAt: string;
  readonly state: SpillState;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly batchId?: string;
  readonly hydratedAt?: string;
}

export interface SpillOptions {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly batchId?: string;
}

export const SPILL_TTL_MS = 24 * 60 * 60 * 1000;
