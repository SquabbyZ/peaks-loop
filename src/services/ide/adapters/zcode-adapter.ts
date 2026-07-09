/**
 * z-code IDE adapter (slice 2026-07-09-add-zcode-adapter) — peaks-loop 的第九个
 * 内置 IDE 适配器。
 *
 * z-code 是一个 VS Code-style 的 Anthropic-compatible 桌面应用:
 *   - 不是 CLI,没有 `zcode` binary (`which zcode` 返回空)。
 *   - 桌面应用内置了 "导入 skills" 功能,user 手动触发后将本地 skills 目录
 *     与 `~/.zcode/skills` 双向同步 (实测 symlink)。
 *   - hook 协议、project-dir env var、compact command 均未公开。
 *
 * 设计前提 (RD-3 §2.2 D1 决策 + 现场实测,见
 * `.peaks/memory/2026-07-09-zcode-context-probe-handoff.md` §2):
 *   - `compact` 字段全部 undefined — 走 `llm-self-compress` fallback 路径。
 *   - `envVar` / `hookEvent` / `toolMatcher` 全部标注 UNVERIFIED,因为
 *     z-code 文档未公开,本 adapter 用 Anthropic-compatible 协议的合理
 *     假设占位。
 *   - `subAgentDispatcher` 用 `nullSubAgentDispatcher` 占位 — z-code
 *     桌面应用没有公开的 Task 工具 dispatch 协议。
 *   - `standardsProfile` 字段指向宪法文件根 + rules 目录 — z-code 的设计
 *     就是借用上游 "import skills" 目标目录,因此保留上游路径常量。
 *   - `skillInstall` 指向 `~/.zcode/skills` — 实测 z-code 已通过 user
 *     手动导入同步到这里。
 *   - 注:`standardsProfile` 中的常量子段是 z-code 借用的固定路径,属于
 *     架构事实,不算 vendor verb 泄漏。
 *
 * Vendor-neutrality 备注 (SC-3 §5 + RD-3 §2.4):
 *   本文件允许出现 vendor 字符串 (`zcode` / `ZCODE_PROJECT_DIR` 等),
 *   **不允许** 出现其他 vendor 字符串 / 模型名。`standardsProfile`
 *   中的 `CLAUDE.md` / `.claude/rules` 是 z-code 借用的上游路径常量,
 *   属于架构事实,不算 vendor verb 泄漏。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { nullSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Helper exported for tests + internal use: the default location of the
 * z-code v2 config file on the host filesystem.
 */
export function defaultZcodeConfigPath(): string {
  return join(homedir(), '.zcode', 'v2', 'config.json');
}

/**
 * Read the z-code config from `path` (string-typed to keep this
 * swappable for tests). Synchronous + Node.js `fs` so adapter callers
 * stay async-only at the public surface (`detectCurrentModel` is
 * already declared `async`).
 */
