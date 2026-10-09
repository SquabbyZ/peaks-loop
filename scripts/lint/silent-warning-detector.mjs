#!/usr/bin/env node
// scripts/lint/silent-warning-detector.mjs
//
// Slice A.2 of v2-14-0-anti-fake-green-hardening — G2 service-layer
// silent-warning interceptor. Static AST scan that flags 4 anti-patterns
// the G2 gate considers "fake-green" (test passes while runtime swallows
// real failure):
//
//   1. empty-catch           — `catch (_e) { /* only comments */ }`
//   2. catch-return-null     — `catch (e) { return null; }` (or undefined)
//   3. promise-reject-no-cause— `Promise.reject(x)` where x is not a
//                              real Error or `{ cause: ... }` envelope
//   4. console-error-no-env  — `console.error(...)` inside a function
//                              that never pushes to `envelope.warnings`
//
// The detector is a REPORTER only. It does NOT auto-fix. Failures are
// surfaced as exit-1 so `pnpm test` blocks merges (A2.4).
//
// Self-exemption: the detector skips itself and its own test cases.
// Grace period: a `// TODO(g2):` marker on any line the offending node spans
// suppresses that violation for one minor release (~6 weeks) per A2.2. Line
// EXTENT rather than one line, deliberately: prettier relocates a trailing
// marker off the `catch` line and explodes one-line try/catch forms, and a
// line-anchored anchor read 126 live markers as absent in one `--write` pass.
//
// Design notes (Karpathy #1 Think Before Coding):
//   - TS Compiler API is the chosen parser — `typescript` is already a
//     direct devDependency (no new lint libs added per red-line).
//   - Scope is `src/` only. Tests, scripts, and node_modules are walked
//     but filtered; per-file exemption is the second defense layer.
//   - Output is a stable JSON envelope on stdout so the QA test wrapper
//     can re-assert the same data. (A static-scan precedent once cited
//     here was retired.)
//
// WHAT MOVED (rid-043), AND WHY THE ENTRY IS STILL THIS FILE. It owns the two things
// that are about being a CLI rather than about scanning: `REPO_ROOT` / `SCAN_ROOTS`
// (an absolute path and the default scope) and the `import.meta.url` entry guard. The
// AST predicates, the analyzer and the render moved to siblings; `analyzeSource` is
// re-exported, so the unit-test surface this file has always had is unchanged, and
// `.husky/peaks-gate-silent-warning.mjs` still spawns exactly this path.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { analyzeSource } from './silent-warning-analyze.mjs';
import { renderReport } from './silent-warning-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const SELF_DIRS = ['scripts/lint', 'tests/unit/lint'].map((p) => resolve(REPO_ROOT, p));

const SCAN_ROOTS = ['src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

// Lazy-load the TS Compiler API — kept off the cold path so `--help` is
// instant.
let _ts = null;
async function getTs() {
  if (_ts) return _ts;
  const mod = await import(
    pathToFileURL(resolve(REPO_ROOT, 'node_modules/typescript/lib/typescript.js')).href
  );
  _ts = mod.default ?? mod;
  return _ts;
}

// ---------- file walking -------------------------------------------------

function* walk(root) {
  const absRoot = resolve(REPO_ROOT, root);
  if (!existsSync(absRoot)) return;
  const stack = [absRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && EXTENSIONS.has(extname(e.name))) {
        yield full;
      }
    }
  }
}

function isSelf(file) {
  return SELF_DIRS.some(
    (dir) => file === dir || file.startsWith(dir + '/') || file.startsWith(dir + '\\')
  );
}

// ---------- driver -------------------------------------------------------

/** The files this run was asked for: the named ones, or the default scope walk. */
function collectScanFiles(onlyFiles) {
  const files = [];
  if (onlyFiles.length > 0) {
    for (const f of onlyFiles) {
      const abs = resolve(f);
      if (!existsSync(abs)) continue;
      files.push(abs);
    }
  } else {
    for (const root of SCAN_ROOTS) {
      for (const f of walk(root)) files.push(f);
    }
  }
  return files;
}

/** The scan loop, and the parse errors it surfaces rather than swallows. */
function scanFiles(ts, files, jsonOut) {
  const allViolations = [];
  let scannedCount = 0;

  for (const file of files) {
    if (isSelf(file)) continue;
    if (!EXTENSIONS.has(extname(file))) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scannedCount++;
    try {
      const v = analyzeSource(ts, text, file);
      allViolations.push(...v);
    } catch (err) {
      // Parse errors are not silent-warning violations; surface them
      // separately so the user knows the detector failed to parse a file.
      if (!jsonOut) {
        process.stderr.write(
          `[silent-warning-detector] parse error in ${relative(REPO_ROOT, file)}: ${err.message}\n`
        );
      }
    }
  }

  return { allViolations, scannedCount };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  const warnOnly = argv.includes('--warn-only');
  const jsonOut = argv.includes('--json');
  const onlyFiles = argv.filter((a) => !a.startsWith('-'));

  const ts = await getTs();
  const files = collectScanFiles(onlyFiles);
  const { allViolations, scannedCount } = scanFiles(ts, files, jsonOut);
  renderReport({ allViolations, scannedCount, jsonOut });

  if (allViolations.length === 0) process.exit(0);
  process.exit(warnOnly ? 0 : 1);
}

function printHelp() {
  process.stdout.write(
    [
      'silent-warning-detector — Slice A.2 G2 static AST scan',
      '',
      'Usage:',
      '  node scripts/lint/silent-warning-detector.mjs [options] [files...]',
      '',
      'Options:',
      '  --warn-only   report violations but exit 0 (default: exit 1)',
      '  --json        emit JSON envelope on stdout instead of human text',
      '  -h, --help    show this help',
      '',
      'Defaults to scanning src/. Pass explicit file paths to narrow scope.',
      'Self-exempt: scripts/lint/* and tests/unit/lint/* are never scanned.',
      'Grace marker: add `// TODO(g2):` on any line the offending construct spans',
      'to suppress it for one minor release (prettier may move it within those lines).',
      ''
    ].join('\n')
  );
}

// CLI entry — guard so this module can be imported by tests without running main.
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain) {
  main().catch((err) => {
    process.stderr.write(`[silent-warning-detector] fatal: ${err.stack ?? err.message}\n`);
    process.exit(2);
  });
}

// Exported for the unit test surface (AC A2.3 self-豁免 requires the test
// file to import the detector and assert on its output directly).
export { analyzeSource, isSelf, walk };

/**
 * Convenience async wrapper so test code can pass (source, file) without
 * having to thread the `ts` module through. Mirrors the CLI path.
 */
async function analyzeSourceAsync(source, file) {
  const ts = await getTs();
  return analyzeSource(ts, source, file);
}

export { analyzeSourceAsync };
