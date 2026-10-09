// Split out of `workspace/init-command.ts`:
// the option / outcome shapes `peaks workspace init` declares. Re-exported from
// `init-command.ts`, which is still their published import path.
import type { HooksDecision } from './helpers.js';

export type WorkspaceInitOptions = {
  project: string;
  sessionId?: string;
  json?: boolean;
  allowSessionRebind?: boolean;
  /**
   * flag is `--no-rotate-on-outer-mismatch`; commander strips the
   * `--no-` prefix and assigns the boolean to this property (default
   * `true`, set to `false` when the flag is passed). The wrapper
   * reads this as `=== false` to opt out. The presence file still
   * records `outerSessionMismatch` regardless of the flag's value.
   */
  rotateOnOuterMismatch?: boolean;
  /**
   * How to handle the first-time "install peaks hooks" prompt.
   *   - ask  (default in TTY): prompt the user once, sticky-marker the answer
   *   - auto (default in --json / non-TTY): install silently, sticky-marker installed
   *   - skip: write sticky-marker skipped, do not install
   * After the first decision the sticky marker wins, regardless of --install-hooks
   * (re-runs respect the recorded decision; only re-install when the marker says
   * installed but the hooks have been removed out from under us).
   */
  installHooks?: 'ask' | 'auto' | 'skip';
  /**
   * Slice 2.0.1-bug3-fact-forcing-bypass: opt out of writing the
   * consumer-project `.claude/settings.local.json` file. Default
   * (commander `--no-` prefix) is `true`; pass `--no-claude-hooks` to
   * set this to `false`. The wrapper reads this as `=== false` to
   * skip the materialization. The bypass is documented in
   * `peaks-code/references/anchoring-and-session-info.md`.
   */
  claudeHooks?: boolean;
  /**
   * auto-scaffold `.claude/rules/{common,<language>}/` when missing.
   * Default `false` — the diagnostic fires but no write happens.
   * Set to `true` (via `--init-standards`) to also run
   * `executeProjectStandardsInit({ projectRoot, apply: true })`.
   */
  initStandards?: boolean;
  /**
   * commander-style `--no-project-scan-bootstrap` opt-out. Default
   * (no flag) leaves this `undefined` (treated as `true`). Pass the
   * flag to set `options.projectScanBootstrap === false`, which the
   * caller reads as `=== false` to skip the bootstrap call.
   */
  projectScanBootstrap?: boolean;
  /**
   * `--force-project-scan-templates` flag. Default (no flag)
   * leaves this `undefined`. Pass the flag to set
   * `options.forceProjectScanTemplates === true`, which forces the
   * bootstrap service to overwrite the 4 bundled audit/business
   * templates even when they already exist (sediment is preserved
   * otherwise).
   */
  forceProjectScanTemplates?: boolean;
};

/**
 * Outcome of the first-time "install peaks hooks" decision attached to
 * `peaks workspace init`. Reported in the response data so the LLM and
 * the human both see what happened.
 */
export type FirstTimeHooksInstallOutcome = {
  /** The decision recorded (or already on file) in the sticky marker. */
  decision: HooksDecision;
  /**
   * What the install path actually did this call.
   *   - first-decision: we recorded a brand-new sticky marker (and may have installed)
   *   - reinstalled:    the marker said installed but the hooks were missing — we re-applied
   *   - marker-honored: the marker already existed; we did not touch the hooks
   *   - already-installed: the hooks were already present and the marker does not exist yet
   *                          (we write a fresh marker to lock in the answer for next time)
   */
  action: 'first-decision' | 'reinstalled' | 'marker-honored' | 'already-installed';
  scope: 'project' | 'global';
  /**
   * Why the action was the way it was (e.g. "stdin-not-tty", "user-answered-no",
   * "marker-installed-hooks-missing"). Surfaced for forensics.
   */
  reason?: string;
};

export type ResolveFirstTimeHooksInstallOptions = {
  projectRoot: string;
  /**
   * Explicit mode from the --install-hooks flag. When omitted, the default
   * is "ask" in TTY mode and "auto" otherwise (see `defaultMode` logic).
   */
  explicitMode?: 'ask' | 'auto' | 'skip' | undefined;
  /**
   * Whether the caller is in --json mode. In --json mode we never prompt
   * (the LLM cannot answer an interactive question) — we silently treat
   * "ask" as "auto" and proceed.
   */
  jsonMode: boolean;
};

export type WorkspaceInitRotation = {
  previousSessionId: string | null;
  reason: 'outer-session-mismatch' | null;
};

export type CodegraphAutoStakeOutcome = { status: 'fresh' | 'noop' | 'conflict' };
