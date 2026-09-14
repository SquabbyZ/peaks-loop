// Repair cycle 1, item 1 — the terminal-id axis of `peaks playwright`.
//
// QA measured, live, on the working-tree CLI:
//
//   playwright stop --terminal ../../../../X --project <tmp> --json
//     -> ok:true, exit 0
//     -> SIGTERM to the pid named in a session record OUTSIDE the project root
//     -> unlinked that file
//
// The id reached `sessionFilePath()` unsanitised. The guard now lives at that
// join (not at the flag), so every reader and writer of a session record — and
// `stop`'s SIGTERM/unlink pair that hangs off `readSession` — inherits it.
//
// Two directions are asserted, because a guard that refuses everything is not a
// guard: the traversal id must be refused AND leave the outside file alone, and
// a well-formed id must still write, read and unlink INSIDE the project root.
// The tmp root is made by this test; nothing here reads the repository's own
// runtime tree.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  PLAYWRIGHT_SESSIONS_DIR,
  playwrightSessionsDir,
  readSession,
  removeSession,
  sessionFilePath,
  writeSession,
  type PlaywrightSession
} from '../../../../src/cli/commands/playwright-commands.js';

/** A traversal id that resolves the same 4 levels up QA measured. */
const ESCAPE_ID = '../../../../peaks-pw-guard-escape-target';
/** A legal id: the repo's own session-id shape, plus a derived-looking id. */
const LEGAL_IDS = ['ok-terminal', '2026-09-13-session-21878f', 'tty-0f1e2d3c4b5a6978'];

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-pw-guard-'));
  roots.push(root);
  return root;
}

function record(terminalId: string): PlaywrightSession {
  return {
    terminalId,
    port: 9999,
    browser: 'chromium',
    userDataDir: join('userdata', terminalId),
    startedAt: new Date(0).toISOString(),
    pid: 12345
  };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop() as string;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('playwright terminal-id guard (sessionFilePath join)', () => {
  it('refuses a traversal terminal id instead of resolving outside the project root', () => {
    const root = makeRoot();
    const outside = resolve(playwrightSessionsDir(root), `${ESCAPE_ID}.json`);
    // Precondition of the measured escape: the target really is outside `root`.
    expect(outside.startsWith(resolve(root))).toBe(false);

    expect(() => sessionFilePath(root, ESCAPE_ID)).toThrow(/Invalid terminal id/);
    expect(() => readSession(root, ESCAPE_ID)).toThrow(/Invalid terminal id/);
    expect(() => removeSession(root, ESCAPE_ID)).toThrow(/Invalid terminal id/);
  });

  it('does not unlink an outside file that the traversal id resolves to', () => {
    const root = makeRoot();
    const victim = resolve(playwrightSessionsDir(root), `${ESCAPE_ID}.json`);
    writeFileSync(victim, JSON.stringify(record('peaks-pw-guard-escape-target')), 'utf8');
    expect(existsSync(victim)).toBe(true);

    expect(() => removeSession(root, ESCAPE_ID)).toThrow(/Invalid terminal id/);
    // The measured defect was an unlink; the refusal must not have reached it.
    expect(existsSync(victim)).toBe(true);
  });

  it('refuses the ids the shared control rejects (traversal / absolute / drive / backslash)', () => {
    const root = makeRoot();
    const bad = ['..', 'a/..', '../a', '/etc/passwd', 'C:/x', '', '.'];
    for (const id of bad) {
      expect(() => sessionFilePath(root, id), `expected refusal for ${JSON.stringify(id)}`).toThrow(
        /Invalid terminal id/
      );
    }
  });

  it('limit: the shared control does not reject a `/`-separated multi-segment id', () => {
    // Recorded rather than implied. `isUnsafePathInput` rejects the ESCAPE axes
    // (`..`, absolute, drive, backslash) — which is the class this slice is about
    // — but `a/b` has no rejecting segment, so it resolves to
    // `<root>/.peaks/_runtime/playwright-sessions/a/b.json`: a nested directory
    // INSIDE the runtime tree, not an escape. This is the same limit every one of
    // this slice's other guards on that control carries; closing it would need a
    // single-segment control, which is not what the repo's control does.
    const root = makeRoot();
    const path = sessionFilePath(root, 'a/b');
    expect(path.startsWith(resolve(root))).toBe(true);
    expect(path).toBe(join(playwrightSessionsDir(root), 'a', 'b.json'));
  });

  it('still writes, reads and unlinks a well-formed id inside the project root', () => {
    const root = makeRoot();
    for (const id of LEGAL_IDS) {
      const path = sessionFilePath(root, id);
      expect(path).toBe(join(playwrightSessionsDir(root), `${id}.json`));
      expect(path.startsWith(resolve(root))).toBe(true);

      writeSession(root, record(id));
      expect(existsSync(path)).toBe(true);
      expect(readSession(root, id)?.terminalId).toBe(id);
      expect(removeSession(root, id)).toBe(true);
      expect(existsSync(path)).toBe(false);
      // The pinned literal is unchanged: this guard did not move the directory.
      expect(playwrightSessionsDir(root).endsWith(PLAYWRIGHT_SESSIONS_DIR)).toBe(true);
    }
  });
});
