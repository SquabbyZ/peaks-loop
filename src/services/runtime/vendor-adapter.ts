/**
 * Vendor adapter contract — slice S2-a of RD-2 (2026-07-08 session).
 *
 * Each `VendorAdapter` is a thin wrapper around ONE AI runtime (Claude
 * Code / Codex / Copilot / custom) that knows how to:
 *
 *   1. Detect whether the current environment is that vendor
 *      (env vars, sentinel binaries, environment shape).
 *   2. Issue a compact command through that vendor without forcing
 *      peaks-loop's core code to know vendor-specific verbs.
 *
 * The interface is intentionally MINIMAL (Karpathy #2 Simplicity First):
 * two methods (`detect`, `compact`) plus an `id` + `displayName`.
 * New verbs (status, refactor, etc.) are NOT in scope — they would
 * bloat the surface and force every vendor to implement every verb
 * whether the vendor supports it or not. When a future verb is needed
 * it can either be added to the interface (with all vendors forced to
 * implement) or — preferred — handled through a separate
 * verb-specific adapter family.
 *
 * Vendor-specific verb strings (`claude --compact`, `codex --compact`,
 * `copilot compact`) MUST live ONLY in adapter implementations under
 * `src/services/runtime/vendors/<vendor>.ts`. The runtime service that
 * orchestrates these adapters (runtime-service.ts) and the CLI commands
 * (`peaks runtime compact --via <id>`) MUST NOT contain vendor verbs
 * — verified by AC-1: `rg -n "claude --compact|codex --compact|copilot
 * compact" src/services/code/` must return 0 matches.
 *
 * See `.peaks/_runtime/2026-07-08-session-17918f/prd/002-adapter-runtime-and-polyrepo.md`
 * for the source PRD.
 */
export interface VendorCompactArgs {
  /** When `true`, the vendor is asked to compact unconditionally even
   *  if its auto-detector says it would not normally do so. */
  readonly force?: boolean;
}

export interface VendorCompactResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface VendorAdapter {
  /** Stable identifier used by `peaks runtime compact --via <id>` and
   *  by the adapter registry. Convention: lowercase, dash-separated,
   *  e.g. `claude-code`, `codex`, `copilot`. */
  readonly id: string;
  /** Human-readable name shown in `peaks runtime list` output. */
  readonly displayName: string;
  /** Whether the CURRENT environment is this vendor. Detectors MUST
   *  be pure functions of env + filesystem; they MUST NOT spawn
   *  processes or call vendor CLIs (a detect that itself runs the
   *  vendor would defeat the purpose of asking whether the vendor is
   *  present). */
  detect(): Promise<boolean>;
  /** Issue a compact command for this vendor. The adapter chooses
   *  which binary + args + env to invoke; callers MUST NOT pass
   *  vendor verbs through this method. */
  compact(args?: VendorCompactArgs): Promise<VendorCompactResult>;
}