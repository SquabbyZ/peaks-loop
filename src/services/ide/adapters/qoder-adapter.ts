/**
 * Qoder IDE adapter (slice 2026-07-25-qoder-adapter-ship) — peaks-loop
 * 第八个内置 IDE 适配器(填表)。
 *
 * 不可消除的 per-IDE 字段(本 slice 填表;字段值暂为占位):
 *   - settings.dirName = '.qoder'          : Qoder 项目根下的配置目录(UNVERIFIED)
 *   - settings.settingsFileName = 'settings.json'(UNVERIFIED)
 *   - envVar = 'QODER_PROJECT_DIR'         : Qoder 注入的 env 变量(UNVERIFIED)
 *   - hookEvent = 'PreToolUse'             : 现代 IDE 通用约定(UNVERIFIED — 待真实 Qoder 安装验证)
 *   - toolMatcher = 'Bash'                 : 同上(UNVERIFIED)
 *
 * Slice 2026-07-25-qoder-adapter-ship 状态:
 *   - Slim adapter shape 跟 hermes-adapter.ts / claude-code-adapter.ts 同型,
 *     验证 slice #1 抽出的形状在第 8 个 IDE 上仍然可以"填表"接入。
 *   - 5 fields (dirName / settingsFileName / envVar / hookEvent / toolMatcher)
 *     均为占位值并标记 UNVERIFIED;待真实 Qoder 安装可用后再走 VERIFIED 路径
 *     (见 PRD §3 step 5 + 多 IDE 治理政策
 *     .peaks/memory/2026-07-24-multi-ide-adapter-policy.md)。
 *   - 见 [[2026-07-24-multi-ide-adapter-policy]] 了解 UNVERIFIED → VERIFIED
 *     的迁移路径与 7-step checklist。
 *   - 本 slice 不修改 src/services/ide/ide-types.ts(IdeId union 已经在
 *     line 21 包含 'qoder'),不修改既有 adapter 文件,不修改既有测试。
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

export const QODER_ADAPTER: IdeAdapter = {
  id: 'qoder',
  displayName: 'Qoder',
  settings: {
    dirName: '.qoder', // UNVERIFIED — placeholder; pending real Qoder 1.x fixture
    settingsFileName: 'settings.json', // UNVERIFIED — placeholder
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.qoder', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'QODER_PROJECT_DIR', // UNVERIFIED
  hookEvent: 'PreToolUse', // UNVERIFIED
  toolMatcher: 'Bash', // UNVERIFIED
  // Slice 2026-07-25-qoder-adapter-ship: Qoder sub-agent dispatcher UNVERIFIED —
  // pending real Qoder dogfood. Reusing the Trae dispatcher as a uniform
  // placeholder (same rationale as hermes-adapter.ts: byte-stable shape
  // across placeholder adapters).
  subAgentDispatcher: traeSubAgentDispatcher,
  // Slice 2026-07-25-qoder-adapter-ship: Qoder PreToolUse is the assumed hook
  // path. UNVERIFIED — will be re-evaluated against a real Qoder install.
  promptSizeAware: true,
  installHints: [
    'Restart Qoder (or reload the workspace) so the PreToolUse hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    statusline: true
  }
};