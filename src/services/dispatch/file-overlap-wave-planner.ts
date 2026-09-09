/**
 * Slice 2026-09-10-dispatch-token-and-swarm §3 — file-overlap-aware
 * parallel scheduling.
 *
 * Problem: fan-out is mandatory, but the orchestrator serializes whenever
 * two slices touch the same file (observed 2026-09-07: two slices both
 * edited `src/cli/commands/code-runtime-commands.ts`, forcing a wait).
 * Topological DAG levels do not know about files, so a "parallel" level can
 * still contain a write/write conflict.
 *
 * Solution: a pure planner over slice descriptors `{ id, files[] }` that
 * returns WAVES. Every slice in a wave has a file set pairwise disjoint
 * from every other slice in that wave. A slice whose files collide with an
 * earlier wave is deferred to a later wave, and the plan records WHICH file
 * collided with WHICH already-scheduled slice — so the caller can explain
 * the serialization instead of silently waiting.
 *
 * Pure: no I/O, no clock, deterministic for a given input.
 *
 * Relationship to `planDispatchWaves` (dag-orchestrator.ts): that planner
 * chunks a topological level by `maxConcurrency` only. This planner is
 * orthogonal — it refines a level (or any slice set) by file overlap. The
 * `--from-dag` path uses this one additively (see `firstLevelWaves` in the
 * dispatch envelope); the topological scheduler itself is unchanged.
 */

/** One unit of work and the files it is expected to touch. */
export interface SliceFileDescriptor {
  readonly id: string;
  readonly files: readonly string[];
}

/** Why a slice did not land in the first wave it was considered for. */
export interface WaveDeferral {
  readonly id: string;
  /** Wave the slice was placed in. */
  readonly waveIndex: number;
  /** The file that collided. */
  readonly collidingFile: string;
  /** The slice already scheduled in an earlier wave that holds that file. */
  readonly collidedWith: string;
  /** Human-readable one-liner (stable wording). */
  readonly reason: string;
}

export interface FileOverlapWave {
  readonly waveIndex: number;
  /** Slice ids in input order. */
  readonly slices: readonly string[];
  /** Union of the wave's files, sorted. */
  readonly files: readonly string[];
  /** Deferrals resolved INTO this wave. */
  readonly deferred: readonly WaveDeferral[];
}

export interface FileOverlapWavePlan {
  readonly waves: readonly FileOverlapWave[];
  /** Slice ids that appeared more than once; only the first is scheduled. */
  readonly duplicateIds: readonly string[];
  /** Number of distinct slices scheduled. */
  readonly sliceCount: number;
}

/**
 * Plan waves such that no two slices in the same wave share a file.
 *
 * Greedy, input-order stable: each slice goes into the earliest existing
 * wave whose files are disjoint from its own; otherwise a new wave is
 * opened. A slice with no files never collides.
 *
 * Duplicate ids: the FIRST descriptor wins; later ones are reported in
 * `duplicateIds` and not scheduled (scheduling the same slice twice would
 * double-dispatch it).
 */
export function planFileOverlapWaves(slices: readonly SliceFileDescriptor[]): FileOverlapWavePlan {
  const duplicateIds: string[] = [];
  const seenIds = new Set<string>();
  const ordered: SliceFileDescriptor[] = [];
  for (const slice of slices) {
    if (typeof slice?.id !== 'string' || slice.id.length === 0) continue;
    if (seenIds.has(slice.id)) {
      duplicateIds.push(slice.id);
      continue;
    }
    seenIds.add(slice.id);
    ordered.push({ id: slice.id, files: normalizeFiles(slice.files) });
  }

  interface WaveState {
    slices: string[];
    files: Set<string>;
    owner: Map<string, string>; // file -> slice id that holds it in this wave
    deferred: WaveDeferral[];
  }
  const waves: WaveState[] = [];

  for (const slice of ordered) {
    // First wave whose file set is disjoint from this slice's.
    let placedAt = -1;
    let collision: { file: string; withSlice: string; waveIndex: number } | null = null;
    for (let w = 0; w < waves.length; w += 1) {
      const wave = waves[w];
      if (wave === undefined) continue;
      let hit: { file: string; withSlice: string } | null = null;
      for (const file of slice.files) {
        const owner = wave.owner.get(file);
        if (owner !== undefined) {
          hit = { file, withSlice: owner };
          break;
        }
      }
      if (hit === null) {
        placedAt = w;
        break;
      }
      // Remember the FIRST collision (earliest wave) for the reason string.
      if (collision === null) {
        collision = { file: hit.file, withSlice: hit.withSlice, waveIndex: w };
      }
    }
    if (placedAt === -1) {
      placedAt = waves.length;
      waves.push({ slices: [], files: new Set(), owner: new Map(), deferred: [] });
    }
    const target = waves[placedAt];
    if (target === undefined) continue; // unreachable; satisfies strict TS
    target.slices.push(slice.id);
    for (const file of slice.files) {
      target.files.add(file);
      target.owner.set(file, slice.id);
    }
    if (collision !== null && placedAt > 0) {
      target.deferred.push({
        id: slice.id,
        waveIndex: placedAt,
        collidingFile: collision.file,
        collidedWith: collision.withSlice,
        reason: `deferred to wave ${placedAt}: file "${collision.file}" already scheduled in wave ${collision.waveIndex} by slice "${collision.withSlice}"`
      });
    }
  }

  return {
    waves: waves.map((w, index) => ({
      waveIndex: index,
      slices: w.slices,
      files: [...w.files].sort(),
      deferred: w.deferred
    })),
    duplicateIds,
    sliceCount: ordered.length
  };
}

function normalizeFiles(files: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(files)) return [];
  const set = new Set<string>();
  for (const f of files) {
    if (typeof f === 'string' && f.length > 0) set.add(f);
  }
  return [...set].sort();
}
