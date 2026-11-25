/**
 * Which sources the S7 audit may read (Task 6c input hygiene).
 *
 * Two exclusions the pilot calibration proved necessary:
 *
 *   - a TEST file is never a page and never a closure input: the pilot scored
 *     `usage-schema-table.test.tsx` as a page and its `<UsageSchemaTable>` as a
 *     data list. Tests are excluded from scoring AND from the import closure,
 *     so a page importing `./__mocks__/rows` cannot borrow a fixture's
 *     empty-state string as if the product declared one.
 *   - an EXAMPLE / DOCS / FIXTURE / TEST tree is not the project's UI source
 *     for the `not-a-ui-project` verdict: a shipped `examples/` demo, the
 *     suite's `tests/**` fixtures or a `.peaks` runtime scratch copy made this
 *     repository look like a UI app and turned its missing contract into a
 *     refusal instead of "no UI here".
 */

import { normalizePath } from '../../../shared/path-utils.js';

/** Directory names that never hold a scoreable UI source. */
const NON_UI_ROOT_DIRS = new Set(['examples', 'docs', 'fixtures', 'tests', 'test']);

/** Segments that mark a test tree. */
const TEST_DIRS = new Set(['__tests__', '__mocks__']);

/** `foo.test.tsx`, `foo.spec.ts`, `foo.test.ts` — a test module by file name. */
const TEST_FILE = /\.(?:test|spec)\.[^/]+$/i;

function segmentsOf(file: string): string[] {
  return normalizePath(file)
    .split('/')
    .filter((segment) => segment !== '');
}

/** True when an app-relative path is a test module or sits in a test tree. */
export function isTestFile(file: string): boolean {
  const segments = segmentsOf(file);
  const name = segments[segments.length - 1] ?? '';
  return TEST_FILE.test(name) || segments.some((segment) => TEST_DIRS.has(segment));
}

/**
 * True when the path belongs to a tree that is not the project's own UI —
 * `examples/**`, `docs/**`, `fixtures/**`, `tests/**`, or a dot directory
 * (`.peaks` runtime scratch, `.stryker-tmp`, `.git`). The first segment
 * decides: a `src/examples/...` module is ordinary source, not a docs tree.
 */
export function isNonUiRoot(file: string): boolean {
  const first = segmentsOf(file)[0];
  if (first === undefined) return false;
  return first.startsWith('.') || NON_UI_ROOT_DIRS.has(first);
}
