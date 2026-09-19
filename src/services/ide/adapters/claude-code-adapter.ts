import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ContextPercentFallbackInput, IdeAdapter } from '../ide-types.js';
import type { ContextPercentProbe } from '../../context/auto-compact-types.js';
import { claudeCodeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Claude Code adapter —— peaks-loop 的"起源 IDE"。
 *
 * 该 adapter 从原 `src/services/skills/hooks-settings-service.ts` 提取,保持
 * 字节级兼容:用户在 Claude Code 环境下跑 `peaks hooks install` 产出的
 * `.claude/settings.json` 与 refactor 前逐字节相同。
 *
 * 字段解释(见 PRD AC-1):
 *   - dirName = '.claude'           : Claude Code 项目根下的 settings 目录
 *   - settingsFileName = 'settings.json'
 *   - envVar = 'CLAUDE_PROJECT_DIR' : Claude Code 注入的 env 变量,用于 ${...} 占位
 *   - hookEvent = 'PreToolUse'      : Claude Code hook 数组 key
 *   - toolMatcher = 'Bash' | 'Task' : PreToolUse 数组元素的 matcher 字段
 *
 * 不可消除的 per-IDE 字段(见 tech-doc.md §1.3)。
 */

/**
 * Read Claude Code's statusline state file
 * (`~/.claude/statusline-state.json`) and parse a context-percent key.
 * Moved from the generic reader in slice
 * 2026-09-02-vendor-neutral-context-probe — Claude-specific paths now live
 * only in the Claude Code adapter.
 */
function readClaudeStatuslinePercent(): number | null {
  const path = join(homedir(), '.claude', 'statusline-state.json');
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const candidates = ['contextPercent', 'context_usage_percent', 'contextPercentUsed'];
    for (const key of candidates) {
      const raw = json[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw > 1.5 ? raw / 100 : Math.max(0, Math.min(1, raw));
      }
    }
  } catch (err) {
    // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err; // surface module-load bugs
    if (err instanceof SyntaxError) throw err; // surface parse bugs (e.g. broken statusline JSON)
    return null; // only swallow IO errors
  }
  return null;
}

/**
 * Recursive search for `<outerSessionId>.jsonl` under `projectsDir`. The
 * Mac layout encodes the cwd as a single hash directory; on Mac Claude Code
 * nests the transcript under that hash with an extra level of subdirectory we
 * cannot predict ahead of time. A flat readdir misses that branch and returns
 * null — the silent-failure mode this recursion closes.
 *
 * Moved from the generic reader in slice
 * 2026-09-02-vendor-neutral-context-probe. The lookup key is the OUTER
 * session id (Claude Code names its transcript by the outer session UUID),
 * NOT the peaks session id.
 */
function findTranscriptJsonl(projectsDir: string, outerSessionId: string): string | null {
  if (!existsSync(projectsDir)) return null;
  try {
    const stack: string[] = [projectsDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) break;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name === `${outerSessionId}.jsonl`) {
          return full;
        }
      }
    }
  } catch (err) {
    // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err; // surface module-load bugs
    if (err instanceof SyntaxError) throw err; // surface parse bugs
    return null; // only swallow IO errors
  }
  return null;
}

/**
 * Resolve the absolute path of a Claude Code transcript jsonl by OUTER
 * session id, searching `~/.claude/projects/**` recursively.
 *
 * Exported (slice 2026-09-10-context-audit-and-discipline, Slice A) so
 * `peaks code context-audit` reuses THIS locator instead of re-implementing
 * the recursive find. Returns `null` when the transcript does not exist —
 * callers MUST treat that as "unavailable", never as an error.
 */
export function resolveClaudeTranscriptPath(
  outerSessionId: string,
  projectsDir: string = join(homedir(), '.claude', 'projects')
): string | null {
  if (typeof outerSessionId !== 'string' || outerSessionId.length === 0) return null;
  return findTranscriptJsonl(projectsDir, outerSessionId);
}

/** 1M-context window size in tokens (documented single choice: 1,000,000). */
const ONE_MILLION_CONTEXT_TOKENS = 1_000_000;
/** Safe-default (non-1M) context window size in tokens. */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
/** Reverse-scan chunk size in bytes (keeps memory bounded on multi-MB transcripts). */
const TRANSCRIPT_SCAN_CHUNK_BYTES = 64 * 1024;
/**
 * Known 1M-context Claude model id prefixes whose ids do NOT carry a `1m`
 * suffix (e.g. `claude-sonnet-4-5-20250929`). The substring match is
 * intentionally generous — every `claude-sonnet-4*` / `claude-opus-4*`
 * variant is 1M-context.
 */
