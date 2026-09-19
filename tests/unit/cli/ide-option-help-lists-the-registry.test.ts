// tests/unit/cli/ide-option-help-lists-the-registry.test.ts
//
// rid 2026-09-13-leftover-cleanup item 1.1.
//
// The `--ide <id>` help text used to be a hand-written literal —
// `"target adapter id (claude-code | trae); default: auto-detect from env/cwd"`
// — copy-pasted into SIX option declarations across `hooks-commands.ts` and
// `statusline-commands.ts`. The registry has nine adapters, so the help named
// two of the nine values the option accepts and said nothing about the rest.
//
// These cases pin the derivation, not a literal: the help must name every id
// `listAdapterIds()` returns, so registering a tenth adapter cannot leave the
// help behind. The second case is a source scan because a *literal* that
// happens to be correct today is exactly the failure mode being prevented —
// only the absence of a literal proves the string is derived.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listAdapterIds, resolveIdeOptionHelp } from '~/src/services/ide/ide-registry';

const ROOT = join(__dirname, '..', '..', '..');

const COMMAND_FILES = [
  ['src', 'cli', 'commands', 'hooks-commands.ts'],
  ['src', 'cli', 'commands', 'statusline-commands.ts']
] as const;

describe('behavior — the `--ide <id>` help text is derived from the registry', () => {
  it('names every registered adapter id, and claims no id the registry does not have', () => {
    const help = resolveIdeOptionHelp();
    const ids = listAdapterIds();

    // The bug: the literal named 2 of the 9 the option accepts.
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      expect(help, `adapter '${id}' is accepted by --ide but missing from its help`).toContain(id);
    }

    // ...and it must not name anything else as if it were a value. Parse the
    // parenthesised enumeration back out and compare as a set.
    const listed = /\(([^)]*)\)/
      .exec(help)?.[1]
      ?.split('|')
      .map((s) => s.trim());
    expect(listed).toEqual([...ids]);
  });

  it('is used by every `--ide` option declaration instead of an inlined literal', () => {
    // Source scan on purpose: a literal that equals today's registry passes
    // any behavioural assertion, and drifts the moment a tenth adapter lands.
    for (const parts of COMMAND_FILES) {
      const src = readFileSync(join(ROOT, ...parts), 'utf8');
      const declarations = src.match(/\.option\('--ide <id>',[^\n]*/g) ?? [];
      expect(declarations.length, `${parts.join('/')} declares no --ide option`).toBeGreaterThan(0);
      for (const decl of declarations) {
        expect(decl, `${parts.join('/')}: --ide help is not derived: ${decl}`).toContain(
          'resolveIdeOptionHelp()'
        );
      }
      // ...and no stale enumeration survives anywhere in the file.
      expect(src).not.toMatch(/target adapter id \(claude-code \| trae\)/);
    }
  });
});
