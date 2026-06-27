/**
 * peaks 自有 hook 协议 + slim IDE adapter 接口。
 *
 * peaks-cli 不再适配 IDE 私有的 hook 协议;反之 peaks 定义自己的 canonical
 * schema,每个 IDE 只需要填 4 字符串 + 1 settings 函数,新 IDE 适配变成"填表"。
 *
 * 不可消除的 per-IDE 字段(诚实交代,见 PRD R-1..R-4):
 *   - settings.json 物理位置
 *   - 项目根 env 变量名
 *   - hook 事件名 + matcher 名
 *
 * 其他全部归一化到 peaks 内部模型(见 hook-protocol.ts)。
 */
import type { SubAgentDispatcher } from '../dispatch/sub-agent-dispatcher.js';

export type IdeId =
  | 'claude-code'
  | 'trae'
  | 'codex'
  | 'cursor'
  | 'qoder'
  | 'tongyi-lingma'
  | 'hermes'
  | 'openclaw';

export interface IdeCapabilities {
  /** peaks gate enforce 是否适用该 IDE(必备) */
  readonly gateEnforce: true;
  /** peaks statusline 状态栏是否适用 */
  readonly statusline: boolean;
}

export interface IdeSettingsLocation {
  /** 项目根下的 settings 目录名,例如 '.claude' / '.trae' / '.cursor' */
  readonly dirName: string;
  /** settings 文件名(部分 IDE 叫 settings.json / mcp.json) */
  readonly settingsFileName: string;
  /** 解析出 settings.json 绝对路径 */
  resolveSettingsFile(scope: 'project' | 'global', projectRoot: string | undefined): string;
  /** 该 IDE 是否支持此 scope(用于清晰报错) */
  supportsScope(scope: 'project' | 'global'): boolean;
}

/**
 * Slim IDE adapter 描述。每 IDE 一个静态常量(无需 DI)。
 * 字段故意保持少:让 adapter 的添加是"填表"而非"重写"。
 */
