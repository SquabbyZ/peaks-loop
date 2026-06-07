import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Trae IDE adapter —— peaks-cli 的第二个内置 IDE 适配器。
 *
 * 不可消除的 per-IDE 字段(slice #1 锁定):
 *   - settings.dirName = '.trae'            : Trae 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'  (UNVERIFIED at slice time: Trae 实际叫什么待 Trae 1.x 文档确认,先按 Claude 风格)
 *   - envVar = 'TRAE_PROJECT_DIR'    : Trae 注入的 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'beforeToolCall'  : UNVERIFIED — Trae 的 hook 数组 key(待 Trae 文档确认,先假设与 Cursor 同名)
 *   - toolMatcher = 'terminal'      : UNVERIFIED — Trae 的 bash 工具 matcher(待 Trae 文档确认)
 *
 * Slice #1 的 slim `IdeAdapter` shape 在 slice #1 RD 中被锁为"填表"模式。
 * 本文件是 slice #2 第一个真实客户,验证 slice #1 抽出的形状真的可以
 * 简单复制粘贴就接入新 IDE。
 *
 * 与 slice #1 claude-code-adapter.ts 的区别(故意):
 *   - Trae 的 hookEvent 名是 `beforeToolCall` 而不是 `PreToolUse`(假设)
 *   - Trae 的 toolMatcher 是 `terminal` 而不是 `Bash`(假设)
 *   - Trae 的 settings 路径是 `.trae/settings.json`(同 Claude 风格,只是目录名不同)
 *   - Trae 的 envVar 是 `TRAE_PROJECT_DIR`
 *   - installHints 提示用户"重启 Trae"(同 Claude 风格)
 *
 * 等 Trae 真实文档/真实用户的 dogfood 之后,可能需要把 hookEvent /
 * toolMatcher 替换为 Trae 实际值。slice #2 的 tech-doc 里要明确"此 adapter
 * 是基于 1.x 假设,Trae 真实集成需要在 Trae 上 dogfood 验证"。
 *
 * Slice #3 refactor: the `peaks hooks install` command now dispatches on the
 * IDE adapter (auto-detect from env / cwd, override with `--ide trae`). When
 * a Trae install is run, the resulting `<root>/.trae/settings.json` will use
 * the `beforeToolCall` event key and the `terminal` matcher from this adapter.
 * Until a real Trae 1.x install dogfoods the byte-level output, treat the
 * UNVERIFIED fields as best-effort defaults.
 */
export const TRAE_ADAPTER: IdeAdapter = {
  id: 'trae',
  displayName: 'Trae',
  settings: {
    dirName: '.trae',
    settingsFileName: 'settings.json', // UNVERIFIED — see slice #2 closeout code-review M-1
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.trae', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'TRAE_PROJECT_DIR',
  hookEvent: 'beforeToolCall', // UNVERIFIED — see slice #2 closeout code-review M-1; will be validated when a real Trae 1.x install dogfoods the install path
  toolMatcher: 'terminal', // UNVERIFIED — see slice #2 closeout code-review M-1
  subAgentToolMatcher: 'Task', // UNVERIFIED — Trae's sub-agent tool name is unknown; matches the prior hardcoded 'Task' literal so byte-level install output is unchanged. Will be dogfooded when a real Trae 1.x install dispatches a sub-agent.
  // Slice #009: Trae's sub-agent dispatcher is UNVERIFIED — Trae sub-agent
  // tool name TBD on real dogfood; byte-level identical to claude-code by
  // design so the slice #008 `subAgentToolMatcher: 'Task'` install entry
  // stays byte-stable. Awaiting real Trae 1.x dogfood to confirm/replace.
  subAgentDispatcher: traeSubAgentDispatcher,
  // Slice #010 G9: Trae supports `beforeToolCall` which can wrap
  // `peaks sub-agent-dispatch-guard`. Opt in (matches the byte-stable
  // slice #008 install entry shape).
  promptSizeAware: true,
  installHints: [
    'Restart Trae (or reload the workspace) so the beforeToolCall hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    progressStart: true,
    statusline: true,
    mcpInstall: false // Trae 的 MCP 集成尚未确定,先关掉避免误导
  }
};
