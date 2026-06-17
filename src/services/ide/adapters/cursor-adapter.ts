import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { claudeCodeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Cursor IDE adapter —— peaks-cli 的第三个内置 IDE 适配器(slice #12, 2.4.0)。
 *
 * 不可消除的 per-IDE 字段(slice #1 锁定,same shape as trae-adapter.ts):
 *   - settings.dirName = '.cursor'            : Cursor 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'
 *   - envVar = 'CURSOR_PROJECT_DIR'     : Cursor 注入的项目根 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'beforeShellExecution': Cursor 的 shell hook event key(UNVERIFIED — see R-1)
 *   - toolMatcher = 'Bash'              : Cursor 的 shell execution tool matcher
 *
 * Slice #12 status (2026-06-17, 2.4.0):
 *   - Adapter is the third built-in IDE in peaks-cli after Claude Code (#1) and Trae (#2).
 *   - Confirms the slice #1 + slice #2 architecture scales linearly: registering
 *     a new IDE is genuinely a one-entry fill of the slim `IdeAdapter` shape.
 *   - 2 UNVERIFIED fields: `envVar` (Cursor's `CURSOR_PROJECT_DIR` is the
 *     most likely candidate but not confirmed against a live Cursor install;
 *     see PRD R-2) and `hookEvent` (Cursor docs may use a different event
 *     name; see PRD R-1). Both are annotated; the framework's fallback path
 *     (legacy Claude Code install + stderr warning) handles UNVERIFIED
 *     adapters without codepath changes.
 *   - Sub-agent dispatcher reuses `claudeCodeSubAgentDispatcher` by design
 *     (slice #009 rationale — byte-level identical across adapters; per-IDE
 *     divergence can be filled in a follow-up slice if Cursor's sub-agent
 *     shape is confirmed to differ).
 *   - `standardsProfile` and `skillInstall` are intentionally UNVERIFIED —
 *     real Cursor install dogfood required. Until then, the bundled-skills
 *     postinstall writes to `~/.claude/skills/` (legacy Claude Code fallback
 *     per slice #011 framework), with a stderr warning. Users on Cursor who
 *     want skills visible to Cursor's auto-loader must move the symlinks
 *     to `~/.cursor/skills/` manually (the warning text says so).
 *   - L1 install scope default = `project` (writes to `<projectRoot>/.cursor/settings.json`).
 *     `--scope global` is the explicit global path; the L1 default is the
 *     safer opt-in per slice #012 PRD scope clarification.
 */
export const CURSOR_ADAPTER: IdeAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  settings: {
    dirName: '.cursor',
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.cursor', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'CURSOR_PROJECT_DIR', // UNVERIFIED — see slice #12 PRD R-2; fallback path still works
  hookEvent: 'beforeShellExecution', // UNVERIFIED — see slice #12 PRD R-1; re-verify against Cursor's published hook schema
  toolMatcher: 'Bash',
  // Slice #12: Cursor sub-agent tool name TBD on real dogfood. Reusing the
  // Claude Code dispatcher as a uniform placeholder (byte-level identical by
  // design so the dispatcher's return shape is uniform across adapters —
  // see slice #009 rationale). When real Cursor dogfood lands, replace the
  // body of `claudeCodeSubAgentDispatcher.buildToolCall` (or add a
  // `cursorSubAgentDispatcher`) without changing the adapter contract.
  subAgentDispatcher: claudeCodeSubAgentDispatcher,
  // Slice #12: Cursor supports `beforeShellExecution` which can wrap
  // `peaks sub-agent-dispatch-guard`. Opt in (matches the byte-stable
  // slice #008 install entry shape — same pattern as Trae adapter).
  promptSizeAware: true,
  installHints: [
    'Restart Cursor so the beforeShellExecution hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    // Cursor has a statusline UI (Cmd+Shift+P → "Cursor: Open Status Bar")
    // that can host peaks statusline output, so opt in to the capability.
    statusline: true,
  }
  // Standards: UNVERIFIED — see slice #012+ (Cursor real-install dogfood for
  // the `standardsProfile` and `skillInstall` fields). Until then, `peaks
  // standards init` on a Cursor-detected project falls back to the Claude
  // Code path (CLAUDE.md + .claude/rules/**) with a stderr warning, and the
  // postinstall script writes skills + output-styles to the legacy
  // `~/.claude/{skills,output-styles}` paths with a stderr warning. Users
  // who want Cursor-specific paths must move the files manually.
};
