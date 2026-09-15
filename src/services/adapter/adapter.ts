/**
 * ⚠ DEAD CODE — NOT THE LIVE VENDOR LAYER, AND NOT THE LIVE IDE LAYER.
 *
 * Three things in this repo are named `<Vendor>Adapter`, and only one of
 * them is live. Read this table before importing anything from here:
 *
 *   1. `src/services/runtime/vendors/<vendor>.ts`
 *      → `class CodexAdapter implements VendorAdapter` (runtime detect +
 *        compact). LIVE — wired by `RuntimeService`'s built-in list. This is
 *        the one a reader looking for "the codex adapter" wants.
 *   2. `packages/peaks-loop-internal-runtime/src/vendor/<vendor>-adapter.ts`
 *      → a second `CodexAdapter`, different surface (binary / headlessArgs /
 *        parseStatusLine / detectInstalled) for the dispatched-sub-agent
 *        runtime. LIVE — exported by that package's public index.
 *   3. THIS FILE'S SIBLINGS — `claude-adapter.ts` / `codex-adapter.ts` /
 *        `copilot-adapter.ts` + `auto-adapter.ts`.
 *      → **UNREFERENCED.** Zero importers in `src/`, `tests/`, `packages/`
 *        or `scripts/`. Every method throws `ADAPTER_NOT_IMPLEMENTED`; the
 *        one exception, `detect()` on the codex/copilot pair, is a hardcoded
 *        `return false`. `peaks skill adapter list` (the only CLI surface
 *        that names these) does not read them — it returns a literal array.
 *
 * The three layers diverged from a single planned skill-adapter surface and
 * were never reconciled. These placeholder files are kept because they mark
 * intent for unimplemented work; they are NOT kept because anything uses
 * them. If you are here to implement them, the decision you actually need is
 * which of layers 1–3 survives — see
 * `tests/unit/runtime/vendor-adapter-layer.test.ts`, which pins which layer
 * is live and fails the moment that stops being true.
 */
export interface AdapterSegment {
  name: string;
  skillMd: string;
  scripts: { name: string; content: string }[];
}
export interface AdapterEnvelope {
  preamble: string;
  refs: { path: string; kind: "file" | "dir" | "script" }[];
}

export interface Adapter {
  readonly name: "claude" | "codex" | "copilot" | "auto";
  resolveScratchDir(beeName: string): Promise<string>;
  materialize(
    beeName: string,
    env: AdapterEnvelope,
    segments: AdapterSegment[],
  ): Promise<string>;
  publish(scratchDir: string): Promise<string>;
  activate(scratchDir: string): Promise<void>;
  cleanup(scratchDir: string): Promise<void>;
  detect(): Promise<boolean>;
}

export class ADAPTER_NOT_IMPLEMENTED extends Error {
  constructor(adapter: string, method: string) {
    super(`ADAPTER_NOT_IMPLEMENTED: ${adapter}.${method} — stub until later slice`);
  }
}
