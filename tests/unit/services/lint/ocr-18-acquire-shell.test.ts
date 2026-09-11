// tests/unit/services/lint/ocr-18-acquire-shell.test.ts
//
// The acquisition's shell preference: Git Bash → PowerShell → no shell.
//
// `resolveAcquireShell` is driven through the REAL `probeShell` with two seams
// injected (`probeFile`, `runner`), so the Git Bash half is the shipped lookup
// rather than a re-implementation of it. The seams are what let one host
// simulate all three outcomes: a Windows box with Git Bash, a Windows box
// without it, and a Windows box with neither.
//
// Why this order, and why it does not contradict the hook shell: see the
// `ocr-18-acquire.ts` docstring. In short — a hook runs constantly and must be
// invisible; an acquisition runs once and the user wants to watch it.
//
// Dimensions covered:
//   - integration: the real probeShell, driven through the fs/PATH seams it
//                  already declares — every case here stands in for a host
//   - behavior:    not applicable (the preference is only observable through
//                  that boundary; there is no earlier pure decision to assert)
//   - a11y:        not applicable (the resolver prints nothing)
//   - render:      not applicable (it returns a typed descriptor)

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import type { ShellProbeRunner } from '../../../../src/services/env/shell-probe.js';
import { resolveAcquireShell } from '../../../../src/services/lint/ocr-18-acquire.js';

declareDimensions(
  'tests/unit/services/lint/ocr-18-acquire-shell.test.ts',
  ['integration'],
  [
    { dim: 'behavior', reason: 'the preference is observable only through the fs/PATH boundary, which is integration' },
    { dim: 'a11y', reason: 'the resolver prints nothing and has no user-facing surface' },
    { dim: 'render', reason: 'it returns a typed descriptor rather than rendering one' },
  ],
);

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/** `where bash` finds nothing — the second half of "this host has no Git Bash". */
const noBashOnPath: ShellProbeRunner = { run: () => Promise.resolve(null) };

/** A filesystem view naming exactly the paths in `present`, slash-agnostic. */
function onlyPresent(present: readonly string[]): (absPath: string) => boolean {
  const slash = (path: string): string => path.replace(/\\/g, '/');
  const wanted = present.map(slash);
  return (absPath) => wanted.some((entry) => slash(absPath).endsWith(entry));
}

describe('integration — the shell preference order (Git Bash, then PowerShell, then none)', () => {
  it('when Git Bash is installed, should choose bash — the user-preferred shell', async () => {
    // when: a Windows host that has Git Bash at its default location
    const shell = await resolveAcquireShell({
      platform: 'win32',
      env: {},
      probeFile: onlyPresent([GIT_BASH]),
      runner: noBashOnPath,
    });

    // then: bash, by absolute path, and the note names it rather than leaving
    // the choice to be inferred
    expect(shell.kind).toBe('bash');
    expect(shell.path).toBe(GIT_BASH);
    expect(shell.note).toContain(GIT_BASH);
  });

  it('when Git Bash is absent on Windows, should fall back to PowerShell and SAY SO', async () => {
    // given: SystemRoot is the only thing naming the OS PowerShell
    // when: the same host, with no bash anywhere
    const shell = await resolveAcquireShell({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      probeFile: onlyPresent(['powershell.exe']),
      runner: noBashOnPath,
    });

    // then: PowerShell, and the note reports the fallback AND its cause — a
    // silent substitution is how the hook-shell confusion started
    expect(shell.kind).toBe('powershell');
    expect(shell.path?.endsWith('powershell.exe')).toBe(true);
    expect(shell.note).toContain('PowerShell');
    expect(shell.note).toContain('Git Bash is absent');
  });

  it('when neither shell exists, should choose the direct spawn and say so', async () => {
    // when: a Windows host with neither Git Bash nor PowerShell
    const shell = await resolveAcquireShell({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      probeFile: onlyPresent([]),
      runner: noBashOnPath,
    });

    // then: the no-shell branch is taken, reported, and carries no path to spawn
    expect(shell.kind).toBe('direct');
    expect(shell.path).toBeNull();
    expect(shell.note).toContain('no shell');
  });

  it('when the host is not Windows, should use the platform bash unchanged', async () => {
    // when: a POSIX host (probeShell's passthrough branch)
    const shell = await resolveAcquireShell({ platform: 'linux' });

    // then: bash is still first, because on POSIX the preference is already met
    expect(shell.kind).toBe('bash');
    expect(shell.path).toBe('/bin/bash');
  });
});