export interface IdeAdapter {
  readonly id: IdeId;
  /** 人类可读名,出现在 CLI help / 命令输出 */
  readonly displayName: string;
  readonly settings: IdeSettingsLocation;
  /** IDE 注入的项目根 env 变量名;`peaks gate enforce` 等命令模板会引用此 env */
  readonly envVar: string;
  /** settings.json 里 hook 数组的 key,例如 'PreToolUse' / 'beforeToolCall' */
  readonly hookEvent: string;
  /** hook 数组元素的 matcher 字段(工具名匹配),例如 'Bash' / 'Task' / 'terminal' */
  readonly toolMatcher: string;
  /**
   * Per-IDE sub-agent dispatcher. The `peaks sub-agent dispatch` CLI reads
   * this field, calls `supportsRole` + `buildToolCall`, and returns the
   * resulting tool-call descriptor in the JSON envelope. Encapsulates the per-IDE sub-agent dispatch surface (slice #009). The dispatcher's `buildToolCall` returns the IDE-native tool-call descriptor at runtime.
   *
   * Added in slice 2026-06-07-sub-agent-dispatch-decouple. See PRD #002
   * G1 (AC-1, AC-2) + [[slim-ideadapter-shape-is-the-contract]].
   */
  readonly subAgentDispatcher: SubAgentDispatcher;
  /**
   * Per-IDE opt-in to the G9 prompt-size gate. When `true`, the
   * `peaks hooks install` command registers the G9 PreToolUse hook
   * (`peaks sub-agent-dispatch-guard`) for this IDE. When `false`,
   * the hook is NOT installed (the IDE either doesn't support the
   * PreToolUse event in a useful form, or the user has opted out).
   *
   * The CLI 兜底 layer in `peaks sub-agent dispatch` still enforces
   * the threshold regardless of this field — `promptSizeAware` only
   * controls the hook layer (R-15: G9 hook is LLM-platform-specific).
   *
   * Added in slice 2026-06-07-sub-agent-context-governance. See PRD
   * #003 G9.2 + AC-56. Default `false` to preserve slice #009's
   * `peaks hooks install` output byte-stability.
   */
  readonly promptSizeAware: boolean;
  /** install / uninstall 后展示给用户的提示文本(各 IDE 不同,例如 Claude 提示重启窗口) */
  readonly installHints: readonly string[];
  /** 该 IDE 在 peaks 上可启用的能力(用于在不支持的 IDE 上软警告) */
  readonly capabilities: IdeCapabilities;
  /**
   * Where this IDE reads its project-level agent instructions from.
   * When undefined, the postinstall + `peaks standards init` codepath falls
   * back to the legacy Claude Code path (CLAUDE.md + .claude/rules/**)
   * AND emits a stderr warning. Adapters in slice 1.3.2 declare this
   * value (Claude Code), are annotated UNVERIFIED for future slices
   * (Trae, slice #012+), or omit it entirely (not-yet-registered IDEs).
   *
   * Added in slice 011-2026-06-07-ide-adapter-resource-profile.
   */
  readonly standardsProfile?: IdeStandardsProfile;
  /**
   * Where `scripts/install-skills.mjs` symlinks the bundled skills +
   * output styles. When undefined, the postinstall falls back to
   * `~/.claude/skills` + `~/.claude/output-styles` (legacy) AND emits
   * a stderr warning. Adapters that opt into the dispatch layer fill
   * this; adapters that don't (Trae in slice 1.3.2) leave it undefined
   * and follow the legacy path with a warning.
   *
   * Added in slice 011-2026-06-07-ide-adapter-resource-profile.
   */
  readonly skillInstall?: IdeSkillInstall;
  /**
   * v2.13.0 auto-compact (AC-1 + AC-3): per-IDE compact-capability
   * descriptor. When `undefined`, peaks-cli falls back to the
   * `llm-self-compress` pathway (the LLM summarizes its own context).
   * Adapters that fill this expose a 4-stage protocol so peaks-cli
   * can drive compact autonomously:
   *
   *   1. `envVarForContextPercent` — env-var the IDE sets per turn
   *      (e.g. `CLAUDE_CONTEXT_USAGE_PERCENT`). Read by AC-1.
   *   2. `compactCommand` — slash command or shell-call the IDE
   *      accepts to trigger compact (e.g. `/compact`). Dispatched
   *      by AC-3.
   *   3. `compactPathway` — `'shell-exec' | 'ide-native' |
   *      'llm-self-compress' | 'noop'`. `shell-exec` means peaks-cli
   *      spawns `compactCommand` via `child_process.spawn` (zero IDE
   *      hook required). `ide-native` means the IDE exposes a hook
   *      surface peaks-cli can write to. `llm-self-compress` is the
   *      fallback when no compact capability is registered.
   *   4. `postCompactDetectCommand` (optional) — command the LLM
   *      runner can invoke after compact to confirm ratio dropped.
   *
   * Claude Code is the MVP implementation; trae / codex / cursor /
   * qoder / tongyi-lingma / hermes / openclaw ship with
   * `compactPathway: 'llm-self-compress'` until L2-dogfood verifies
   * each IDE's actual compact surface.
   *
   * Added in slice 2026-06-27-auto-compact-protocol. See
   * `.peaks/memory/2026-06-27-auto-compact-design.md`.
   */
  readonly compact?: IdeCompactProfile;
}

/**
 * Per-IDE auto-compact capability descriptor. See `IdeAdapter.compact`
 * for the protocol contract. The `MvpCompactPathway` string union
 * keeps the field exhaustive — adding a new pathway requires updating
 * every adapter that opts in.
 */