const ONE_MILLION_CONTEXT_MODELS: readonly string[] = ['claude-opus-4', 'claude-sonnet-4'];

/**
 * Claude Code runtime env vars that may carry the currently-active model id,
 * in documented precedence order (first non-empty value wins):
 *   1. ANTHROPIC_MODEL                — explicit per-run model override
 *   2. ANTHROPIC_DEFAULT_OPUS_MODEL   — default Opus fallback
 *   3. ANTHROPIC_DEFAULT_SONNET_MODEL — default Sonnet fallback
 *   4. ANTHROPIC_DEFAULT_HAIKU_MODEL  — default Haiku fallback
 *   5. ANTHROPIC_DEFAULT_FABLE_MODEL  — default Fable fallback
 *   6. CLAUDE_CODE_SUBAGENT_MODEL     — sub-agent model (used when the others
 *                                       are absent, e.g. a sub-agent-only env)
 *
 * Why env-first: the transcript's `message.model` often drops Claude Code's
 * `[1M]` / `[200K]` suffix marker (observed: `deepseek-v4-flash`), while the
 * runtime env vars above carry it (`deepseek-v4-flash[1M]`). Reading them
 * first lets the window resolver see the true context window. This family is
 * vendor-specific, so it lives ONLY in the claude-code adapter.
 */
const CLAUDE_CODE_MODEL_ENV_VARS: readonly string[] = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL'
];

/**
 * Resolve the currently-active Claude Code model id from a runtime env map.
 * Returns the first non-empty `CLAUDE_CODE_MODEL_ENV_VARS` value (trimmed), or
 * `undefined` when none is present. Pure + exported for tests; the caller falls
 * back to the transcript `message.model` when this returns undefined.
 */
