// tests/integration/readonly-surface/_readonly-spy.mjs
//
// Layer B preload (PRD rid-035 AC-3 B). This module is loaded with
// `node --import <this file>` INSIDE the CLI process, before the CLI entry runs,
// so everything it measures is measured in the process that would do the work.
//
// WHY IN THE CLI PROCESS AND NOT IN THE SERVER. Measuring the server would assert
// "the server did not spawn the CLI", which is precisely the server's job - a
// tautology that passes for any implementation. The claim under test is about the
// CLI's own behaviour, so the instrument has to sit there (spec §5.3, Q23).
//
// This half runs on the MAIN thread: it owns the counter object the generated
// wrapper modules write into, patches the `fetch` global, and flushes the count to
// `PEAKS_READONLY_SPY_OUT` on exit. The module-NAMESPACE replacement lives in
// `_readonly-spy-hooks.mjs`, on the loader thread.
//
// The counter records a CALL COUNT, not a verdict. `_readonly-proof.e2e` asserts
// it is zero AND runs the control below, so an instrument that intercepts nothing
// cannot report a clean zero.

import { register } from 'node:module';
import { writeFileSync } from 'node:fs';

globalThis.__PEAKS_READONLY_SPY__ = { childProcess: 0, network: 0, calls: [] };

const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const spy = globalThis.__PEAKS_READONLY_SPY__;
  spy.network += 1;
  spy.calls.push('fetch');
  return realFetch(...args);
};

register('./_readonly-spy-hooks.mjs', import.meta.url);

process.on('exit', () => {
  const target = process.env.PEAKS_READONLY_SPY_OUT;
  if (target === undefined || target.length === 0) return;
  writeFileSync(target, JSON.stringify(globalThis.__PEAKS_READONLY_SPY__), 'utf8');
});