export interface IdeCompactProfile {
  /** Env-var name the IDE writes per turn to expose context-fill %. */
  readonly envVarForContextPercent: string;
  /**
   * Slash command or shell-call to invoke compact. The orchestrator
   * spawns this via `child_process.spawn` (shell-exec pathway) or
   * writes it to an IDE hook file (ide-native pathway).
   */
  readonly compactCommand: string;
  /**
   * `shell-exec` — peaks-cli spawns the command via child_process
   *                (works for any IDE that accepts a slash command
   *                via a shell-spawnable entry point).
   * `ide-native` — peaks-cli writes to an IDE-specific hook file;
   *                used when the IDE requires a registered hook
   *                rather than a runtime command.
   * `llm-self-compress` — peaks-cli prompts the LLM to summarize
   *                its own context (no IDE integration required;
   *                least precise but always available).
   * `noop` — peaks-cli records the intent but performs no action;
   *          used by IDEs that explicitly opt out (e.g. legacy
   *          adapters still on the v2.11.x model).
   */
  readonly compactPathway: 'shell-exec' | 'ide-native' | 'llm-self-compress' | 'noop';
  /**
   * Optional command the runner invokes post-compact to confirm
   * ratio dropped (e.g. `peaks context now --json`). When omitted,
   * the orchestrator polls `envVarForContextPercent` directly.
   */
  readonly postCompactDetectCommand?: string;
}

/**
 * Per-IDE standards-file location + format profile. Used by the
 * `peaks standards init` dispatch layer (slice 011) to write the
 * project-level standards files at the IDE-specific path, not the
 * Claude Code hardcoded one. Adapters that omit this field trigger
 * the legacy Claude Code path with a stderr warning.
 */
export interface IdeStandardsProfile {
  /** Filename for the project-root constitution (e.g. 'CLAUDE.md'), or null if the IDE has no equivalent. */
  readonly rootFile: string | null;
  /** Directory for module-level rules (e.g. '.claude/rules'), or null if the IDE has no equivalent. */
  readonly rulesDir: string | null;
  /** Glob under rulesDir to enumerate rule files. */
  readonly rulesFileGlob: string;
  /** True if the IDE auto-loads these files at session start. */
  readonly autoLoaded: boolean;
  /** Output format. markdown = plain text; markdown+frontmatter = adds YAML frontmatter to each rule file. */
  readonly format: 'markdown' | 'markdown+frontmatter';
  /** Human-readable hint surfaced in the fallback warning. */
  readonly migrationHint?: string;
}

/**
 * Per-IDE postinstall target roots. The `scripts/install-skills.mjs`
 * script consumes this to symlink the bundled skills + output styles
 * to the IDE-specific install location, with back-compat for the
 * legacy `PEAKS_CLAUDE_SKILLS_DIR` / `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`
 * env vars (precedence: explicit option > env var > IDE profile > legacy default).
 */
export interface IdeSkillInstall {
  /** Absolute path under which the postinstall script symlinks the bundled `skills/` directory. */
  readonly skillsDir: string;
  /** Absolute path under which the postinstall script writes the bundled `output-styles/`. Null if the IDE has no equivalent. */
  readonly outputStylesDir: string | null;
  /** Symlink strategy. */
  readonly installStrategy: 'symlink' | 'copy';
  /** Back-compat env var name (e.g. PEAKS_CLAUDE_SKILLS_DIR). Null if no env var is supported. */
  readonly envVarOverride: string | null;
}

/** peaks canonical hook schema 版本标识 */
export const PEAKS_HOOK_SCHEMA = 'peaks-hook/v1' as const;

/** peaks canonical hook 形态 —— 单一协议,所有 IDE 经 hook-translator 归一化到此 */
export interface PeaksCanonicalHook {
  readonly schema: typeof PEAKS_HOOK_SCHEMA;
  readonly event: 'pre-tool-use' | 'post-tool-use' | 'sub-agent-start';
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  /** 解析自 env 变量或 --project 的项目根 */
  readonly projectRoot: string;
  /** 选输出格式 */
  readonly rawIdeFormat: IdeId;
  /** 原始 stdin,留作回退 */
  readonly rawPayload: unknown;
}

/** peaks 决策发回形态枚举(按 IDE 期望的"发回"形式) */
export type PeaksDecisionTransport =
  | { kind: 'stdout-json'; denyShape: Record<string, unknown> }
  | { kind: 'exit-code'; denyCode: number }
  | { kind: 'both'; denyShape: Record<string, unknown>; denyCode: number };
