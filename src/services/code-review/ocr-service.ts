/**
 * Open Code Review (ocr) integration — soft-optional augmentation
 * for peaks-rd's Gate B3 (code review evidence).
 *
 * Per the "skill-first / CLI-auxiliary" tenet, peaks-rd SKILL.md
 * is the primary surface; this CLI primitive returns a structured
 * JSON envelope the skill consumes to produce a second-opinion
 * code review alongside its own LLM review.
 *
 * Mirrors the ECC 64-agents soft-optional pattern
 * (`src/services/agent/ecc-agent-service.ts`):
 *   - same subprocessRunner injection seam (testability),
 *   - same multi-state reason enum (clear failure-mode reporting),
 *   - same soft-fail policy (never blocks the umbrella).
 *
 * === Source of truth: peaks-cli's own config.json ===
 *
 * peaks-cli does NOT auto-configure the LLM endpoint, and it does
 * NOT write `~/.opencodereview/config.json`. The user is the only
 * party that touches their LLM token / URL / model. The single
 * discoverable place they declare those values is
 * `peaksConfig.ocr.llm` under their `~/.peaks/config.json` (or
 * `.peaks/config.json` in a project root).
 *
 *   peaksConfig.ocr.llm.url          → OCR_LLM_URL
 *   peaksConfig.ocr.llm.authToken    → OCR_LLM_TOKEN
 *   peaksConfig.ocr.llm.model        → OCR_LLM_MODEL
 *   peaksConfig.ocr.llm.useAnthropic → OCR_USE_ANTHROPIC
 *   peaksConfig.ocr.llm.authHeader   → OCR_LLM_AUTH_HEADER
 *
 * When `runOcrReview` spawns the ocr subprocess it injects those
 * values as env vars. The ocr package treats env vars as the
 * highest-priority config source, so peaks-cli never has to
 * materialise `~/.opencodereview/config.json` itself.
 *
 * To see the JSON template to paste, run:
 *   `peaks code-review config-template`
 *
 * The ocr package is declared in package.json:peerDependencies
 * (was promoted to `dependencies` in 2.0.1, demoted to
 * `optionalDependencies` in 2.0.3, then to `peerDependencies` in
 * 2.8.2 — the ocr postinstall downloads a Go binary via HTTPS,
 * which fails in restricted/proxied environments and would
 * otherwise slow or abort the whole `npm i -g peaks-cli` flow).
 * Peaks-cli ships with ocr *not* installed; if the user wants it,
 * they run
 *   `npm i -g @alibaba-group/open-code-review`
 * and peaks-cli's 5-state detector (below) reports whether the
 * binary is actually usable. pnpm-based installs additionally need
 * `pnpm approve-builds @alibaba-group/open-code-review` for the
 * binary download to run. Either way, peaks-cli never blocks on it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { OcrLlmConfig } from '../config/config-types.js';

const OCR_DETECT_TIMEOUT_MS = 5000;
const OCR_REVIEW_TIMEOUT_MS = 180000;

const OCR_INSTALL_HINT = 'Install: `npm i -g @alibaba-group/open-code-review` (peaks-cli 2.8.2 ships with ocr as a peer dependency — its postinstall downloads a Go binary via HTTPS, which fails in some restricted/proxied environments; that\'s why peaks-cli does not auto-install it). Then add your LLM endpoint to ~/.peaks/config.json — run `peaks code-review config-template` for the JSON snippet to paste. Under pnpm you also need `pnpm approve-builds @alibaba-group/open-code-review` to allow the binary download.';

const OCR_CONFIG_TEMPLATE = JSON.stringify(
  {
    ocr: {
      llm: {
        url: 'https://api.example.com/v1/messages',
        authToken: '<your-api-key>',
        model: 'claude-3-5-sonnet-latest',
        useAnthropic: true,
        authHeader: 'x-api-key'
      }
    }
  },
  null,
  2
);

export type OcrDetectState =
  | 'ready'
  | 'package-missing'
  | 'binary-missing'
  | 'config-missing'
  | 'detection-failed';

export interface OcrDetectResult {
  readonly state: OcrDetectState;
  readonly packageInstalled: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  /**
   * The peaks-cli config path that holds `peaksConfig.ocr.llm`.
   * The user pastes the `peaks code-review config-template` output
   * here. Empty string when peaks-cli has not been bootstrapped.
   */
  readonly configPath: string;
  readonly configValid: boolean;
  readonly missingKeys: readonly string[];
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

