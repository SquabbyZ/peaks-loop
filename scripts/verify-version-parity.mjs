#!/usr/bin/env node
/**
 * rid 2026-10-03-release-gate-quote-brittle — value-based version-parity gate.
 *
 * publish.yml used to inline three grep/sed extractors for the CLI_VERSION /
 * RUNTIME_VERSION literals. Two matched ONLY double quotes, one matched ONLY
 * single quotes, and prettier pass `cf21d188` ("COMMITTED NOT-GREEN") flipped
 * version.ts to single quotes — the extractor returned an empty string, the
 * comparison "4.1.0" vs "" failed, and CI refused to publish a build whose
 * values were correct all along. Quote style was load-bearing in the release
 * path. This script removes the whole class: every gate below reads the
 * VALUE (import the built module first — what the runtime itself does;
 * quote-tolerant extraction fallback for sources `node` cannot import), and
 * publish.yml now just calls `node scripts/verify-version-parity.mjs <gate>`.
 * Because the workflow calls the SAME code these tests pin, CI and the test
 * cannot diverge.
 *
 * Arms pinned in tests/unit/release/version-parity-gate.test.ts: equal value
 * passes with single OR double quotes; a drifted value still FAILS with the
 * drift message carrying the observed value (quote-tolerance must never
 * become version-tolerance); a missing file still FAILS with the
 * missing-artifact message, never an empty-string drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Quote-tolerant literal reader: single, double and backtick quotes parse;
 * an unquoted or absent declaration does NOT (reason: 'unparseable') — a
 * silent empty string is exactly how the 4.1.0 refusal happened.
 */
export function extractConstant(source, constant) {
  const m = new RegExp(`\\b${constant}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`).exec(source);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3];
  return value === '' ? null : value;
}

/**
 * Read the VALUE of `constant` from `file`. Preferred mechanism: evaluate the
 * built module and take the export (quote style, whitespace and tsc emit
 * shape become irrelevant). Fall back to quote-tolerant extraction when the
 * file is not importable (TypeScript sources) or its import fails.
 */
export async function readConstantValue(file, constant) {
  if (!existsSync(file)) return { ok: false, reason: 'missing' };
  if (/\.(?:m?js|cjs)$/i.test(file)) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const value = mod[constant];
      if (typeof value === 'string' && value.length > 0) {
        return { ok: true, value, via: 'import' };
      }
    } catch {
      // Not importable here (module-system mismatch, syntax, side-effect
      // guard). The extractor below is the sanctioned fallback, and it still
      // refuses to fabricate a value it cannot see.
    }
  }
  const value = extractConstant(readFileSync(file, 'utf8'), constant);
  if (value === null) return { ok: false, reason: 'unparseable' };
  return { ok: true, value, via: 'extract' };
}

/**
 * Every user-visible string lives in this table so the gate decisions and the
 * wording match the historical publish.yml annotations while the READ stays
 * value-based. Profiles: shared-dist (§A), runtime-src (§A′), shared-tarball (§B).
 */
