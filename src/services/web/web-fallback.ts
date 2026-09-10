/**
 * The degradation chain, in one place (slice S3, file 19; AC5, tech-doc §5.4).
 *
 * Design §6 orders the chain: 1 local browser → 2 lazy download → 3 MCP
 * fallback → 4 explicit error + install guidance. Orchestrator decision C3 is
 * binding on how tiers 3 and 4 are represented here: they are **not a branch
 * this process can take**. Whether `mcp__playwright__*` is available is harness
 * state — the CLI is a subprocess and cannot see the caller's tool list — so
 * the envelope carries BOTH the MCP fallback action and the install
 * instruction, and the calling LLM picks. Naming the MCP tool explicitly, and
 * saying where a screenshot taken through it lands, is what keeps the two
 * options distinguishable; a blob that reads as one undifferentiated warning
 * would defeat the purpose (C3's "consequence to keep").
 *
 * `installHint` is derived from `installCommandLine()`'s pin so the guidance
 * and the command that is actually run cannot drift apart.
 */
import { fail, type ResultEnvelope } from 'peaks-loop-shared/result';

import { PLAYWRIGHT_VERSION_PIN } from './playwright-loader.js';
import type { WebOp } from './web-protocol.js';

/** 3 = fall back to MCP and/or install locally; 4 = nothing available. */
export type DegradationTier = 3 | 4;

/**
 * The MCP tool that replaces each op on the fallback path.
 *
 * `status` / `stop` / `whoami` have no browser path at all, so they have no MCP
 * equivalent and no degradation envelope: C2's matrix keeps them working
 * (`status` reports the disabled flag, `stop` stops a process). The empty
 * string is that "no fallback exists" answer, and `degradedEnvelope` — the only
 * caller — says so rather than naming a tool that cannot do the job.
 *
 * `login` is empty for the SAME reason, and it is the one browser op where that
 * is not obvious (S4 R3). No `mcp__playwright__*` tool persists a storage state,
 * so `browser_navigate` was a dead end for the only verb whose whole purpose is
 * persistence: an envelope that told a caller to call it would contradict its own
 * `nextActions`. The machine-readable field now agrees with the human-readable
 * one.
 */
export const MCP_TOOL_FOR_OP: Record<WebOp, string> = {
  open: 'mcp__playwright__browser_navigate',
  text: 'mcp__playwright__browser_evaluate',
  snap: 'mcp__playwright__browser_snapshot',
  click: 'mcp__playwright__browser_click',
  shot: 'mcp__playwright__browser_take_screenshot',
  metrics: 'mcp__playwright__browser_evaluate',
  login: '',
  install: 'mcp__playwright__browser_install',
  status: '',
  stop: '',
  whoami: ''
};

/**
 * Design §6 tier-3 wording. Two approved artifacts spell it two ways — the
 * design says 截图会落根目录, `qa/test-cases/peaks-web.md` §5 quotes
 * 截图会落项目根目录 as "原文" — so both are carried, rather than picking one and
 * failing the other's assertion. The second half says it in English for the
 * same reason.
 */
export const MCP_ROOT_DIR_WARNING =
  'MCP fallback screenshots land in the project root（截图会落根目录 / 截图会落项目根目录）';

/** The command a user or the LLM would run to get the local path back. */
export const INSTALL_HINT = `npx --yes --package playwright@${PLAYWRIGHT_VERSION_PIN} -- playwright install chromium`;

export interface DegradedData {
  readonly tier: DegradationTier;
  /** Empty when the op has no MCP equivalent (see `MCP_TOOL_FOR_OP`). */
  readonly mcpTool: string;
  readonly installHint: string;
  /**
   * The op's own arguments, carried so the fallback is *actionable* (R9).
   * "Call `mcp__playwright__browser_navigate` instead" is not something a caller
   * can execute without the URL; `browser_evaluate` for `text`/`metrics` is not
   * something a caller can execute without the selector. Only string arguments
   * are carried — they are the op surface, and dropping the rest keeps a
   * `dispatchId`-shaped value from leaking into a fallback blob.
   */
  readonly args: Readonly<Record<string, string>>;
}

/**
 * `CODE: detail` — the same prefix convention `web-daemon-service`'s
 * `failureResponse` parses, reused here so a caller can pass either a bare
 * reason (the gate) or a coded failure (`WEB_INSTALL_FAILED: …`) and get the
 * right `code` on the envelope without a second parameter.
 */
const CODE_PREFIX_RE = /^([A-Z][A-Z0-9_]{0,63}):\s*/;

/**
 * One envelope for the whole tier-3/4 branch (C3): `ok:false`, a code, the
 * fallback tool, the install command, the op's own arguments, and the two things
 * a caller must know — the local path was skipped and where the MCP path puts
 * its screenshots.
 */
export function degradedEnvelope(
  op: WebOp,
  reason: string,
  tier: DegradationTier = 3,
  opArgs: Readonly<Record<string, unknown>> = {}
): ResultEnvelope<DegradedData> {
  const mcpTool = MCP_TOOL_FOR_OP[op];
  const code = CODE_PREFIX_RE.exec(reason)?.[1] ?? (tier === 4 ? 'WEB_UNAVAILABLE' : 'WEB_DISABLED');
  const detail = reason.replace(CODE_PREFIX_RE, '') || reason;
  return {
    ...fail<DegradedData>(
      `peaks.web.${op}`,
      code,
      `peaks web ${op} did not run locally: ${detail}`,
      { tier, mcpTool, installHint: INSTALL_HINT, args: stringArgs(opArgs) },
      nextActions(op, mcpTool)
    ),
    warnings: [`local browser skipped (${detail})`, MCP_ROOT_DIR_WARNING]
  };
}

/** The op's own string arguments — `selector`, `url` — and nothing else. */
function stringArgs(opArgs: Readonly<Record<string, unknown>>): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(opArgs)) {
    if (typeof value === 'string' && value.length > 0) {
      args[key] = value;
    }
  }
  return args;
}

function nextActions(op: WebOp, mcpTool: string): string[] {
  // `install`'s own next action is a RE-run with `--force`: the recovery path
  // R6 names, and the only thing that helps when the installer exited 0 without
  // landing the browser (R7).
  if (op === 'install') {
    return [
      'Re-run `peaks web install --force` to re-download the browser',
      'Or call mcp__playwright__browser_install instead'
    ];
  }
  const install = 'Run `peaks web install` for the local path';
  // `login` is the one browser op its MCP fallback cannot stand in for: no
  // `mcp__playwright__*` tool persists a storage state, so naming
  // `browser_navigate` would send the caller to a dead end for the only verb
  // whose whole purpose is persistence (S4 R3). The gate is the real recovery.
  if (op === 'login') {
    return [
      'Unset PEAKS_WEB_DISABLED and re-run `peaks web login --profile <name>` — ' +
        'the MCP fallback cannot save a login profile',
      install
    ];
  }
  if (mcpTool === '') {
    return [install];
  }
  return [
    `Call ${mcpTool} directly instead (MCP fallback for \`peaks web ${op}\`; ` +
      'screenshots taken that way land in the project root)',
    install
  ];
}
