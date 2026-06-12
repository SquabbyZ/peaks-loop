/**
 * Hermes IDE adapter (Slice #0.7) — peaks-cli 的第七个内置 IDE 适配器。
 *
 * 不可消除的 per-IDE 字段(slice #0.7 填表):
 *   - settings.dirName = '.hermes'          : Hermes 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'
 *   - envVar = 'HERMES_PROJECT_DIR'   : Hermes 注入的 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'PreToolUse'        : 现代 IDE 通用约定(UNVERIFIED — 待真实 Hermes 安装验证)
 *   - toolMatcher = 'Bash'            : 同上(UNVERIFIED)
 *
 * Slice #0.7 状态:
 *   - Slim adapter shape 跟 trae-adapter.ts / claude-code-adapter.ts 同型,
 *     验证 slice #1 抽出的形状在第 7 个 IDE 上仍然可以"填表"接入。
 *   - 4 UNVERIFIED fields (hookEvent, toolMatcher, envVar, dirName) 在
 *     Hermes 真实安装可用前均为占位值;待真实 Hermes fixture 验证后
 *     跟 trae-adapter 一样会被 VERIFIED 标记。
 *   - 见 PRD §0.7 + memory trae-adapter-values-verified-against-1x.md
 *     了解 UNVERIFIED → VERIFIED 的迁移路径。
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

export const HERMES_ADAPTER: IdeAdapter = {
  id: 'hermes',
  displayName: 'Hermes',
  settings: {
    dirName: '.hermes', // UNVERIFIED — placeholder; pending real Hermes 1.x fixture
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.hermes', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'HERMES_PROJECT_DIR', // UNVERIFIED
  hookEvent: 'PreToolUse', // UNVERIFIED
  toolMatcher: 'Bash', // UNVERIFIED
  // Slice #0.7: Hermes sub-agent dispatcher UNVERIFIED — pending real Hermes
  // dogfood. Reusing the Trae dispatcher as a uniform placeholder (byte-stable
  // shape per slice #008; same rationale as Trae adapter).
  subAgentDispatcher: traeSubAgentDispatcher,
  // Slice #010 G9: Hermes PreToolUse is the assumed hook path. UNVERIFIED.
  promptSizeAware: true,
  installHints: [
    'Restart Hermes (or reload the workspace) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true
  }
};
