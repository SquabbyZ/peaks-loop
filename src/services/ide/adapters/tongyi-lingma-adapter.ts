/**
 * Tongyi Lingma IDE adapter (slice 2026-07-25-tongyi-lingma-adapter-ship) —
 * peaks-loop 第九个内置 IDE 适配器(填表)。
 *
 * 不可消除的 per-IDE 字段(本 slice 填表;字段值暂为占位):
 *   - settings.dirName = '.lingma'                 (UNVERIFIED)
 *   - settings.settingsFileName = 'settings.json' (UNVERIFIED)
 *   - envVar = 'TONGYI_LINGMA_PROJECT_DIR'         (UNVERIFIED)
 *   - hookEvent = 'PreToolUse'                     (UNVERIFIED)
 *   - toolMatcher = 'Bash'                         (UNVERIFIED)
 *
 * 这些字段在真实 Tongyi Lingma 安装 dogfood 完成前不得标记 VERIFIED。
 * 见 [[2026-07-24-multi-ide-adapter-policy]] §3 step 5。
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

export const TONGYI_LINGMA_ADAPTER: IdeAdapter = {
  id: 'tongyi-lingma',
  displayName: 'Tongyi Lingma',
  settings: {
    dirName: '.lingma', // UNVERIFIED — placeholder; pending real Tongyi Lingma fixture
    settingsFileName: 'settings.json', // UNVERIFIED — placeholder
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.lingma', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'TONGYI_LINGMA_PROJECT_DIR', // UNVERIFIED
  hookEvent: 'PreToolUse', // UNVERIFIED
  toolMatcher: 'Bash', // UNVERIFIED
  // UNVERIFIED — reuse Trae's dispatcher until real-install dogfood confirms
  // Tongyi Lingma's native sub-agent dispatch surface.
  subAgentDispatcher: traeSubAgentDispatcher,
  // UNVERIFIED — PreToolUse is the assumed hook path.
  promptSizeAware: true,
  installHints: [
    'Restart Tongyi Lingma (or reload the workspace) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true
  }
};