export const PROFILES = {
  'shared-dist': {
    constant: 'CLI_VERSION',
    file: () => join(projectRoot, 'packages', 'peaks-loop-shared', 'dist', 'version.js'),
    label: 'peaks-loop-shared/dist/version.js',
    missing: [
      '::error title=missing shared dist/version.js::publish.yml refuses to publish when peaks-loop-shared/dist/version.js is missing (did sync-version.mjs run before this gate?)'
    ],
    unparseable: [
      '::error title=CLI_VERSION unparseable::peaks-loop-shared/dist/version.js is present but declares no parseable CLI_VERSION string literal. Refusing to publish.'
    ],
    drift: (observed, rootVersion) => [
      `::error title=CLI_VERSION drift::peaks-loop-shared on-disk carries ${observed} but root package.json is ${rootVersion}`,
      '::error::publish.yml refuses to publish when peaks-loop-shared/dist/version.js lags the root version.',
      '::error::Fix: bump packages/peaks-loop-shared/package.json to a new version, commit, then re-tag. This avoids peaks-loop@<new> pinning a stale peaks-loop-shared@<old>.',
      '::error::Detail: ../.peaks/memory/peaks-cli-version-shared-chicken-egg.md'
    ],
    ok: (observed, rootVersion) =>
      `On-disk CLI_VERSION alignment OK: peaks-loop@${rootVersion} -> peaks-loop-shared@${observed}`
  },
  'runtime-src': {
    constant: 'RUNTIME_VERSION',
    file: () => join(projectRoot, 'packages', 'peaks-loop-internal-runtime', 'src', 'index.ts'),
    label: 'peaks-loop-internal-runtime/src/index.ts',
    missing: [
      '::error title=missing runtime src/index.ts::publish.yml refuses to publish when peaks-loop-internal-runtime/src/index.ts is missing'
    ],
    unparseable: [
      '::error title=RUNTIME_VERSION unparseable::peaks-loop-internal-runtime/src/index.ts is present but declares no parseable RUNTIME_VERSION string literal. Refusing to publish.'
    ],
    drift: (observed, rootVersion) => [
      `::error title=runtime CLI_VERSION drift::peaks-loop-internal-runtime on-disk carries RUNTIME_VERSION=${observed} but root package.json is ${rootVersion}`,
      '::error::publish.yml refuses to publish when peaks-loop-internal-runtime/src/index.ts RUNTIME_VERSION literal lags the root version.',
      '::error::Fix: bump packages/peaks-loop-internal-runtime/src/index.ts RUNTIME_VERSION + package.json#version, commit, then re-tag.'
    ],
    ok: (observed, rootVersion) =>
      `On-disk RUNTIME_VERSION alignment OK: peaks-loop@${rootVersion} -> peaks-loop-internal-runtime@${observed}`
  },
  'shared-tarball': {
    constant: 'CLI_VERSION',
    file: null, // gate argument: the tarball-extracted package/dist/version.js path
    label: 'peaks-loop-shared tarball package/dist/version.js',
    missing: [
      '::error title=stale-tarball::peaks-loop-shared tarball is MISSING package/dist/version.js. Layer 3 root cause: shared tsc incremental build silently skipped dist/version.js. Refusing to publish.',
      "::error::Fix: clean shared/dist (rm -rf packages/peaks-loop-shared/dist) and re-run pnpm run build, or switch to 'tsc -b' (project references).",
      '::error::Detail: ../.peaks/memory/peaks-stale-cli-version-2026-07-23-diagnosis.md'
    ],
    unparseable: [
      '::error title=tarball CLI_VERSION unparseable::peaks-loop-shared tarball package/dist/version.js is present but declares no parseable CLI_VERSION string literal. Refusing to publish.'
    ],
    drift: (observed, rootVersion) => [
      `::error title=tarball CLI_VERSION drift::peaks-loop-shared tarball carries CLI_VERSION=${observed} but root package.json is ${rootVersion}. The pack step produced a stale tarball (Layer 3 + Layer 5). Refusing to publish.`,
      '::error::Detail: ../.peaks/memory/peaks-stale-cli-version-2026-07-23-diagnosis.md'
    ],
    ok: (observed) =>
      `Tarball CLI_VERSION alignment OK: peaks-loop-shared@${readPackageVersion(
        'packages/peaks-loop-shared'
      )} tarball package/dist/version.js = ${observed}`
  }
};

function readPackageVersion(pkgDir) {
  return JSON.parse(readFileSync(join(projectRoot, pkgDir, 'package.json'), 'utf8')).version;
}

function readRootVersion() {
  return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
}

/**
 * Run one gate profile. Returns { ok, lines } where `lines` are the workflow
 * annotations/echoes. Pure with respect to the repo: never calls process.exit
 * so tests can exercise every arm through this exact code path.
 */
export async function runGate(name, { file, expect } = {}) {
  const profile = PROFILES[name];
  if (profile === undefined) throw new Error(`unknown gate profile: ${name}`);
  const target = file ?? (profile.file ? profile.file() : null);
  if (target === null) throw new Error(`gate ${name} requires an explicit --file`);
  const expected = expect ?? readRootVersion();
  const read = await readConstantValue(target, profile.constant);
  if (!read.ok && read.reason === 'missing') {
    return {
      ok: false,
      lines: [...profile.missing, `[verify-version-parity] ${name}: FAIL (missing) ${target}`]
    };
  }
  if (!read.ok) {
    return {
      ok: false,
      lines: [
        ...profile.unparseable,
        `[verify-version-parity] ${name}: FAIL (unparseable ${profile.constant}) ${target}`
      ]
    };
  }
  if (read.value !== expected) {
    return {
      ok: false,
      lines: [
        ...profile.drift(read.value, expected),
        `[verify-version-parity] ${name}: FAIL (drift, via ${read.via}) observed=${read.value} expected=${expected}`
      ]
    };
  }
  return {
    ok: true,
    lines: [
      profile.ok(read.value, expected),
      `[verify-version-parity] ${name}: OK (via ${read.via}) ${profile.constant}=${read.value}`
    ]
  };
}

function usage() {
  console.error(
    'usage: node scripts/verify-version-parity.mjs <shared-dist|runtime-src|shared-tarball [file]> [flags]\n' +
      'flags: --expect <version> (override root package.json#version; for tests)\n' +
      'Exit 0 = parity holds; exit 1 = missing/unparseable/drift (fail loud, never silent).'
  );
}

async function cli(argv) {
  const positional = [];
  let expect;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--expect') {
      expect = argv[++i];
    } else if (arg.startsWith('-')) {
      console.error(`[verify-version-parity] unknown flag: ${arg}`);
      return 2;
    } else {
      positional.push(arg);
    }
  }
  const name = positional[0];
  if (!name || !PROFILES[name]) {
    usage();
    return 2;
  }
  const result = await runGate(name, { file: positional[1], expect });
  for (const line of result.lines) console.log(line);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv.slice(2));
}
