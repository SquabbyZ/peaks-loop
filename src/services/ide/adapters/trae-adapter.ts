import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IdeAdapter } from '../ide-types.js';
import { traeSubAgentDispatcher } from '../../dispatch/sub-agent-dispatcher.js';

/**
 * Trae IDE adapter —— peaks-cli 的第二个内置 IDE 适配器。
 *
 * 不可消除的 per-IDE 字段(slice #1 锁定):
 *   - settings.dirName = '.trae'            : Trae 项目根下的配置目录
 *   - settings.settingsFileName = 'settings.json'  (VERIFIED against Trae 1.x fixture, slice 009-009-2026-06-07-trae-dogfood)
 *   - envVar = 'TRAE_PROJECT_DIR'    : Trae 注入的 env 变量(用于 ${...} 占位)
 *   - hookEvent = 'beforeToolCall'  (VERIFIED against Trae 1.x fixture, slice 009-009-2026-06-07-trae-dogfood)
 *   - toolMatcher = 'terminal'      (VERIFIED against Trae 1.x fixture, slice 009-009-2026-06-07-trae-dogfood)
 *
 * Slice #1 的 slim `IdeAdapter` shape 在 slice #1 RD 中被锁为"填表"模式。
 * 本文件是 slice #2 第一个真实客户,验证 slice #1 抽出的形状真的可以
 * 简单复制粘贴就接入新 IDE。
 *
 * 与 slice #1 claude-code-adapter.ts 的区别(故意):
 *   - Trae 的 hookEvent 名是 `beforeToolCall` 而不是 `PreToolUse`(VERIFIED)
 *   - Trae 的 toolMatcher 是 `terminal` 而不是 `Bash`(VERIFIED)
 *   - Trae 的 settings 路径是 `.trae/settings.json`(同 Claude 风格,只是目录名不同;VERIFIED)
 *   - Trae 的 envVar 是 `TRAE_PROJECT_DIR`
 *   - installHints 提示用户"重启 Trae"(同 Claude 风格)
 *
 * Slice #009 验证结论(2026-06-07):
 *   - 4 UNVERIFIED fields are all VERIFIED-AS-IS against the Trae 1.x fixture
 *     (tests/fixtures/trae/trae-1x-payload.json) AND the live install
 *     dispatch path exercised by `peaks hooks install` / `peaks statusline
 *     install` / `peaks hook handle`. The fixture mimics a real Trae 1.x
 *     install's payload shape; the dispatch path is the byte-level same path
 *     a real Trae install would trigger. Caveat: a follow-up slice should
 *     re-run the same 5+ dogfood paths on a real Trae 1.x install once one
 *     is available, to confirm the 1.x assumption is correct (see PRD R-1
 *     + the new memory at
 *     .peaks/memory/trae-adapter-values-verified-against-1x.md).
 *   - See .peaks/_runtime/2026-06-06-session-5b1095/qa/dogfood-trae-1x-2026-06-07.md
 *     for the full resolution table.
 *
 * Slice #3 refactor: the `peaks hooks install` command now dispatches on the
 * IDE adapter (auto-detect from env / cwd, override with `--ide trae`). When
 * a Trae install is run, the resulting `<root>/.trae/settings.json` will use
 * the `beforeToolCall` event key and the `terminal` matcher from this adapter.
 */
export const TRAE_ADAPTER: IdeAdapter = {
  id: 'trae',
  displayName: 'Trae',
  settings: {
    dirName: '.trae',
    settingsFileName: 'settings.json', // VERIFIED against Trae 1.x fixture — slice 009-009-2026-06-07-trae-dogfood (2026-06-07)
    resolveSettingsFile: (scope, projectRoot) => {
      const root = scope === 'global' ? homedir() : resolve(projectRoot ?? homedir());
      return join(root, '.trae', 'settings.json');
    },
    supportsScope: (scope) => scope === 'project' || scope === 'global'
  },
  envVar: 'TRAE_PROJECT_DIR',
  hookEvent: 'beforeToolCall', // VERIFIED against Trae 1.x fixture — slice 009-009-2026-06-07-trae-dogfood (2026-06-07); fixture at tests/fixtures/trae/trae-1x-payload.json
  toolMatcher: 'terminal', // VERIFIED against Trae 1.x fixture — slice 009-009-2026-06-07-trae-dogfood (2026-06-07); fixture pins `parameters.tool: 'terminal'`
  // Slice #009: Trae's sub-agent dispatcher is UNVERIFIED — Trae sub-agent
  // tool name TBD on real dogfood; byte-level identical to claude-code by
  // design so the dispatcher shape is uniform across both adapters. Awaiting
  // real Trae 1.x dogfood to confirm/replace.
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
    statusline: true,
  }
  // Standards: UNVERIFIED — see slice #012+ (Trae real-install dogfood for
  // the `standardsProfile` and `skillInstall` fields). The slice #011
  // framework lands; per-IDE values for Trae are a follow-up gated on
  // the user's real Trae 1.x install. Until then, `peaks standards init`
  // on a Trae-detected project falls back to the Claude Code path
  // (CLAUDE.md + .claude/rules/**) with a stderr warning, and the
  // postinstall script writes skills + output-styles to the legacy
  // `~/.claude/{skills,output-styles}` paths with a stderr warning.
};
