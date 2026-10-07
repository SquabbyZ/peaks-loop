// src/services/codegraph/codegraph-project-config.ts
//
// ONE answer to "which file holds this project's codegraph config, and what
// does its `include` list MEAN", for every reader and writer of that file.
//
// WHY THIS EXISTS (the 1.6.2 upgrade). Before it, one constant covered every
// site: join `.codegraph/config.json` onto the project root. That rule is
// false from 1.6.x, and false in two ways at once:
//
//   - LOCATION. The only per-project config 1.6.x reads is
//     `<projectRoot>/codegraph.json`. `init` does not write
//     `.codegraph/config.json` and nothing in the 1.6.x bundle reads it, so
//     every read of the old path is an ENOENT and every write is inert.
//
//   - SEMANTICS. 0.7.x's `include` was a WHITELIST: it decided which files
//     were indexed, so a supported tracked file missing from it was silently
//     dropped. 1.6.x's `include` is the opposite — upstream's own words are
//     "force INTO the index even when `.gitignore` would drop it". An absent
//     `include` therefore withholds NOTHING in 1.6.x, where the same absence
//     withheld everything in 0.7.x.
//
// The two follow from one upstream fact, so they are resolved together, once,
// and by PROBE rather than by version string — the same discipline
// `codegraph-upstream-layout.ts` already established for "where does upstream
// put its files". The probe is upstream's own project-config module: 0.7.x
// reads `<projectRoot>/.codegraph/config.json` through `dist/config.js` and
// ships no `project-config.js`; 1.6.x reads `<projectRoot>/codegraph.json`
// through `lib/dist/project-config.js` and ships no `config.js`. Both halves
// measured against real installs of 0.7.10 and 1.6.2.
//
// PROBE FAILURE IS FAIL-CLOSED. When no upstream can be probed at all, the
// model resolves to the whitelist one, which REQUIRES the legacy config to be
// present before any verdict is claimed — so the gate reports "could not
// evaluate" rather than silently asserting that nothing is withheld.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CODEGRAPH_DIR_NAME } from './codegraph-service.js';
import { resolveCodegraphUpstreamLayout } from './codegraph-upstream-layout.js';

/** Upstream's per-project config filename at the project root. */
export const CODEGRAPH_PROJECT_CONFIG_FILENAME = 'codegraph.json';

/** Upstream's config filename inside `.codegraph/`. */
export const CODEGRAPH_DIR_CONFIG_FILENAME = 'config.json';

/**
 * Upstream's module that reads the project-root config. Its presence is the
 * 1.6.x layout signature; `null` means "no upstream to probe".
 */
const PROJECT_CONFIG_MODULE = 'project-config.js';

/**
 * How this upstream's `include` list relates to being indexed.
 *
 *   - `force-include`    — 1.6.x. Selection is `.gitignore`-driven; `include`
 *                          can only ADD files to the index, never withhold
 *                          one. Config lives at `<root>/codegraph.json`.
 *   - `include-whitelist`— 0.7.x. `include` decides which tracked files are
 *                          indexed, so its gaps are real omissions. Config
 *                          lives at `<root>/.codegraph/config.json`.
 */
export type CodegraphConfigModel = 'force-include' | 'include-whitelist';

export type CodegraphConfigSource = {
  /** Absolute path of the file upstream reads for this project. */
  readonly configPath: string;
  /** True when that file exists. Its ABSENCE is meaningful in both models. */
  readonly present: boolean;
  readonly model: CodegraphConfigModel;
};

/** The model implied by an upstream `dist/` directory, or `null` when there is none. */
export function codegraphConfigModelFor(moduleDir: string): CodegraphConfigModel | null {
  // An empty `moduleDir` is the layout resolver's "nothing resolved" value.
  // Without this guard `join('', 'project-config.js')` becomes the RELATIVE
  // path `project-config.js`, whose existence would depend on the process's
  // working directory — a probe that answers about the cwd instead of about
  // upstream.
  if (moduleDir === '') {
    return null;
  }

  return existsSync(join(moduleDir, PROJECT_CONFIG_MODULE)) ? 'force-include' : 'include-whitelist';
}

/** Where the config lives under `model`. Pure: no fs. */
export function codegraphConfigPathFor(projectRoot: string, model: CodegraphConfigModel): string {
  return model === 'force-include'
    ? join(projectRoot, CODEGRAPH_PROJECT_CONFIG_FILENAME)
    : join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_DIR_CONFIG_FILENAME);
}

/**
 * Resolve the source for a KNOWN model. A parameter rather than a lookup so a
 * caller that has already probed upstream (or a test driving both models) does
 * not have to reach the installed package twice, and so the model can never
 * disagree with the path derived from it.
 */
export function codegraphConfigSourceFor(
  projectRoot: string,
  model: CodegraphConfigModel
): CodegraphConfigSource {
  const configPath = codegraphConfigPathFor(projectRoot, model);

  return { configPath, present: existsSync(configPath), model };
}

/** `codegraphConfigSourceFor` for whichever config model this install runs. */
export function resolveCodegraphConfigSource(projectRoot: string): CodegraphConfigSource {
  return codegraphConfigSourceFor(projectRoot, resolveCodegraphConfigModel());
}

function resolveCodegraphConfigModel(): CodegraphConfigModel {
  try {
    const probed = codegraphConfigModelFor(resolveCodegraphUpstreamLayout().moduleDir);
    return probed ?? 'include-whitelist';
  } catch {
    // No installed upstream to probe — see the module header: fail CLOSED, so
    // the caller demands the legacy config before claiming any verdict.
    return 'include-whitelist';
  }
}