export function resolveClaudeModelFromEnv(env: NodeJS.ProcessEnv | undefined): string | undefined {
  if (!env) return undefined;
  for (const name of CLAUDE_CODE_MODEL_ENV_VARS) {
    const value = env[name];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/**
 * Model-aware context-window size in tokens.
 *
 * Detection rule (documented):
 *   1. Empty / unknown model → DEFAULT_CONTEXT_WINDOW_TOKENS (200_000).
 *   2. Suffix heuristic — a model id containing `1m` (case-insensitive) is
 *      treated as 1M-context.
 *   3. Explicit allowlist — known 1M Claude model ids
 *      (ONE_MILLION_CONTEXT_MODELS).
 *   4. Everything else → 200_000 (the safe default).
 *
 * Callers MAY additionally infer ≥1M from the observed token count: if
 * `contextTokens > DEFAULT_CONTEXT_WINDOW_TOKENS`, the model cannot be a
 * 200K model and must be ≥1M (see `readClaudeTranscriptEstimate`).
 *
 * This is the HEURISTIC layer only. Explicit user overrides sit ABOVE it —
 * see `resolveContextWindow`, which is what the probe actually calls.
 */
export function modelContextWindowTokens(model: string): number {
  const m = model.trim().toLowerCase();
  if (m.length === 0) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  if (m.includes('1m')) return ONE_MILLION_CONTEXT_TOKENS;
  for (const known of ONE_MILLION_CONTEXT_MODELS) {
    if (m.includes(known)) return ONE_MILLION_CONTEXT_TOKENS;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

/**
 * Slice 2026-09-09-context-window-override: vendor-neutral escape hatch for
 * the context-window size in tokens. Third-party / proxied models whose id
 * carries no `[1M]` suffix (and is absent from the hardcoded allowlist) are
 * otherwise stuck at the 200K default, which inflates `ratio` up to 5×.
 * Same spirit as `PEAKS_CALLER_ID`: an env var the user can export, plus a
 * machine-wide `peaks config set --key context.windowTokens` twin.
 */
export const CONTEXT_WINDOW_TOKENS_ENV_VAR = 'PEAKS_CONTEXT_WINDOW_TOKENS';

/**
 * Which layer produced a resolved context window:
 *   - `env-override`     — `PEAKS_CONTEXT_WINDOW_TOKENS`
 *   - `harness-env`      — the window peaks-loop itself wrote into the
 *                          harness's machine-local settings
 *                          (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, declared by
 *                          the adapter as `autoCompactWindowEnvVar`); see
 *                          `harness-window-config.ts`
 *   - `config`           — `context.windowTokens` (`peaks config set`)
 *   - `model-heuristic`  — `[1M]` suffix / `ONE_MILLION_CONTEXT_MODELS`
 *   - `default`          — 200K safe default
 */
export type ContextWindowSource =
  'env-override' | 'harness-env' | 'config' | 'model-heuristic' | 'default';

export interface ContextWindowResolution {
  readonly tokens: number;
  readonly source: ContextWindowSource;
}

/** Explicit override inputs (both optional; env wins over config). */
export interface ContextWindowOverrides {
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Raw `context.windowTokens` value (unvalidated — validated here). */
  readonly configWindowTokens?: unknown;
  /**
   * The window peaks-loop itself configured for the harness — raw value read
   * from the harness's machine-local settings `env` block (or the process env
   * the harness populated from it). Resolved by the caller
   * (`auto-compact-reader.ts` via `harness-window-config.ts`), NOT here: the
   * settings path and the key name are per-IDE declarations.
   *
   * Slice 2026-09-13-auto-compact-trigger-ownership: this layer is what makes
   * the ratio peaks-loop computes and the window the harness compacts against
   * THE SAME NUMBER. Without it they are two independent resolutions that can
   * drift 5× apart on a 1M-window model the model-name heuristic misses.
   */
  readonly harnessWindowTokens?: unknown;
  /**
   * Provenance of `harnessWindowTokens`: true when peaks-loop wrote that value
   * itself, false/omitted when a human set it. Only a peaks-written value may
   * be overruled by the late 1M rescue — see `resolveContextWindowTokens`.
   */
  readonly harnessWindowPeakWritten?: boolean;
  /** Warning sink for an invalid override (defaults to `console.warn`). */
  readonly onInvalidOverride?: ((message: string) => void) | undefined;
  /**
   * Warning sink for the E2 notice: a HUMAN pin (`env-override` / `config`)
   * larger than peaks-loop's own model-window estimate. Deliberately separate
   * from `onInvalidOverride` — that sink means "your value could not be read",
   * this one means "your value was read, and peaks-loop cannot promise the
   * harness will use it". Two meanings, two sinks. Defaults to `console.warn`.
   *
   * See `describeWindowAboveModelEstimate` for what the notice does and does
   * not claim, and why it is a notice rather than a refusal.
   */
  readonly onAboveModelEstimate?: ((message: string) => void) | undefined;
}

/**
 * E2 (rid 2026-09-13-defects-e) — the notice for a pin larger than
 * peaks-loop's model-window estimate. `null` when there is nothing to say.
 *
 * WHY THIS EXISTS. The harness does not take its auto-compact window on faith:
 * it reduces the configured value with `Math.min(native, override)`, where
 * `native` is the model's own context size. A pin ABOVE `native` is therefore
 * accepted by peaks-loop, written to the harness's settings, and silently
 * reduced by the harness — so peaks-loop's ratio divides by a window the
 * harness is not compacting on. That is the A1 drift (two independent
 * resolutions, one number meaning two things), arriving from the other side
 * from E1: E1 is a value the harness refuses, E2 a value it quietly lowers.
 *
 * CAN WE READ THE NATIVE WINDOW? No, and the notice does not pretend otherwise.
 * There is no API for it and no environment variable that carries it; the only
 * local knowledge is `modelContextWindowTokens`'s NAME HEURISTIC (200_000, or
 * 1_000_000 when the id says `1m` or matches the allowlist) — the very layer
 * this slice demoted, because it is wrong for precisely the proxied /
 * third-party models the pin exists for. It is used here ONLY as a disagreement
 * DETECTOR, never as an authority, and the uncertainty that buys is one-sided:
 * this notice means "peaks-loop's best guess of your model is smaller than the
 * window you pinned", which a genuinely larger model ALSO produces. It cannot
 * mean "the harness will definitely cap you" — only the harness knows that.
 *
 * WHY A NOTICE AND NOT A REFUSAL. The pin is the documented escape hatch for a
 * model id the heuristic cannot see, so refusing would delete the feature. The
 * notice keeps it and states the risk.
 *
 * WHY ONLY THE HUMAN PINS. The `harness-env` layer is a value peaks-loop FOUND
 * in the harness's own file, not one this call is setting; its disagreements are
 * already reported by the writer (`harnessWindowSyncWarning`), and warning here
 * would fire on every probe of a project whose file legitimately says 1000000.
 */
export function describeWindowAboveModelEstimate(input: {
  readonly model: string;
  readonly tokens: number;
  /** Human-readable name of the pin, e.g. `PEAKS_CONTEXT_WINDOW_TOKENS="500000"`. */
  readonly pin: string;
}): string | null {
  const estimate = modelContextWindowTokens(input.model);
  if (input.tokens <= estimate) return null;
  return (
    `[peaks] ${input.pin} is larger than peaks-loop's model-window estimate for ` +
    `"${input.model}" (${estimate} tokens). peaks-loop cannot read a model's native context window — this ` +
    `estimate is a name heuristic and may be wrong — and the harness caps its auto-compact window at that ` +
    `native size, so if the estimate is right the harness will compact at ${estimate} while this ratio ` +
    `divides by ${input.tokens}. If your model really does have the larger window this is expected; ` +
    `otherwise set the value to the model's real window so the two stay in step.`
  );
}

/**
 * Parse an explicit context-window override. Accepts a positive finite
 * integer only (number, or a numeric string so an env var works); anything
 * else — `0`, negative, `NaN`, `Infinity`, `1.5`, `'abc'`, `''` — returns
 * null so the caller can ignore it and fall through to the next layer.
 */
export function parseContextWindowOverride(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim().length === 0) return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw.trim());
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolve the context window in tokens AND report which layer won
 * (first hit wins):
 *   1. env `PEAKS_CONTEXT_WINDOW_TOKENS`
 *   2. config `context.windowTokens`
 *   3. `harnessWindowTokens` — the window peaks-loop configured for the
 *      harness (`autoCompactWindowEnvVar`)
 *   4. model-name heuristic (`modelContextWindowTokens`)
 *   5. `DEFAULT_CONTEXT_WINDOW_TOKENS` (200_000)
 *
 * An invalid explicit override is ignored with a warning and falls through
 * to the next layer — a typo must never crash or silently win the probe.
 *
 * Slice 2026-09-13-auto-compact-trigger-ownership — why layer 3 exists:
 *   The hard constraint is that the window peaks-loop divides by must BE the
 *   window it configured for the harness. Layer 3 is peaks-loop's own output
 *   read back from the harness's settings file, so the two sides reference one
 *   artifact rather than two independent resolutions. It sits ABOVE the model
 *   heuristic because a heuristic contradicting the number both sides already
 *   use is precisely how the 5× drift arose (a 1M-window model measured
 *   against a 200K guess).
 *
 *   Why it sits BELOW the two explicit pins. Both are human declarations of
 *   intent, and a pin that loses to a value peaks-loop wrote earlier is a
 *   silently ignored setting: the user changes `context.windowTokens`, the
 *   stale harness key shadows it, and nothing appears to happen. Conflict is
 *   instead resolved by PROPAGATION — the probe that resolves the pin also
 *   syncs it into the harness (`syncHarnessWindowForProject`), so peaks-loop's
 *   ratio and the harness's window are back on one number before that command
 *   returns. The conflict is therefore transient and self-healing rather than
 *   either silent shadowing or permanent drift.
 *
 *   Why layer 3 is not simply authoritative (the ratchet). Reading back a value
 *   peaks-loop wrote makes peaks-loop trust its own earlier resolution, so a
 *   first-time mis-resolution (an unrecognised model defaulting to 200_000)
 *   would be written to disk and then believed forever: the ratio stays
 *   saturated at 1.0 while the session grows past the pin, and the correction
 *   that exists for exactly that case — the late 1M rescue — was disabled for
 *   this layer. Self-locking. See `resolveContextWindowTokens` for how the
 *   rescue is let back in without letting it overwrite a human's own setting.
 */
export function resolveContextWindow(
  model: string,
  overrides: ContextWindowOverrides = {}
): ContextWindowResolution {
  const warn = overrides.onInvalidOverride ?? ((message: string) => console.warn(message));
  // E2: the second sink, for a value that IS valid but that the harness may
  // reduce. Kept separate so neither notice can be mistaken for the other.
  const warnAboveEstimate =
    overrides.onAboveModelEstimate ?? ((message: string) => console.warn(message));
  const envRaw = overrides.env?.[CONTEXT_WINDOW_TOKENS_ENV_VAR];
  if (envRaw !== undefined) {
    const parsed = parseContextWindowOverride(envRaw);
    if (parsed !== null) {
      const above = describeWindowAboveModelEstimate({
        model,
        tokens: parsed,
        pin: `${CONTEXT_WINDOW_TOKENS_ENV_VAR}="${String(envRaw)}"`
      });
      if (above !== null) warnAboveEstimate(above);
      return { tokens: parsed, source: 'env-override' };
    }
    warn(
      `[peaks] ${CONTEXT_WINDOW_TOKENS_ENV_VAR}="${String(envRaw)}" is not a positive integer — ignoring the override`
    );
  }
  if (overrides.configWindowTokens !== undefined) {
    const parsed = parseContextWindowOverride(overrides.configWindowTokens);
    if (parsed !== null) {
      const above = describeWindowAboveModelEstimate({
        model,
        tokens: parsed,
        pin: `config context.windowTokens=${parsed}`
      });
      if (above !== null) warnAboveEstimate(above);
      return { tokens: parsed, source: 'config' };
    }
    warn(
      `[peaks] config context.windowTokens=${JSON.stringify(overrides.configWindowTokens)} is not a positive integer — ignoring the override`
    );
  }
  if (overrides.harnessWindowTokens !== undefined) {
    const parsed = parseContextWindowOverride(overrides.harnessWindowTokens);
    if (parsed !== null) return { tokens: parsed, source: 'harness-env' };
    warn(
      `[peaks] harness auto-compact window ${JSON.stringify(overrides.harnessWindowTokens)} is not a positive integer — ignoring the override`
    );
  }
  const heuristic = modelContextWindowTokens(model);
  return heuristic === DEFAULT_CONTEXT_WINDOW_TOKENS
    ? { tokens: heuristic, source: 'default' }
    : { tokens: heuristic, source: 'model-heuristic' };
}

/** A non-negative finite number, or null when the value is not numeric. */
function numericTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return null;
}

/**
 * Parse a single jsonl line into its token count + model id. Returns null
 * when the line has no `message.usage` object with numeric token fields.
 */
function parseTranscriptUsageLine(line: string): { contextTokens: number; model: string } | null {
  if (line.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null; // non-JSON line (blank / corrupt) — skip
  }
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as Record<string, unknown>;
  const usage = msg.usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;

  const inputTokens = numericTokenCount(u.input_tokens);
  const cacheRead = numericTokenCount(u.cache_read_input_tokens);
  const cacheCreation = numericTokenCount(u.cache_creation_input_tokens);
  if (inputTokens === null && cacheRead === null && cacheCreation === null) return null;

  const contextTokens = (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheCreation ?? 0);
  // Model id lives at `message.model`, falling back to a top-level `model`.
  const model =
    typeof msg.model === 'string'
      ? msg.model
      : typeof record.model === 'string'
        ? record.model
        : '';
  return { contextTokens, model };
}

/**
 * Reverse-scan the transcript jsonl (from the END) for the LATEST entry that
 * carries a numeric `message.usage`. The file can be many MB; it is read in
 * backward chunks of TRANSCRIPT_SCAN_CHUNK_BYTES — never fully into memory —
 * and stops at the first (newest) usable entry.
 */
function findLatestTranscriptUsage(
  filePath: string
): { contextTokens: number; model: string } | null {
  let fd: number | null = null;
  try {
    const size = statSync(filePath).size;
    if (size === 0) return null;
    fd = openSync(filePath, 'r');
    let position = size;
    let carry = ''; // partial line head carried into the next (older) chunk
    while (position > 0) {
      const readLen = Math.min(TRANSCRIPT_SCAN_CHUNK_BYTES, position);
      position -= readLen;
      const buf = Buffer.alloc(readLen);
      const bytesRead = readSync(fd, buf, 0, readLen, position);
      if (bytesRead <= 0) break;
      const lines = (buf.toString('utf8', 0, bytesRead) + carry).split('\n');
      carry = lines[0] ?? '';
      for (let i = lines.length - 1; i >= 1; i--) {
        const line = lines[i];
        if (line === undefined) continue;
        const parsed = parseTranscriptUsageLine(line);
        if (parsed !== null) return parsed;
      }
    }
    // The final carry is the first line of the file (complete, since it starts at byte 0).
    if (carry.length > 0) {
      const parsed = parseTranscriptUsageLine(carry);
      if (parsed !== null) return parsed;
    }
    return null;
  } catch (err) {
    // Narrow: surface module-load / parse bugs, swallow IO errors only
    // (mirrors the other adapter read helpers' catch discipline).
    if (err instanceof ReferenceError) throw err;
    if (err instanceof SyntaxError) throw err;
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Resolve the context window for a transcript usage entry. Explicit user
 * overrides (`resolveContextWindow`) win outright — the user pinned the
 * number, so nothing else may contradict it. Without an explicit override,
 * when the observed token count contradicts the heuristic window (tokens
 * exceed it), the model must be ≥1M, so bump to the 1M window (the late
 * rescue; it keeps the heuristic source tag, only the tokens change).
 *
 * `env-override` and `config` are in the no-bump list because a human pinned
 * them: a pin the probe silently overrules is a setting that does not work.
 *
 * `harness-env` is the interesting one, and is decided by PROVENANCE:
 *
 *   - peaks-written (`harnessWindowPeakWritten === true`): may be bumped. This
 *     is the ratchet fix. The value is peaks-loop's own earlier resolution, so
 *     believing it forever makes a first-time mis-resolution PERMANENT — a
 *     200_000 default written to disk, re-read as the window, and exempt from
 *     the very rescue that exists to correct it, leaving the ratio saturated at
 *     1.0 while the session grows past the pin. Evidence must be able to
 *     overrule peaks-loop's own output.
 *   - human-set (false/omitted): NOT bumpable. Here the key is a person's
 *     explicit declaration — the documented Claude Code variable, hand-edited.
 *     Overruling it would not be self-correction, it would be peaks-loop
 *     silently rewriting a setting the user chose (and persisting the rewrite).
 *
 * Both branches keep the single-source rule: the resolution this function
 * returns becomes `probe.capacityTokens`, and the caller syncs exactly that
 * back into the harness key (`syncHarnessWindowForProject`). When the rescue
 * fires, the key is refreshed to the bumped number in the same command, so
 * peaks-loop's ratio and the harness window are one number again — the rescue
 * never leaves the two sides apart.
 */
function resolveContextWindowTokens(
  model: string,
  contextTokens: number,
  overrides: ContextWindowOverrides = {}
): ContextWindowResolution {
  const resolved = resolveContextWindow(model, overrides);
  if (resolved.source === 'env-override' || resolved.source === 'config') return resolved;
  if (resolved.source === 'harness-env' && overrides.harnessWindowPeakWritten !== true)
    return resolved;
  return contextTokens > resolved.tokens
    ? { tokens: ONE_MILLION_CONTEXT_TOKENS, source: resolved.source }
    : resolved;
}

/**
 * Conservative transcript-estimate fallback. Recursively searches
 * `~/.claude/projects/<hash>/<outerSessionId-or-nested>.jsonl` (Mac may nest
 * the jsonl under an extra directory we cannot predict ahead of time) and
 * estimates `ratio = contextTokens / contextWindowTokens` from the LATEST
 * `message.usage` entry — token-based + model-aware, NOT the old
 * `bytes / 256KB` (which over-fired because the transcript grows unboundedly).
 * Tagged `'transcript-estimate'` (v2.14.0) so callers know it is a real
 * signal, NOT a hard gate.
 *
 * Window model resolution is env-first: when `envModel` is present, its id
 * (which Claude Code stamps with the `[1M]` / `[200K]` suffix) drives the
 * window; otherwise the transcript `message.model` is used. Explicit
 * overrides (env `PEAKS_CONTEXT_WINDOW_TOKENS` / the harness key peaks-loop
 * wrote / config `context.windowTokens`) sit above both and are reported via
 * `capacitySource`.
 */
function readClaudeTranscriptEstimate(
  outerSessionId: string,
  envModel?: string,
  overrides: ContextWindowOverrides = {}
): {
  ratio: number;
  contextTokens: number;
  contextWindowTokens: number;
  capacitySource: ContextWindowSource;
} | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const path = findTranscriptJsonl(projectsDir, outerSessionId);
  if (path === null) return null;
  const latest = findLatestTranscriptUsage(path);
  if (latest === null) return null;
  const model = envModel !== undefined && envModel.trim().length > 0 ? envModel : latest.model;
  const resolved = resolveContextWindowTokens(model, latest.contextTokens, overrides);
  const contextWindowTokens = resolved.tokens;
  const ratio = Math.min(1, latest.contextTokens / contextWindowTokens);
  return {
    ratio,
    contextTokens: latest.contextTokens,
    contextWindowTokens,
    capacitySource: resolved.source
  };
}

/**
 * Claude Code's vendor-specific context-percent fallback, exposed as
 * `IdeCompactProfile.readContextPercentFallback`. The generic reader calls
 * this only when the primary env-var probe misses; only the adapter knows the
 * Claude-specific statusline + transcript paths. Resolution order:
 *   1. statusline poll (`~/.claude/statusline-state.json`)
 *   2. transcript estimate — looks up `<outerSessionId>.jsonl` under
 *      `~/.claude/projects/<hash>/...` using the OUTER session id (Claude
 *      names its transcript by the outer session UUID, not the peaks sid),
 *      and estimates `contextTokens / contextWindowTokens` from the LATEST
 *      `message.usage` entry (token-based + model-aware). The window model
 *      resolves env-first via `resolveClaudeModelFromEnv(input.env)` (which
 *      carries the `[1M]` suffix the transcript often drops), falling back to
 *      the transcript `message.model` when env is empty.
 * Returns `null` when neither yields a signal → the reader emits
 * `conservative-fallback`.
 */
function readContextPercentFallback(
  input: ContextPercentFallbackInput
): ContextPercentProbe | null {
  const capturedAt = new Date().toISOString();
  // Byte-based capacity is carried only for the percent path (statusline-poll
  // returns a 0..1 ratio; capacityBytes is metadata there). The
  // transcript-estimate path is token-based and surfaces `capacityTokens`
  // (the model window) instead — see readClaudeTranscriptEstimate.
  const capacityBytes = 256 * 1024;
  const ide = 'claude-code';

  const statusline = readClaudeStatuslinePercent();
  if (statusline !== null) {
    return { ratio: statusline, source: 'statusline-poll', capacityBytes, ide, capturedAt };
  }

  if (typeof input.outerSessionId === 'string' && input.outerSessionId.length > 0) {
    const envModel = resolveClaudeModelFromEnv(input.env);
    const estimate = readClaudeTranscriptEstimate(input.outerSessionId, envModel, {
      env: input.env,
      configWindowTokens: input.configWindowTokens,
      // Slice 2026-09-13-auto-compact-trigger-ownership: the window
      // peaks-loop configured for the harness outranks config + heuristic
      // (see `resolveContextWindow`). The generic reader resolved it from the
      // adapter's own declarations — this module never names the key.
      ...(input.harnessWindowTokens !== undefined
        ? { harnessWindowTokens: input.harnessWindowTokens }
        : {}),
      // ...and whether that value is peaks-loop's own output (bumpable) or a
      // human's pin (not) — see `resolveContextWindowTokens`.
      ...(input.harnessWindowPeakWritten !== undefined
        ? { harnessWindowPeakWritten: input.harnessWindowPeakWritten }
        : {})
    });
    if (estimate !== null) {
      return {
        ratio: estimate.ratio,
        source: 'transcript-estimate',
        rawTokens: estimate.contextTokens,
        capacityTokens: estimate.contextWindowTokens,
        capacitySource: estimate.capacitySource,
        ide,
        capturedAt
      };
    }
  }

  return null;
}

export const CLAUDE_CODE_ADAPTER: IdeAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  settings: {
    dirName: '.claude',
    settingsFileName: 'settings.json',
    // The machine-local layer Claude Code merges on top of settings.json.
    // Declared here so the auto-compact `ide-native` hook writer reads the
    // path off the adapter instead of assuming a Claude-specific filename —
    // see `IdeSettingsLocation.localSettingsFileName`.
    localSettingsFileName: 'settings.local.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.claude', 'settings.json');
    }
  },
  envVar: 'CLAUDE_PROJECT_DIR',
  hookEvent: 'PreToolUse',
  toolMatcher: 'Bash',
  // Slice #009: Claude Code uses the `Task` tool for sub-agent dispatch.
  // The CLI calls `claudeCodeSubAgentDispatcher.buildToolCall` to construct
  // the exact args shape the `Task` tool expects.
  subAgentDispatcher: claudeCodeSubAgentDispatcher,
  // Slice #010 G9: Claude Code supports the PreToolUse hook event in a
  // form that can wrap `peaks sub-agent-dispatch-guard` as a sub-command.
  // Opt in to the G9 hook install.
  promptSizeAware: true,
  installHints: ['Restart Claude Code (or reload the window) so the PreToolUse hooks take effect.'],
  capabilities: {
    gateEnforce: true,
    statusline: true
  },
  // v2.13.0 AC-1 + AC-3 MVP, slice 2026-07-02-auto-compact-zero-pause:
  // Claude Code is the first IDE to fill the `compact` profile.
  // Future adapters (trae / codex / cursor / qoder / tongyi-lingma /
  // hermes / openclaw) follow the same shape — peaks-loop reads the
  // env-var and dispatches the command via `IdeAdapter.compact`, with
  // zero hard-coded IDE names anywhere in the orchestrator. If your
  // IDE exposes a context-percent env-var and a slash-style compact
  // command, register `compact` here and the auto-compact protocol
  // activates.
  //
  // Pathway = 'ide-native' (not 'shell-exec') so the dispatcher
  // routes main-session compacts through the PreToolUse hook in
  // `.claude/settings.local.json`. The hook fires
  // `peaks code auto-compact` on the NEXT Bash/Task tool
  // call from the runner, which in-band spawns `claude --compact`
  // against the CURRENT runner — not a child process (the
  // shell-exec spawn-new-claude bug documented in
  // `.peaks/memory/2026-06-27-auto-compact-design.md:139-152`).
  // Sub-agent shells still get the legacy shell-exec pathway via
  // `dispatchIdeCompact({ target: 'sub-agent' })`.
  compact: {
    envVarForContextPercent: 'CLAUDE_CONTEXT_USAGE_PERCENT',
    compactCommand: 'claude --compact',
    compactPathway: 'ide-native',
    postCompactDetectCommand: 'peaks code auto-compact --json',
    // Slice 2026-09-13-auto-compact-trigger-ownership: the key Claude Code
    // reads its auto-compact WINDOW from, in the machine-local `env` block.
    // Claude Code documents it as taking precedence "over the command, the
    // flag, and the setting", and as accepting the plain token count only
    // (no `500k` suffix). peaks-loop writes the window it computes the ratio
    // against here so the two sides cannot drift; see
    // `harness-window-config.ts`.
    autoCompactWindowEnvVar: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    readContextPercentFallback,
    // Slice 2026-09-10-context-audit-and-discipline (Slice A): the vendor
    // layout knowledge (`~/.claude/projects/**/<outerSessionId>.jsonl`)
    // stays here; `peaks code context-audit` resolves it through the
    // adapter registry, never by naming this adapter directly.
    resolveTranscriptPath: (outerSessionId: string) => resolveClaudeTranscriptPath(outerSessionId)
  },
  // Slice #011: standards profile. Claude Code reads its constitution at
  // CLAUDE.md + module-level rules under .claude/rules/**. The values mirror
  // the hardcoded paths in `src/services/standards/project-standards-service.ts`
  // (line 147 = '.claude', line 417/421 = 'CLAUDE.md' + '.claude/rules/...')
  // and the postinstall target in `scripts/install-skills.mjs` (line 427 =
  // '~/.claude/skills'). Filling the profile here makes the dispatch layer
  // route to the SAME paths, so byte-stability on `peaks standards init` for
  // Claude Code projects is preserved.
  standardsProfile: {
    rootFile: 'CLAUDE.md',
    rulesDir: '.claude/rules',
    rulesFileGlob: '**/*.md',
    autoLoaded: true,
    format: 'markdown',
    migrationHint: 'Standards live at CLAUDE.md + .claude/rules/** for Claude Code.'
  },
  // Slice #011: skill install profile. The postinstall script symlinks
  // bundled skills to `~/.claude/skills` and writes output-styles to
  // `~/.claude/output-styles`, matching the existing hardcoded
  // install-skills.mjs lines 427 + 488. The env-var back-compat name
  // matches the legacy `PEAKS_CLAUDE_SKILLS_DIR` / `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`.
  skillInstall: {
    skillsDir: join(homedir(), '.claude', 'skills'),
    outputStylesDir: join(homedir(), '.claude', 'output-styles'),
    installStrategy: 'symlink',
    envVarOverride: 'PEAKS_CLAUDE_SKILLS_DIR'
  },
  // Slice 4.0.8 RD §5: Claude Code resolves PEAKS_CALLER_ID (override) →
  // CLAUDE_CODE_SESSION_ID. Empty/invalid → typed PEAKS_CALLER_NOT_RESOLVED.
  resolveCallerId: (env?: NodeJS.ProcessEnv): string => {
    const e = env ?? process.env;
    const override = e.PEAKS_CALLER_ID;
    if (typeof override === 'string' && override.trim().length > 0) {
      const trimmed = override.trim();
      if (/^[a-zA-Z0-9._-]{1,200}$/.test(trimmed)) return trimmed;
    }
    const v = e.CLAUDE_CODE_SESSION_ID;
    if (typeof v === 'string' && v.trim().length > 0) {
      const trimmed = v.trim();
      if (/^[a-zA-Z0-9._-]{1,200}$/.test(trimmed)) return trimmed;
    }
    const err = new Error(
      'PEAKS_CALLER_NOT_RESOLVED: no Claude Code session id available'
    ) as Error & { code: string };
    err.code = 'PEAKS_CALLER_NOT_RESOLVED';
    throw err;
  }
};
