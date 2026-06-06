import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { claudeCodeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Claude Code adapter —— peaks-cli 的"起源 IDE"。
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
  subAgentToolMatcher: 'Task',
  // Slice #009: Claude Code uses the `Task` tool for sub-agent dispatch.
  // The CLI calls `claudeCodeSubAgentDispatcher.buildToolCall` to construct
  // the exact args shape the `Task` tool expects.
  subAgentDispatcher: claudeCodeSubAgentDispatcher,
  installHints: [
    'Restart Claude Code (or reload the window) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    progressStart: true,
    statusline: true,
    mcpInstall: true,
  },
};
