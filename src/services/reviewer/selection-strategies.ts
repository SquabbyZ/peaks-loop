/**
 * selection-strategies.ts — pick a provider per rid for the G4 third-party
 * reviewer. AC-4.6 requires:
 *   - `round-robin` cycles across providers across slices
 *   - `hash(rid)` is stable per rid (deterministic replay)
 *   - `random` is uniform over the provider set
 *
 * Pure helpers, no I/O, no globals beyond an injected RNG (default
 * `Math.random`). Karpathy §2 — minimum code, no premature abstraction.
 */
import { createHash } from 'node:crypto';
import type { ReviewerProviderConfig } from './reviewer-config.js';

export type SelectionMode = 'round-robin' | 'hash' | 'random';

export type SelectionResult = {
  provider: ReviewerProviderConfig;
  index: number;
  /** Monotonic call counter for `round-robin` (1-based). */
  callNumber: number;
};

export type RoundRobinState = {
  mode: 'round-robin';
  cursor: number;
};

export type SelectionState = RoundRobinState;

export function initialState(): SelectionState {
  return { mode: 'round-robin', cursor: 0 };
}

/** Round-robin: cycles across the provider array across calls. */
export function selectRoundRobin(
  providers: ReadonlyArray<ReviewerProviderConfig>,
  state: SelectionState,
  rid: string
): { result: SelectionResult; nextState: SelectionState } {
  if (providers.length === 0) {
    throw new Error(`selectRoundRobin: providers must be non-empty (rid=${rid})`);
  }
  const cursor = state.mode === 'round-robin' ? state.cursor : 0;
  const index = cursor % providers.length;
  const provider = providers[index] as ReviewerProviderConfig;
  const nextState: SelectionState = { mode: 'round-robin', cursor: cursor + 1 };
  return { result: { provider, index, callNumber: cursor + 1 }, nextState };
}

/** Hash(rid): stable, deterministic; same rid always yields same provider. */
export function selectHash(
  providers: ReadonlyArray<ReviewerProviderConfig>,
  rid: string
): SelectionResult {
  if (providers.length === 0) {
    throw new Error(`selectHash: providers must be non-empty (rid=${rid})`);
  }
  const digest = createHash('sha256').update(`reviewer|${rid}`).digest();
  // Use first 4 bytes as an unsigned 32-bit int; modulo provider count.
  const n = digest.readUInt32BE(0);
  const index = n % providers.length;
  const provider = providers[index] as ReviewerProviderConfig;
  return { provider, index, callNumber: 0 };
}

/** Random: uniform sample; supports a seeded RNG for testability. */
export function selectRandom(
  providers: ReadonlyArray<ReviewerProviderConfig>,
  rid: string,
  rng: () => number = Math.random
): SelectionResult {
  if (providers.length === 0) {
    throw new Error(`selectRandom: providers must be non-empty (rid=${rid})`);
  }
  const index = Math.floor(rng() * providers.length) % providers.length;
  const provider = providers[index] as ReviewerProviderConfig;
  return { provider, index, callNumber: 0 };
}

export function selectByMode(
  mode: SelectionMode,
  providers: ReadonlyArray<ReviewerProviderConfig>,
  rid: string,
  state: SelectionState,
  rng?: () => number
): { result: SelectionResult; nextState: SelectionState } {
  if (mode === 'round-robin') return selectRoundRobin(providers, state, rid);
  if (mode === 'hash') return { result: selectHash(providers, rid), nextState: state };
  return { result: selectRandom(providers, rid, rng), nextState: state };
}
