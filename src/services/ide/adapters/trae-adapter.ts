import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';

/**
 * Trae IDE adapter —— peaks-cli 的第二个内置 IDE 适配器。
 *
 * 不可消除的 per-IDE 字段(slice #1 锁定):
 *   - settings.dirName = '.trae'            : Trae 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'  (Trae 实际叫什么待 Trae 1.x 文档确认,先按 Claude 风格)
 *   - envVar = 'TRAE_PROJECT_DIR'    : Trae 注入的 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'beforeToolCall'  : Trae 的 hook 数组 key(待 Trae 文档确认,先假设与 Cursor 同名)
 *   - toolMatcher = 'terminal'      : Trae 的 bash 工具 matcher(待 Trae 文档确认)
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
 */
export const TRAE_ADAPTER: IdeAdapter = {
  id: 'trae',
  displayName: 'Trae',
  settings: {
    dirName: '.trae',
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.trae', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'TRAE_PROJECT_DIR',
  hookEvent: 'beforeToolCall',
  toolMatcher: 'terminal',
  installHints: [
    'Restart Trae (or reload the workspace) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    progressStart: true,
    statusline: true,
    mcpInstall: false // Trae 的 MCP 集成尚未确定,先关掉避免误导
  }
};
