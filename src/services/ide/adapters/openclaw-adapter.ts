/**
 * OpenClaw IDE adapter (Slice #0.7) — peaks-loop 的第八个内置 IDE 适配器。
 *
 * 不可消除的 per-IDE 字段(slice #0.7 填表):
 *   - settings.dirName = '.openclaw'        : OpenClaw 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'
 *   - envVar = 'OPENCLAW_PROJECT_DIR' : OpenClaw 注入的 env 变量
 *   - hookEvent = 'PreToolUse'        : 现代 IDE 通用约定(UNVERIFIED)
 *   - toolMatcher = 'Bash'            : 同上(UNVERIFIED)
 *
 * Slice #0.7 状态: 同 hermes-adapter.ts 的 UNVERIFIED 占位说明。
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

export const OPENCLAW_ADAPTER: IdeAdapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  settings: {
    dirName: '.openclaw', // UNVERIFIED
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.openclaw', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'OPENCLAW_PROJECT_DIR', // UNVERIFIED
  hookEvent: 'PreToolUse', // UNVERIFIED
  toolMatcher: 'Bash', // UNVERIFIED
  // Slice #0.7: OpenClaw sub-agent dispatcher UNVERIFIED. Reusing Trae
  // dispatcher as uniform placeholder.
  subAgentDispatcher: traeSubAgentDispatcher,
  promptSizeAware: true,
  installHints: [
    'Restart OpenClaw (or reload the workspace) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true
  }
};
