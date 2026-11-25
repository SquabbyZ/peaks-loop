/**
 * The real `DesignEngineDeps` for `peaks design check`.
 *
 * Kept separate from the G2 matrix so the pure orchestration stays small and
 * every side effect (engine resolution, URL precedence, spawning designlang,
 * starting the dev server, reading grade evidence) lives in one place.
 *
 * Two invariants this module owns: the ADAPTER's declared major is what
 * `resolveEngine` judges against (the recorded `engine.supportedMajor` is
 * informational and must never widen the gate), and a null entry path NEVER
 * becomes an empty `node ''` spawn — an unresolved engine is a failed run, not
 * a process.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DesignEngineDeps } from './design-check-g2.js';
import { type EngineContractFile, validateEngineContract } from './engine-contract.js';
import { resolveEngine } from './engine-status.js';
import { type DesignlangRunResult, readGradeEvidence, runDesignlang } from './designlang.js';
import { buildPageProbe } from './page-probe-deps.js';
import { probeRenderUrl, resolveRenderUrl } from './render-url.js';
import { startRenderServer } from './render-server.js';

export type BuildEngineDepsInput = {
  projectRoot: string;
  engine: EngineContractFile;
  url?: string;
  /** Routes the probe capture under this session's `design/probe`; defaults to `local`. */
  sessionId?: string;
  /** The app's `design/` root; the probe reads `routeMarkers` from it when given. */
  designRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

export type EngineContractRead =
  | { ok: true; contract: EngineContractFile }
  | { ok: false; code: 'DESIGN_CONTRACT_INVALID'; message: string };

const DEFAULT_ENGINE: EngineContractFile = {
  schemaVersion: 1,
  contractVersion: null,
  engine: { name: 'designlang', supportedMajor: 13 },
  render: {
    startCommand: null,
    cwd: '.',
    port: 0,
    path: '/',
    pages: [],
    startPolicy: 'never',
    url: null
  },
  archetypes: []
};

/** The result of a check that never reached a process because the entry is null. */
const UNRESOLVED_ENTRY_RESULT: DesignlangRunResult = {
  exitCode: -1,
  stdout: '',
  stderr: 'designlang is not available: its entry path did not resolve; G2 must block first.',
  timedOut: false
};

const ENGINE_INVALID_MESSAGE =
  'design/engine.json is invalid; run `peaks design init --refresh` to rewrite design/tokens.json and design/engine.json.';

/** A tolerant reader with a judge: unparseable or wrong-typed input is a blocked value. */
export function readEngineContract(designRoot: string): EngineContractRead {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(designRoot, 'engine.json'), 'utf8'));
  } catch {
    return { ok: false, code: 'DESIGN_CONTRACT_INVALID', message: ENGINE_INVALID_MESSAGE };
  }
  const problems = validateEngineContract(raw);
  if (problems.length > 0) {
    return {
      ok: false,
      code: 'DESIGN_CONTRACT_INVALID',
      message: `design/engine.json is invalid: ${problems.join('; ')}. Run \`peaks design init --refresh\` to rewrite design/tokens.json and design/engine.json.`
    };
  }
  const parsed = raw as Partial<EngineContractFile>;
  return {
    ok: true,
    contract: {
      ...DEFAULT_ENGINE,
      ...parsed,
      engine: { ...DEFAULT_ENGINE.engine, ...parsed.engine },
      render: { ...DEFAULT_ENGINE.render, ...parsed.render }
    }
  };
}

/** The real dependencies; the resolved URL is handed to `startServer` by argument. */
export function buildEngineDeps(input: BuildEngineDepsInput): DesignEngineDeps {
  // Spec §4.5: the adapter constant is authoritative. engine.json is editable,
  // so handing its `supportedMajor` to the gate would let a user widen it.
  const availability = resolveEngine();
  const deps: DesignEngineDeps = {
    availability,
    resolveUrl: () =>
      resolveRenderUrl({
        ...(input.url === undefined ? {} : { explicitUrl: input.url }),
        ...(input.env === undefined ? {} : { env: input.env }),
        engine: input.engine
      }),
    probe: probeRenderUrl,
    probePage: buildPageProbe({
      availability,
      projectRoot: input.projectRoot,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.designRoot === undefined ? {} : { designRoot: input.designRoot })
    }),
    run: (_kind, request) => {
      const entryPath = availability.entryPath;
      if (entryPath === null) return Promise.resolve({ ...UNRESOLVED_ENTRY_RESULT });
      return runDesignlang({ entryPath, args: request.args });
    },
    readGrade: (outDir) => readGradeEvidence(outDir)
  };
  const command = input.engine.render.startCommand;
  if (command !== null && command.trim() !== '') {
    deps.startServer = (url) =>
      startRenderServer({
        projectRoot: input.projectRoot,
        cwd: input.engine.render.cwd,
        command,
        url
      });
  }
  return deps;
}
