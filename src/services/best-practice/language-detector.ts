/**
 * Slice 2026-08-12 best-practice-scan — language detector.
 *
 * Detects the project's primary language from well-known marker files.
 * Returns one of: typescript | javascript | python | go | java | unknown.
 *
 * Detection priority (first hit wins):
 *   1. Java    — `pom.xml` or `build.gradle` present
 *   2. Go      — `go.mod` present
 *   3. Python  — `requirements.txt` / `pyproject.toml` / `setup.py` present
 *   4. Node    — `package.json` present:
 *      a. `tsconfig.json` also present  → typescript (high confidence)
 *      b. `package.json` `"type": "module"` + no tsconfig → javascript (medium confidence)
 *      c. default `package.json` (no tsconfig, no `"type"`) → javascript (lower confidence)
 *   5. none of the above → `unknown`
 *
 * Signals are exposed in the result so the caller (orchestrator) can
 * optionally surface the detected marker list to the user.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type DetectedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'java'
  | 'unknown';

export type LanguageDetection = {
  readonly language: DetectedLanguage;
  readonly confidence: number;
  readonly signals: readonly string[];
};

const HIGH = 0.95;
const MEDIUM = 0.8;
const LOW = 0.6;

function hasFile(root: string, name: string): boolean {
  return existsSync(join(root, name));
}

function readPackageType(root: string): string | undefined {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && 'type' in parsed) {
      const typeVal = (parsed as { type?: unknown }).type;
      if (typeof typeVal === 'string') return typeVal;
    }
  } catch {
    /* malformed package.json → treat as absent */
  }
  return undefined;
}

export function detectLanguage(projectRoot: string): LanguageDetection {
  if (!statSync(projectRoot, { throwIfNoEntry: false })) {
    throw new Error(`detectLanguage: projectRoot does not exist: ${projectRoot}`);
  }

  if (hasFile(projectRoot, 'pom.xml') || hasFile(projectRoot, 'build.gradle')) {
    const signals: string[] = [];
    if (hasFile(projectRoot, 'pom.xml')) signals.push('pom.xml');
    if (hasFile(projectRoot, 'build.gradle')) signals.push('build.gradle');
    return { language: 'java', confidence: HIGH, signals };
  }

  if (hasFile(projectRoot, 'go.mod')) {
    return { language: 'go', confidence: HIGH, signals: ['go.mod'] };
  }

  if (
    hasFile(projectRoot, 'requirements.txt') ||
    hasFile(projectRoot, 'pyproject.toml') ||
    hasFile(projectRoot, 'setup.py')
  ) {
    const signals: string[] = [];
    if (hasFile(projectRoot, 'requirements.txt')) signals.push('requirements.txt');
    if (hasFile(projectRoot, 'pyproject.toml')) signals.push('pyproject.toml');
    if (hasFile(projectRoot, 'setup.py')) signals.push('setup.py');
    return { language: 'python', confidence: HIGH, signals };
  }

  if (hasFile(projectRoot, 'package.json')) {
    if (hasFile(projectRoot, 'tsconfig.json')) {
      return {
        language: 'typescript',
        confidence: HIGH,
        signals: ['package.json', 'tsconfig.json']
      };
    }
    const pkgType = readPackageType(projectRoot);
    if (pkgType === 'module') {
      return {
        language: 'javascript',
        confidence: MEDIUM,
        signals: ['package.json', '"type": "module"']
      };
    }
    return {
      language: 'javascript',
      confidence: LOW,
      signals: ['package.json']
    };
  }

  return { language: 'unknown', confidence: 0, signals: [] };
}