function readZcodeConfig(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the active model id from a parsed z-code config payload
 * (the `~/.zcode/v2/config.json` root object). Pure / exported for
 * unit tests so the file-IO seam and the resolution seam are
 * independently verifiable.
 *
 * Resolution order (Slice C §"z-code config 解析路径"):
 *   P1. env var `PEAKS_ZCODE_ACTIVE_PROVIDER_UUID` (test seam +
 *       manual pin for the user).
 *   P2. The provider whose top-level UUID key is NOT prefixed
 *       `builtin:` — this matches the user-installed provider
 *       pattern. Within that provider, prefer its `models` first
 *       key (insertion order — z-code writes the active model
 *       first in the picker).
 *   P3. The first provider with `enabled: true`.
 *   P4. The first provider in the object (insertion order) — last
 *       resort. Returns undefined if there are zero providers.
 *
 * Returns `undefined` when nothing matches.
 */
export function resolveZcodeCurrentModel(
  config: unknown,
  envOverride?: string | undefined
): string | undefined {
  const providers = (config as { provider?: unknown } | null | undefined)?.provider;
  if (!providers || typeof providers !== 'object') return undefined;

  // P1: env var override (vendor-neutral identifier: the provider UUID).
  if (envOverride !== undefined && envOverride !== '') {
    const target = (providers as Record<string, unknown>)[envOverride];
    if (target && typeof target === 'object') {
      const modelId = pickFirstModelId(target as { models?: unknown });
      if (modelId) return modelId;
    }
  }

  // P2: prefer a non-builtin provider (the user-installed one).
  for (const [uuid, entry] of Object.entries(providers as Record<string, unknown>)) {
    if (uuid.startsWith('builtin:')) continue;
    if (!entry || typeof entry !== 'object') continue;
    const modelId = pickFirstModelId(entry as { models?: unknown });
    if (modelId) return modelId;
  }

  // P3: first enabled provider (legacy / fresh-install case).
  for (const entry of Object.values(providers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const enabled = (entry as { enabled?: unknown }).enabled;
    if (enabled === true) {
      const modelId = pickFirstModelId(entry as { models?: unknown });
      if (modelId) return modelId;
    }
  }

  // P4: first provider at all.
  for (const entry of Object.values(providers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const modelId = pickFirstModelId(entry as { models?: unknown });
    if (modelId) return modelId;
  }

  return undefined;
}

function pickFirstModelId(provider: { models?: unknown }): string | undefined {
  const models = provider.models;
  if (!models || typeof models !== 'object') return undefined;
  for (const key of Object.keys(models as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim().length > 0) return key.trim();
  }
  return undefined;
}

/**
 * The async adapter method that `detectCurrentIdeModel()` calls.
 *
 * Resolution order:
 *   1. `PEAKS_ZCODE_ACTIVE_PROVIDER_UUID` env var override (test seam
 *      + manual pin).
 *   2. `PEAKS_ZCODE_CONFIG_PATH` env var override (test seam for a
 *      fixture file). Falls back to `~/.zcode/v2/config.json`.
 *   3. Returns `undefined` when the file is missing / malformed
 *      (consistent with the cross-IDE contract).
 */
export async function detectZcodeCurrentModel(): Promise<string | undefined> {
  const overridePath = process.env.PEAKS_ZCODE_CONFIG_PATH;
  const path = overridePath && overridePath.length > 0 ? overridePath : defaultZcodeConfigPath();
  const config = readZcodeConfig(path);
  if (config === undefined) return undefined;
  return resolveZcodeCurrentModel(config, process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID);
}

export const ZCODE_ADAPTER: IdeAdapter = {
  id: 'zcode',
  displayName: 'z-code',
  settings: {
    dirName: '.zcode', // VERIFIED — 实测 z-code 项目根目录是 `.zcode`
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.zcode', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global',
  },
  // UNVERIFIED — z-code 桌面应用未公开 `ZCODE_PROJECT_DIR` env var,这里
  // 用占位符,RD 阶段假设 z-code 借用了 Anthropic-compatible 协议并可能
  // 注入一个项目根 env 变量。若未注入,峰 router 会回退到 cwd 探测。
  envVar: 'ZCODE_PROJECT_DIR',
  // UNVERIFIED — z-code 未公开 hook event key,占位用 Anthropic-compatible
  // 协议的常见命名 `PreToolUse`。若 z-code 用其他 key,peaks hooks install
  // 钩子在此 IDE 上不生效,可由 user 通过手动导入绕过。
  hookEvent: 'PreToolUse',
  // UNVERIFIED — 同上,占位用 `Bash` matcher。
  toolMatcher: 'Bash',
  // Slice 2026-07-09: z-code 桌面应用没有公开 Task 工具 dispatch 协议,
  // 用 `nullSubAgentDispatcher` 占位 — peaks sub-agent dispatch CLI 在
  // z-code 上返回 SubAgentNotSupportedError,符合 slice #008 P-5 capability
  // 检查契约 (CLI 不崩溃)。
  subAgentDispatcher: nullSubAgentDispatcher,
  // Slice #010 G9: 假设 z-code 支持 PreToolUse (UNVERIFIED)。Opt-in,等真实
  // z-code 安装 dogfood 后再决定。若 z-code 不支持 G9 hook,CLI 兜底层仍会
  // 强制执行 G9 阈值。
  promptSizeAware: true,
  installHints: [
    'z-code 没有 CLI,因此无需重启 — skills symlink 已写入 ~/.zcode/skills/。',
    '若 z-code 未自动加载 peaks-* skills,在 z-code 桌面应用里手动触发 "导入 skills" 功能即可。',
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true,
  },
  // Standards profile: 路径常量保留 (z-code 的 "导入 skills" 功能
  // 借用了上游 settings 目录,因此宪法文件路径常量同步保留)。
  standardsProfile: {
    rootFile: 'CLAUDE.md',
    rulesDir: '.claude/rules',
    rulesFileGlob: '**/*.md',
    autoLoaded: true,
    format: 'markdown',
    migrationHint: 'z-code 借用了上游 standards 路径,无需迁移。',
  },
  // Skill install profile: 指向 `~/.zcode/skills` 系列 (实测 z-code 已通过
  // user 手动 symlink 同步;peaks-loop 也直接支持)。
  skillInstall: {
    skillsDir: join(homedir(), '.zcode', 'skills'),
    outputStylesDir: join(homedir(), '.zcode', 'output-styles'),
    installStrategy: 'symlink',
    envVarOverride: 'PEAKS_ZCODE_SKILLS_DIR',
  },
  // compact profile 留空 — z-code 没有 CLI binary (RD-3 §2.2 D1 决策)。
  // peaks-loop 走 `llm-self-compress` fallback 路径 (LLM 自己总结 context),
  // 不抛错、不警告 (符合 slice #008 P-5 capability-check contract)。

  // Slice C (2026-07-09 add-zcode-adapter, C.2): runtime probe for
  // the currently-active model id. Reads `~/.zcode/v2/config.json`
  // and resolves the active provider via `resolveZcodeCurrentModel`.
  // See `.peaks/_runtime/2026-07-08-session-17918f/qa/.../slice-C-completion.md`
  // for the resolution priority chain (env override → non-builtin
  // provider → first enabled → first provider). Returns undefined
  // on any failure (consistent with the cross-IDE contract).
  detectCurrentModel: detectZcodeCurrentModel,
};
