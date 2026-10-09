// src/cli/commands/sediment-argv-flags.ts
//
// The argv tail parser `peaks skill sediment` drives every verb with: the raw
// flag map and the typed accessors over it. Split out of
// `sediment-commands.ts`, which re-exports both symbols so its public surface
// is unchanged.

/** Typed accessor over the flag map produced by `parseFlags`.
 *
 * `parseFlags` internally stores every flag with at least one value as a
 * `string[]`. A flag with no following non-flag token (e.g. `--apply`,
 * `--dry-run`) is recorded as `true`. This helper exposes three typed
 * accessors so call-sites don't have to re-narrow `unknown` or
 * `string | boolean | string[]` on every read:
 *
 *   - `flags.list(name)`     → `string[]` (always an array; a single
 *                              occurrence is wrapped to a 1-element
 *                              array at parse time)
 *   - `flags.bool(name)`     → `boolean` (presence-of flag; missing
 *                              flag is `false`)
 *   - `flags.maybeString(name)` → `string | undefined` (first value,
 *                              or `undefined` if the flag was given
 *                              as a bare boolean with no value)
 *
 * The dispatch layer (runSediment) was previously peppered with
 * `typeof flags.x === "string"` / `Array.isArray(flags.x)` narrowing.
 * With this helper the call-sites collapse to one-line reads and the
 * raw flag map stops leaking across the runSediment boundary.
 */
export class ParsedFlags {
  private readonly raw: Record<string, string[] | true>;
  constructor(raw: Record<string, string[] | true>) {
    this.raw = raw;
  }
  /** Always returns an array. Missing flag → []. Single-occurrence
   *  flag → a 1-element array (parseFlags normalizes this). */
  list(name: string): string[] {
    const v = this.raw[name];
    if (v === undefined) return [];
    if (v === true) return [];
    return v;
  }
  /** Presence-of a bare boolean flag. Missing → false. */
  bool(name: string): boolean {
    const v = this.raw[name];
    if (v === undefined) return false;
    // A flag given as `--name <value>` is also "present" (it just happens
    // to carry values too). Existing call-sites that want `--dry-run`
    // semantics care about presence, not whether values are attached.
    return true;
  }
  /** First value of a flag, or `undefined` if the flag is absent or
   *  was given as a bare boolean. */
  maybeString(name: string): string | undefined {
    const v = this.raw[name];
    if (v === undefined) return undefined;
    if (v === true) return undefined;
    return v[0];
  }
}

/** Parse an argv tail into positional args + flag map.
 *
 * Supports:
 *   --flag value    → flags[flag] = [value, ...] (advance i by 1)
 *   --flag          → flags[flag] = true        (when next token starts with `--` or is undefined)
 *   --flag v1 --flag v2   → repeated `--flag` values are accumulated
 *
 * Internally stores all values as `string[]` (or `true` for a bare
 * boolean flag). Use the `ParsedFlags` helper to read typed accessors.
 *
 * Repeatable flag handling (Task 15b): when the same `--key` appears
 * consecutively (e.g. `--segment a --segment b --segment c`), values
 * are accumulated into a single `string[]`. A single occurrence is
 * normalized to a 1-element array so callers can use `.list(name)`
 * uniformly without shape-narrowing on the call-site.
 */
export function parseFlags(argv: string[]): {
  positional: string[];
  flags: ParsedFlags;
} {
  const positional: string[] = [];
  const rawFlags: Record<string, string[] | true> = {};
  for (let i = 0; i < argv.length; i++) {
    // `as string`, not `!`: the loop bound is `argv.length`, so these reads are
    // in range — the toolchain just cannot see that through the index signature.
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        rawFlags[k] = true;
      } else {
        // Capture first value, then look ahead for `--k <value>` repeats.
        const values: string[] = [v];
        i += 2;
        while (
          i < argv.length &&
          argv[i] === `--${k}` &&
          i + 1 < argv.length &&
          !(argv[i + 1] as string).startsWith('--')
        ) {
          values.push(argv[i + 1] as string);
          i += 2;
        }
        // Back up one — the outer for-loop will i++ past the flag, so the
        // next iteration sees the next real token.
        i--;
        rawFlags[k] = values;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags: new ParsedFlags(rawFlags) };
}
