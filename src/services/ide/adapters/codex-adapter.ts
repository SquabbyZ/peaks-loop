import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { claudeCodeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Codex (OpenAI CLI IDE) adapter —— peaks-cli 的第四个内置 IDE 适配器(slice #13, 2.4.0)。
 *
 * 不可消除的 per-IDE 字段(slice #1 锁定,same shape as trae-adapter.ts / cursor-adapter.ts):
 *   - settings.dirName = '.codex'        : Codex 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'
 *   - envVar = 'CODEX_PROJECT_DIR'  : Codex 注入的项目根 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'pre_tool_use'    : Codex 的 lowercase snake_case hook event(UNVERIFIED — see R-3)
 *   - toolMatcher = 'shell'         : Codex 的 shell command matcher
 *
 * Slice #13 status (2026-06-17, 2.4.0):
 *   - Adapter is the fourth built-in IDE in peaks-cli after Claude Code (#1),
 *     Trae (#2), and Cursor (#12). It further confirms the slice #1 + slice #2
 *     architecture scales linearly: registering a new IDE is a one-entry fill
 *     of the slim `IdeAdapter` shape with no dispatch-chokepoint changes.
 *   - 2 UNVERIFIED fields: `hookEvent` (Codex's `pre_tool_use` is the standard
 *     lowercase snake_case pattern but not confirmed against a live Codex
 *     install; see PRD R-3) and `envVar` (Codex's `CODEX_PROJECT_DIR` is the
 *     most likely candidate). Both are annotated; the framework's fallback
 *     path (legacy Claude Code install + stderr warning) handles UNVERIFIED
 *     adapters without codepath changes.
 *   - `promptSizeAware: false` — Codex's hook event semantics differ from
 *     Claude's. Opt out of the G9 prompt-size gate until real-install
 *     dogfood confirms hook layer compatibility (PRD R-3). The CLI 兜底
 *     layer in `peaks sub-agent dispatch` still enforces the threshold
 *     regardless — `promptSizeAware` only controls the hook layer.
 *   - `capabilities.statusline: false` — Codex CLI does not have a
 *     statusline UI surface. `peaks statusline install --ide codex` will
 *     exit non-zero with a clear stderr message (CLI does NOT crash;
 *     capability-check contract preserved per slice #008 P-5).
 *   - Sub-agent dispatcher reuses `claudeCodeSubAgentDispatcher` by design
 *     (slice #009 rationale — byte-level identical across adapters; per-IDE
 *     divergence can be filled in a follow-up slice if Codex's sub-agent
 *     shape is confirmed to differ).
 *   - `standardsProfile` and `skillInstall` are intentionally UNVERIFIED —
 *     real Codex install dogfood required. Until then, the bundled-skills
 *     postinstall writes to `~/.claude/skills/` (legacy Claude Code fallback
 *     per slice #011 framework), with a stderr warning. Users on Codex who
 *     want skills visible to Codex's auto-loader must move the symlinks
 *     to `~/.codex/skills/` manually (the warning text says so).
 *   - L1 install scope default = `project` (writes to `<projectRoot>/.codex/settings.json`).
 *     `--scope global` is the explicit global path; the L1 default is the
 *     safer opt-in per slice #012 PRD scope clarification.
 */
export const CODEX_ADAPTER: IdeAdapter = {
  id: 'codex',
  displayName: 'Codex',
  settings: {
    dirName: '.codex',
    settingsFileName: 'settings.json',
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.codex', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'CODEX_PROJECT_DIR', // UNVERIFIED — see slice #13 PRD R-3; fallback path still works
  hookEvent: 'pre_tool_use', // UNVERIFIED — Codex lowercase snake_case pattern; re-verify against Codex docs
  toolMatcher: 'shell',
  // Slice #13: Codex sub-agent tool name TBD on real dogfood. Reusing the
  // Claude Code dispatcher as a uniform placeholder (byte-level identical by
  // design so the dispatcher's return shape is uniform across adapters —
  // see slice #009 rationale). When real Codex dogfood lands, replace the
  // body of `claudeCodeSubAgentDispatcher.buildToolCall` (or add a
  // `codexSubAgentDispatcher`) without changing the adapter contract.
  subAgentDispatcher: claudeCodeSubAgentDispatcher,
  // Slice #13: Codex's `pre_tool_use` event semantics differ from Claude's
  // `PreToolUse`. Opt out of the G9 prompt-size gate until real-install
  // dogfood confirms hook layer compatibility. The CLI 兜底 layer in
  // `peaks sub-agent dispatch` still enforces the threshold regardless.
  promptSizeAware: false,
  installHints: [
    'Restart Codex so the pre_tool_use hooks take effect.'
  ],
  capabilities: {
    gateEnforce: true,
    // Codex CLI does not have a statusline UI surface. Opt out of the
    // statusline capability; `peaks statusline install --ide codex` will
    // return a clear "not supported" stderr message (slice #008 P-5
    // capability-check contract preserved).
    statusline: false,
  }
  // Standards: UNVERIFIED — see slice #013+ (Codex real-install dogfood for
  // the `standardsProfile` and `skillInstall` fields). Until then, `peaks
  // standards init` on a Codex-detected project falls back to the Claude
  // Code path (CLAUDE.md + .claude/rules/**) with a stderr warning, and the
  // postinstall script writes skills + output-styles to the legacy
  // `~/.claude/{skills,output-styles}` paths with a stderr warning. Users
  // who want Codex-specific paths must move the files manually.
};
