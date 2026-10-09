// tests/integration/readonly-surface/_spy-probe.mjs
//
// The layer-B INJECTION CONTROL (PRD rid-035 AC-3 B). It is the anti-vacuity twin
// of "the CLI made zero spawn/network calls":
//
//   - the CLI arms assert the counter stays at zero,
//   - this probe asserts the SAME instrument, launched the SAME way, does count.
//
// Without it, a preload whose hooks never fire would report a clean zero for every
// argv and the arm would be green for an instrument that measures nothing. The
// probe is deliberately not part of the CLI: it is a fixed input to the spy, so
// "the spy works" is a separate, falsifiable claim.

import { spawnSync } from 'node:child_process';
import http from 'node:http';

// `windowsHide: true` is the repo convention (no console window on Windows) and
// does NOT weaken this probe: the spy records the CALL at the child_process module
// namespace (`note(name)` in `_readonly-spy-hooks.mjs`, before delegation), so it
// observes the spawn whatever the child's window visibility. The probe observes the
// call, not the window.
spawnSync(process.execPath, ['-e', '0'], { windowsHide: true });

http.request('http://127.0.0.1:1/').on('error', () => {});

await globalThis.fetch('http://127.0.0.1:1/').catch(() => {});
