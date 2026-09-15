/**
 * The one seam through which a `.peaks/_runtime` path is built.
 *
 * Slice 2026-09-15 (runtime-path-unrepresentable). Three attempts to *detect*
 * a caller-supplied id reaching a runtime join all failed the same way: the
 * shipped text rule caught 4 of 12 fixture shapes where the name-based
 * predicate it replaced caught 8, and the version that reached 10 of 12 gave
 * back the change that reached 12 because it cost seven findings on live code —
 * two of them structural (a guard helper, and readers that take the guarded
 * value as a parameter). Its measured verdict: reassignment between guard and
 * join, and guard-after-join, are **domination failures inside a single
 * function, invisible to any text key**.
 *
 * So the instrument is retired in favour of a property. The id cannot reach a
 * runtime join unguarded because there is no longer a join that accepts an
 * unguarded string: `RuntimeRoot.join` takes `GuardedSegment`, and a
 * `GuardedSegment` can only be produced by `guardRuntimeSegment`, which throws
 * on the shapes the escapes used. A newly written unguarded join is a type
 * error at authoring time — not a removed guard that some later scan notices.
 *
 * The raw root is not obtainable as a string except through `dir()`, which is
 * named so that a join written from it (`join(root.dir(), id)`) reads at review
 * time as the bypass it is. `dir()` exists because callers legitimately
 * enumerate the root itself; it is not a join.
 */

import { join } from 'node:path';
import { isUnsafePathInput } from './path-safety.js';

declare const RUNTIME_SEGMENT: unique symbol;

/**
 * A path segment that has been checked as a single safe segment.
 *
 * Unforgeable by construction: the brand is a `unique symbol` that is never
 * exported, so `value as GuardedSegment` outside this module is a type error
 * and a plain `string` is not assignable. `guardRuntimeSegment` is the only
 * producer.
 */
export type GuardedSegment = string & { readonly [RUNTIME_SEGMENT]: true };

/**
 * Check a caller-supplied string and brand it for use as a runtime path
 * segment. `label` names the id in the error the way the caller knows it
 * ("session id", "project id"), because the throw site is one function away
 * from the caller that supplied it.
 *
 * Rejects exactly the shapes `isUnsafePathInput` rejects: separators, `..`,
 * absolute and drive-prefixed paths, UNC and URL shapes, and empty segments.
 */
export function guardRuntimeSegment(value: string, label: string): GuardedSegment {
  if (isUnsafePathInput(value)) {
    throw new Error(`Invalid ${label}: ${value} (must be a single path segment)`);
  }
  return value as GuardedSegment;
}

/**
 * The `.peaks/_runtime` root of one project, as a capability rather than a
 * string. `#path` is a private field, so the raw root cannot be read off the
 * object and joined by an unguarded `join()`.
 */
export class RuntimeRoot {
  readonly #path: string;

  private constructor(path: string) {
    this.#path = path;
  }

  /** The runtime root of `projectRoot`. */
  static at(projectRoot: string): RuntimeRoot {
    return new RuntimeRoot(join(projectRoot, '.peaks', '_runtime'));
  }

  /**
   * Join guarded segments onto the root. At least one segment is required: a
   * zero-argument `join()` would hand back the bare root as a `string`, which
   * is the capability this class exists to withhold.
   */
  join(first: GuardedSegment, ...rest: readonly GuardedSegment[]): string {
    return join(this.#path, first, ...rest);
  }

  /**
   * The root itself, for READ-only enumeration (`readdir`, `existsSync`) — not
   * for joining. Deliberately a method rather than a property so a bypass is
   * legible at the call site.
   */
  dir(): string {
    return this.#path;
  }
}

/** The runtime root of `projectRoot`. */
export function runtimeRoot(projectRoot: string): RuntimeRoot {
  return RuntimeRoot.at(projectRoot);
}
