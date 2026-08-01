/**
 * e2e-fixtures — pure reader for `qa/e2e/<slice>/<scenario>/*.md`.
 *
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 4). The parent session
 * calls `peaks e2e verify --slice <rid>` after the merge-back step. The
 * CLI delegates to `runE2EVerify` (Task 10), which uses this reader to
 * enumerate the fixtures for the slice. The reader returns one of
 * three plans:
 *
 *   - { kind: 'disabled', reason }   when `qa/e2e/<slice>/disabled`
 *                                     exists (the user has opted out)
 *   - { kind: 'empty' }              when the slice has no fixtures
 *   - { kind: 'fixtures', fixtures } when at least one *.md exists
 *
 * Each fixture is parsed for two fields:
 *   - `url: <absolute URL>`           (mandatory line)
 *   - `matchers: [...]`               (free-form lines below)
 *
 * The reader is intentionally simple: it does not validate the URL
 * shape, the matcher grammar, or any browser-level concern. Those
 * concerns belong to the Playwright runner (out of scope here).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type E2EFixture = {
  readonly name: string;
  readonly file: string;
  readonly url: string;
  readonly matchers: ReadonlyArray<string>;
};

export type E2EPlan =
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'fixtures'; readonly fixtures: ReadonlyArray<E2EFixture> };

function readMarkdownFixture(file: string): { url: string; matchers: ReadonlyArray<string> } | null {
  const raw = readFileSync(file, 'utf8');
  let url = '';
  const matchers: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const urlMatch = /^url:\s*(\S.*)$/.exec(line);
    if (urlMatch) url = urlMatch[1] ?? '';
    const matcherMatch = /^matchers:\s*(.*)$/.exec(line);
    if (matcherMatch) {
      const inline = (matcherMatch[1] ?? '').trim();
      if (inline.length > 0) matchers.push(inline);
    }
    const listMatch = /^\s*-\s*['"]?(.*?)['"]?\s*$/.exec(line);
    if (listMatch && !/^matchers:\s*$/.test(line)) {
      matchers.push((listMatch[1] ?? '').trim());
    }
  }
  return { url, matchers };
}

export function readE2EPlan(input: { readonly dir: string }): E2EPlan {
  if (!existsSync(input.dir)) return { kind: 'empty' };
  if (existsSync(join(input.dir, 'disabled'))) {
    return { kind: 'disabled', reason: 'disabled-file-present' };
  }
  const fixtures: E2EFixture[] = [];
  for (const scenario of readdirSync(input.dir)) {
    const scenarioDir = join(input.dir, scenario);
    if (!statSync(scenarioDir).isDirectory()) continue;
    for (const file of readdirSync(scenarioDir)) {
      if (!file.endsWith('.md')) continue;
      const parsed = readMarkdownFixture(join(scenarioDir, file));
      if (parsed === null) continue;
      fixtures.push({
        name: scenario,
        file: join(scenarioDir, file),
        url: parsed.url,
        matchers: parsed.matchers,
      });
    }
  }
  return fixtures.length === 0 ? { kind: 'empty' } : { kind: 'fixtures', fixtures };
}