export interface OcrReviewInput {
  readonly projectRoot: string;
  readonly from?: string;
  readonly to?: string;
  readonly commit?: string;
}

export interface OcrReviewResult {
  readonly spawned: boolean;
  readonly state: OcrDetectState;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Parsed JSON envelope if the ocr subprocess emitted valid JSON. */
  readonly parsed: unknown;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

export interface SubprocessRunner {
  run(
    command: string,
    args: readonly string[],
    options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
  ): { status: number | null; stdout: string; stderr: string; error?: string };
}

const DEFAULT_RUNNER: SubprocessRunner = {
  run(command, args, options) {
    try {
      const r = spawnSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeoutMs,
        cwd: options.cwd,
        env: options.env,
      });
      return {
        status: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
      };
    } catch (err) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Locate the ocr launcher script (`bin/ocr.js`) inside our own
 * node_modules tree. Returns null when the npm package is not
 * present (peaks-cli was installed but its dependency tree is
 * corrupt, or the user removed it).
 *
 * Walks up from this file (dist/src/services/code-review/) to
 * find the project root, then checks node_modules.
 */
export function resolveOcrLauncher(searchRoots: readonly string[]): string | null {
  const candidates: string[] = [];
  for (const root of searchRoots) {
    candidates.push(join(root, 'node_modules', '@alibaba-group', 'open-code-review', 'bin', 'ocr.js'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve search roots for the ocr launcher. We look in two
 * places: (1) the peaks-cli install root (next to our own dist/),
 * (2) the user's cwd.
 */
export function defaultOcrSearchRoots(currentDirPath: string, cwd: string): readonly string[] {
  // currentDirPath is dist/src/services/code-review/; walk up 4 to repo root.
  const peaksRoot = join(currentDirPath, '..', '..', '..', '..');
  return [peaksRoot, cwd];
}

/**
 * Validate the `peaksConfig.ocr.llm` block the caller (CLI / test)
 * read out of `~/.peaks/config.json`. Returns the list of missing
 * required keys (`url`, `authToken`, `model`); empty array means
 * the block is ready to drive the ocr subprocess.
 *
 * The block is independent of the OCR package's own
 * `~/.opencodereview/config.json` file. peaks-cli only ever reads
 * from its own config; the env-var injection in `runOcrReview`
 * makes the legacy file irrelevant.
 */
export function getOcrLlmMissingFields(llm: OcrLlmConfig | null): readonly string[] {
  if (llm === null) {
    return ['ocr.llm.url', 'ocr.llm.authToken', 'ocr.llm.model'];
  }
  const missing: string[] = [];
  if (typeof llm.url !== 'string' || llm.url.length === 0) missing.push('ocr.llm.url');
  if (typeof llm.authToken !== 'string' || llm.authToken.length === 0) missing.push('ocr.llm.authToken');
  if (typeof llm.model !== 'string' || llm.model.length === 0) missing.push('ocr.llm.model');
  return missing;
}

/**
 * Build the env-var overlay peaks-cli injects into the ocr
 * subprocess. Maps `peaksConfig.ocr.llm` onto the OCR package's
 * env-var surface (its highest-priority config source).
 */
export function buildOcrEnv(llm: OcrLlmConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (typeof llm.url === 'string' && llm.url.length > 0) env.OCR_LLM_URL = llm.url;
  if (typeof llm.authToken === 'string' && llm.authToken.length > 0) env.OCR_LLM_TOKEN = llm.authToken;
  if (typeof llm.model === 'string' && llm.model.length > 0) env.OCR_LLM_MODEL = llm.model;
  if (typeof llm.useAnthropic === 'boolean') env.OCR_USE_ANTHROPIC = String(llm.useAnthropic);
  if (typeof llm.authHeader === 'string' && llm.authHeader.length > 0) env.OCR_LLM_AUTH_HEADER = llm.authHeader;
  return env;
}

/**
 * The JSON template the user pastes into their peaks-cli config
 * (`peaksConfig.ocr.llm`). Returned as a stable string so the
 * `peaks code-review config-template` CLI command can print it
 * verbatim, and so the detector's `nextActions` payload embeds
 * the same shape the user is told to add.
 */
export function getOcrConfigTemplate(): string {
  return OCR_CONFIG_TEMPLATE;
}

export interface OcrDetectOptions {
  readonly cwd: string;
  /**
   * The peaks-cli config path that holds `peaksConfig.ocr.llm`.
   * Surfaced in the detect result so the user knows where to
   * paste the template.
   */
  readonly peaksConfigPath: string;
  /**
   * The parsed `peaksConfig.ocr.llm` block. `null` when the user
   * has not yet populated the config; the detector surfaces the
   * `config-missing` state with a templated `nextActions`.
   */
  readonly peaksOcrConfig: OcrLlmConfig | null;
  readonly searchRoots?: readonly string[];
  readonly runner?: SubprocessRunner;
}

/**
 * Detect the full ocr install + config state. The 5 reason states
 * are unchanged from the soft-optional 2.0.0 contract; only the
 * source of `config-missing` moved from `~/.opencodereview/config.json`
 * to `peaksConfig.ocr.llm`.
 */
export function detectOcr(options: OcrDetectOptions): OcrDetectResult {
  const currentDirPath = dirname(fileURLToPath(import.meta.url));
  const roots = options.searchRoots ?? defaultOcrSearchRoots(currentDirPath, options.cwd);
  const launcher = resolveOcrLauncher(roots);
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (launcher === null) {
    const missing = getOcrLlmMissingFields(options.peaksOcrConfig);
    return {
      state: 'package-missing',
      packageInstalled: false,
      binaryPath: null,
      version: null,
      configPath: options.peaksConfigPath,
      configValid: missing.length === 0,
      missingKeys: missing,
      warnings,
      nextActions: [
        '@alibaba-group/open-code-review is not installed in this project or peaks-cli root.',
        OCR_INSTALL_HINT,
      ],
    };
  }

  // Check whether the platform-specific binary downloaded
  // successfully. The launcher's own check is identical:
  // bin/opencodereview(.exe) next to bin/ocr.js.
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? 'opencodereview.exe' : 'opencodereview';
  const binaryPath = join(dirname(launcher), binaryName);
  if (!existsSync(binaryPath)) {
    const missing = getOcrLlmMissingFields(options.peaksOcrConfig);
    return {
      state: 'binary-missing',
      packageInstalled: true,
      binaryPath: null,
      version: null,
      configPath: options.peaksConfigPath,
      configValid: missing.length === 0,
      missingKeys: missing,
      warnings: [
        'ocr npm package is installed but the platform binary failed to download (likely network or postinstall blocked).',
      ],
      nextActions: [
        'For npm installs the binary downloads automatically; for pnpm run: `pnpm approve-builds @alibaba-group/open-code-review`.',
        'Or run the installer directly: `node node_modules/@alibaba-group/open-code-review/scripts/install.js`.',
        'Network-blocked installs can pre-download from https://github.com/alibaba/open-code-review/releases and place the binary at: ' + binaryPath,
      ],
    };
  }

  // Probe the binary for its version. We invoke through the
  // node launcher so the upstream's update-check + arg-parse
  // logic stays canonical.
  const runner = options.runner ?? DEFAULT_RUNNER;
  const probe = runner.run('node', [launcher, 'version'], { timeoutMs: OCR_DETECT_TIMEOUT_MS });
  let version: string | null = null;
  if (probe.status === 0 && probe.stdout.length > 0) {
    const match = /(\d+\.\d+\.\d+)/.exec(probe.stdout);
    version = match !== null ? match[1] ?? null : probe.stdout.trim().slice(0, 32);
  }

  const missing = getOcrLlmMissingFields(options.peaksOcrConfig);
  if (missing.length > 0) {
    return {
      state: 'config-missing',
      packageInstalled: true,
      binaryPath,
      version,
      configPath: options.peaksConfigPath,
      configValid: false,
      missingKeys: missing,
      warnings: [
        `ocr is installed but peaks-cli's ocr.llm config is incomplete: missing ${missing.join(', ')}.`,
      ],
      nextActions: [
        `Paste the following into ${options.peaksConfigPath} under "ocr.llm":`,
        OCR_CONFIG_TEMPLATE,
        'Or run `peaks code-review config-template` to print the snippet again.',
        'Until configured, peaks-rd skips the ocr second-opinion step and proceeds with its own LLM review only.',
      ],
    };
  }

  return {
    state: 'ready',
    packageInstalled: true,
    binaryPath,
    version,
    configPath: options.peaksConfigPath,
    configValid: true,
    missingKeys: [],
    warnings,
    nextActions,
  };
}

export interface OcrReviewOptions extends OcrDetectOptions {
  readonly input: OcrReviewInput;
}

/**
 * Run ocr review and return the structured result. Detects state
 * first; soft-fails when ocr isn't ready (the caller — typically
 * peaks-rd — proceeds without the second-opinion review).
 *
 * The LLM endpoint config from `peaksConfig.ocr.llm` is injected
 * as env vars (`OCR_LLM_URL` / `OCR_LLM_TOKEN` / ...), which the
 * ocr package treats as the highest-priority config source. This
 * is how peaks-cli wires the user-managed config into the ocr
 * subprocess without ever writing `~/.opencodereview/config.json`.
 */
export function runOcrReview(options: OcrReviewOptions): OcrReviewResult {
  const detect = detectOcr(options);
  if (detect.state !== 'ready') {
    return {
      spawned: false,
      state: detect.state,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      parsed: null,
      warnings: detect.warnings,
      nextActions: detect.nextActions,
    };
  }

  // Resolve the launcher path again (we know it exists because detect.state === 'ready')
  const currentDirPath = dirname(fileURLToPath(import.meta.url));
  const roots = options.searchRoots ?? defaultOcrSearchRoots(currentDirPath, options.cwd);
  const launcher = resolveOcrLauncher(roots);
  if (launcher === null) {
    // Should never happen given state === 'ready', but stay safe.
    return {
      spawned: false,
      state: 'detection-failed',
      exitCode: null,
      stdout: '',
      stderr: 'ocr launcher disappeared between detect and run',
      durationMs: 0,
      parsed: null,
      warnings: ['ocr was detected as ready but the launcher path is no longer resolvable.'],
      nextActions: ['Re-run `peaks code-review detect-ocr --json` to refresh.'],
    };
  }

  // Inject the LLM endpoint config from peaks-cli's config.json
  // as env vars — the ocr package's highest-priority config path.
  const env = options.peaksOcrConfig === null
    ? process.env
    : { ...process.env, ...buildOcrEnv(options.peaksOcrConfig) };

  const args = ['review', '--format', 'json'];
  if (typeof options.input.from === 'string' && options.input.from.length > 0) {
    args.push('--from', options.input.from);
  }
  if (typeof options.input.to === 'string' && options.input.to.length > 0) {
    args.push('--to', options.input.to);
  }
  if (typeof options.input.commit === 'string' && options.input.commit.length > 0) {
    args.push('--commit', options.input.commit);
  }

  const runner = options.runner ?? DEFAULT_RUNNER;
  const start = Date.now();
  const r = runner.run('node', [launcher, ...args], {
    cwd: options.input.projectRoot,
    timeoutMs: OCR_REVIEW_TIMEOUT_MS,
    env,
  });
  const durationMs = Date.now() - start;

  let parsed: unknown = null;
  if (r.status === 0 && r.stdout.length > 0) {
    try {
      parsed = JSON.parse(r.stdout);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // Leave parsed=null; the caller can read raw stdout.
    }
  }

  return {
    spawned: true,
    state: 'ready',
    exitCode: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs,
    parsed,
    warnings: r.status === 0 ? [] : [`ocr review exited with status ${r.status}`],
    nextActions: r.status === 0
      ? []
      : ['Inspect stderr for the failure. Re-run `peaks code-review detect-ocr --json` to verify config still valid.'],
  };
}
