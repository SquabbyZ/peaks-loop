// src/cli/commands/statusline-render-command.ts
//
// The default-statusline render body. Split out of `statusline-commands.ts`;
// the rendered line, the JSON envelope and the witness write are unchanged.
//
// Capability resolution is delegated to `resolveStatusLineCapability` with only
// `env` and `isTTY` — the env-driven path is the single first-version source of
// truth. No CLI flag widens the surface. The model itself is read-only:
// `buildStatusLineModel` is the sole I/O boundary, and it also resolves compact
// state.

import {
  buildStatusLineModel,
  parseStatusLineStdin
} from '../../services/skills/skill-statusline-service.js';
import {
  renderStatusLine,
  resolveStatusLineCapability
} from '../../services/skills/skill-statusline-renderer.js';
import { writeHarnessWitness } from '../../services/context/harness-context-witness.js';
import type { ProgramIO } from '../cli-helpers.js';
import { readStdin, type RenderOptions } from './statusline-command-shared.js';

/**
 * Default-statusline render body. Reused by both the top-level default
 * action (Bug-02 dispatch) and the explicit `render` subcommand. Exported
 * so a unit test can exercise the JSON / text output paths without going
 * through commander.
 */
export async function runDefaultStatuslineRender(
  options: RenderOptions,
  io: ProgramIO
): Promise<void> {
  const raw = await readStdin();
  const stdin = parseStatusLineStdin(raw);
  const seeded = options.project
    ? { ...(stdin ?? {}), workspace: { current_dir: options.project } }
    : stdin;
  // `Date.now()` for deterministic lifecycle-window checks under full-
  // suite concurrency. The integration test passes a test-time `now`
  // pinned at the moment `seedLifecycle` was called so the completed-
  // expiry window stays in-range regardless of how long the spawned
  // subprocess sat descheduled. Production callers omit the flag.
  const now = options.now !== undefined ? Number(options.now) : Date.now();
  const model = buildStatusLineModel(seeded, now);
  // context numbers from the payload it just piped in. The project root and the
  // canonical session id are taken from the model that was JUST built, so the
  // witness lands under the same session this render already resolved — a second
  // resolution here could disagree with it. Never throws; never changes the
  // rendered line.
  writeHarnessWitness({
    projectRoot: model.projectRoot,
    sessionId: model.sessionId,
    stdin,
    nowMs: now
  });
  const capability = resolveStatusLineCapability({
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY)
  });
  const text = renderStatusLine(model, { capability }, process.env);
  if (options.json === true) {
    io.stdout(JSON.stringify({ ok: true, command: 'statusline.render', data: { text } }, null, 2));
    return;
  }
  io.stdout(text);
}
