import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const forbidden = /import\s*\{[^}]*\b(?:detectIdeFromEnv|IdeKind|IDE_KINDS|isIdeKind)\b[^}]*\}\s*from\s*['"][^'"]*main-session-monitor(?:\.js)?['"]/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('main-session-monitor import hard ban', () => {
  it('has no non-legacy source imports', () => {
    const violations = sourceFiles(sourceRoot)
      .filter((path) => !path.endsWith(`${join('services', 'context', 'main-session-monitor.ts')}`))
      .flatMap((path) => {
        const matches = readFileSync(path, 'utf8').match(forbidden) ?? [];
        return matches.length === 0 ? [] : [`${relative(process.cwd(), path)}: ${matches[0]}`];
      });
    expect(violations).toEqual([]);
  });
});
