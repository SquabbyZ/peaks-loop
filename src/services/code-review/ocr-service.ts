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
 * The ocr package is declared in package.json:optionalDependencies
 * so `npm i -g peaks-cli@2.0` pulls it automatically (npm runs the
 * ocr postinstall by default, which downloads the Go binary).
 * pnpm-based installs need `pnpm approve-builds @alibaba-group/open-code-review`.
 * Either way, peaks-cli detects the install state and reports it.
 *
 * Security note: ocr ships user-configured-LLM endpoint code as
 * part of its review. peaks-cli does NOT auto-configure that
 * endpoint; the user runs `ocr config set llm.url|auth_token|model`
 * themselves (one-time setup). See README.md "ocr integration"
 * for the install + configure path.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const OCR_DETECT_TIMEOUT_MS = 5000;
const OCR_REVIEW_TIMEOUT_MS = 180000;

const OCR_INSTALL_HINT = 'Install: `npm i -g @alibaba-group/open-code-review`. Then configure: `ocr config set llm.url <endpoint>` + `ocr config set llm.auth_token <key>` + `ocr config set llm.model <model>`.';

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
  readonly configPath: string;
  readonly configValid: boolean;
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
    options: { cwd?: string; timeoutMs: number }
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
 * present (peaks-cli was installed without optionalDependencies,
 * or the user removed it).
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
 * Resolve search roots for the ocr launcher. We look in three
 * places: (1) the peaks-cli install root (next to our own dist/),
 * (2) the user's cwd, (3) the user's HOME/AppData global
 * node_modules (best-effort).
 */
export function defaultOcrSearchRoots(currentDirPath: string, cwd: string): readonly string[] {
  // currentDirPath is dist/src/services/code-review/; walk up 4 to repo root.
  const peaksRoot = join(currentDirPath, '..', '..', '..', '..');
  return [peaksRoot, cwd];
}

/**
 * Check whether ocr's `~/.opencodereview/config.json` exists and
 * has the minimum keys (llm.url, llm.auth_token, llm.model).
 */
export function detectOcrConfig(homeDir: string): { path: string; valid: boolean; missingKeys: readonly string[] } {
  const configPath = join(homeDir, '.opencodereview', 'config.json');
  if (!existsSync(configPath)) {
    return { path: configPath, valid: false, missingKeys: ['(config file does not exist)'] };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const llm = (raw['llm'] ?? {}) as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof llm['url'] !== 'string' || (llm['url'] as string).length === 0) missing.push('llm.url');
    if (typeof llm['auth_token'] !== 'string' || (llm['auth_token'] as string).length === 0) missing.push('llm.auth_token');
    if (typeof llm['model'] !== 'string' || (llm['model'] as string).length === 0) missing.push('llm.model');
    return { path: configPath, valid: missing.length === 0, missingKeys: missing };
  } catch (err) {
    return {
      path: configPath,
      valid: false,
      missingKeys: [`(config file is not valid JSON: ${err instanceof Error ? err.message : String(err)})`],
    };
  }
}

export interface OcrDetectOptions {
  readonly cwd: string;
  readonly homeDir: string;
  readonly searchRoots?: readonly string[];
  readonly runner?: SubprocessRunner;
}

/**
 * Detect the full ocr install + config state.
 * Returns a structured result the LLM/skill can pattern-match on
 * to produce actionable next-step guidance.
 */
export function detectOcr(options: OcrDetectOptions): OcrDetectResult {
  const currentDirPath = dirname(fileURLToPath(import.meta.url));
  const roots = options.searchRoots ?? defaultOcrSearchRoots(currentDirPath, options.cwd);
  const launcher = resolveOcrLauncher(roots);
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (launcher === null) {
    const config = detectOcrConfig(options.homeDir);
    return {
      state: 'package-missing',
      packageInstalled: false,
      binaryPath: null,
      version: null,
      configPath: config.path,
      configValid: config.valid,
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
    return {
      state: 'binary-missing',
      packageInstalled: true,
      binaryPath: null,
      version: null,
      configPath: join(options.homeDir, '.opencodereview', 'config.json'),
      configValid: false,
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

  const config = detectOcrConfig(options.homeDir);
  if (!config.valid) {
    return {
      state: 'config-missing',
      packageInstalled: true,
      binaryPath,
      version,
      configPath: config.path,
      configValid: false,
      warnings: [
        `ocr is installed but its LLM endpoint config is incomplete: missing ${config.missingKeys.join(', ')}.`,
      ],
      nextActions: [
        'Configure ocr (one-time): `ocr config set llm.url <endpoint>`, `ocr config set llm.auth_token <key>`, `ocr config set llm.model <model>`.',
        'See https://github.com/alibaba/open-code-review#configuration for the full schema.',
        'Until configured, peaks-rd skips the ocr second-opinion step and proceeds with its own LLM review only.',
      ],
    };
  }

  return {
    state: 'ready',
    packageInstalled: true,
    binaryPath,
    version,
    configPath: config.path,
    configValid: true,
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
  });
  const durationMs = Date.now() - start;

  let parsed: unknown = null;
  if (r.status === 0 && r.stdout.length > 0) {
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
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
