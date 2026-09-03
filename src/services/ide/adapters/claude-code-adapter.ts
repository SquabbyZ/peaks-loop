import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
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
  } catch (err) { // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err;  // surface module-load bugs
    if (err instanceof SyntaxError) throw err;     // surface parse bugs (e.g. broken statusline JSON)
    return null;                                    // only swallow IO errors
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
function findTranscriptJsonl(
  projectsDir: string,
  outerSessionId: string,
): string | null {
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
  } catch (err) { // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err;  // surface module-load bugs
    if (err instanceof SyntaxError) throw err;     // surface parse bugs
    return null;                                    // only swallow IO errors
  }
  return null;
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
  'CLAUDE_CODE_SUBAGENT_MODEL',
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
  const model = typeof msg.model === 'string'
    ? msg.model
    : typeof record.model === 'string' ? record.model : '';
  return { contextTokens, model };
}

/**
 * Reverse-scan the transcript jsonl (from the END) for the LATEST entry that
 * carries a numeric `message.usage`. The file can be many MB; it is read in
 * backward chunks of TRANSCRIPT_SCAN_CHUNK_BYTES — never fully into memory —
 * and stops at the first (newest) usable entry.
 */
function findLatestTranscriptUsage(filePath: string): { contextTokens: number; model: string } | null {
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
      try { closeSync(fd); } catch { /* best-effort */ }
    }
  }
}

/**
 * Resolve the context window for a transcript usage entry. Prefers the
 * explicit `modelContextWindowTokens(model)` mapping; when the observed token
 * count contradicts it (tokens exceed the mapped window), the model must be
 * ≥1M, so bump to the 1M window.
 */
function resolveContextWindowTokens(model: string, contextTokens: number): number {
  const window = modelContextWindowTokens(model);
  return contextTokens > window ? ONE_MILLION_CONTEXT_TOKENS : window;
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
 * window; otherwise the transcript `message.model` is used.
 */
function readClaudeTranscriptEstimate(
  outerSessionId: string,
  envModel?: string,
): { ratio: number; contextTokens: number; contextWindowTokens: number } | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const path = findTranscriptJsonl(projectsDir, outerSessionId);
  if (path === null) return null;
  const latest = findLatestTranscriptUsage(path);
  if (latest === null) return null;
  const model = envModel !== undefined && envModel.trim().length > 0 ? envModel : latest.model;
  const contextWindowTokens = resolveContextWindowTokens(model, latest.contextTokens);
  const ratio = Math.min(1, latest.contextTokens / contextWindowTokens);
  return { ratio, contextTokens: latest.contextTokens, contextWindowTokens };
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
function readContextPercentFallback(input: ContextPercentFallbackInput): ContextPercentProbe | null {
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
    const estimate = readClaudeTranscriptEstimate(input.outerSessionId, envModel);
    if (estimate !== null) {
      return {
        ratio: estimate.ratio,
        source: 'transcript-estimate',
        rawTokens: estimate.contextTokens,
        capacityTokens: estimate.contextWindowTokens,
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
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.claude', 'settings.json');
    },
    supportsScope: () => true,
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
  installHints: [
    'Restart Claude Code (or reload the window) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true,
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
  // `peaks compact auto` on the NEXT Bash/Task tool
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
    postCompactDetectCommand: 'peaks compact auto --json',
    readContextPercentFallback
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
    migrationHint: 'Standards live at CLAUDE.md + .claude/rules/** for Claude Code.',
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
    envVarOverride: 'PEAKS_CLAUDE_SKILLS_DIR',
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
    const err = new Error('PEAKS_CALLER_NOT_RESOLVED: no Claude Code session id available') as Error & { code: string };
    err.code = 'PEAKS_CALLER_NOT_RESOLVED';
    throw err;
  },
};
