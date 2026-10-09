// src/cli/commands/playwright-envelope.ts
//
// The two envelope writers every `peaks playwright` action handler shares.
// Split out of `playwright-commands.ts` so the extracted verb modules emit
// byte-identical envelopes without repeating the branch.

/** `{ ok: true, data }` on `--json`, the human line otherwise. */
export function emitSuccess(json: boolean | undefined, data: unknown, text: string): void {
  if (json === true) {
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
  } else {
    process.stdout.write(text + '\n');
  }
}

/**
 * `{ ok: false, error, code? }` on `--json`, the message on stderr otherwise.
 * Always marks the run failed — every call site in the playwright verbs is a
 * failure path.
 */
export function emitFailure(json: boolean | undefined, message: string, code?: string): void {
  if (json === true) {
    const payload =
      code === undefined ? { ok: false, error: message } : { ok: false, error: message, code };
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    process.stderr.write(message + '\n');
  }
  process.exitCode = 1;
}
