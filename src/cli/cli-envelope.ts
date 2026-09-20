/**
 * The runtime shape of the JSON envelope `peaks … --json` writes to stdout.
 *
 * WHY THIS EXISTS (S12, 2026-09-20). The CLI envelope was the single largest
 * cluster of unvalidated `JSON.parse` in the repo: 21 test files do
 * `JSON.parse(<spawn result>.stdout)` and then read `out.ok` / `out.code` /
 * `out.data.*`. Because `JSON.parse` returns `any`, none of those reads was
 * checked against anything, and each one is a `no-unsafe-*` finding. Measured
 * at the S12 census: ~196 of the ~448 findings in the R1 root.
 *
 * WHAT IS VALIDATED, AND WHAT IS NOT — stated plainly, because the difference
 * is the whole point. The envelope HEAD is always validated: `ok` must be a
 * boolean; `warnings` / `nextActions`, when present, arrays of strings; `code`
 * / `message` / `errorId`, when present, strings. The PAYLOAD (`data`) is
 * validated only as "a JSON object with string keys" — there is no single
 * payload schema, because `data` is `T` in `ResultEnvelope<T>` and every
 * command has its own shape. That is a measured finding of S12, not an
 * oversight: R1 does not collapse onto one schema.
 *
 * A caller that reads `data.<field>` at depth >= 2 therefore names the payload
 * shape itself, through the same validating primitive:
 *
 *     parseCliEnvelopeWith(raw, EvolutionStatusPayload)
 *
 * The alternative — one generic helper with a type parameter and no schema —
 * is the `as T` costume S12 forbids. Here the type parameter is a SCHEMA, so
 * the returned type is derived from a check that actually ran.
 */
import { z } from 'zod';

import { parseJson } from '../shared/json-parse.js';

const anyJsonObject = z.record(z.string(), z.unknown());

/** The head of the envelope, with `data` checked by whichever schema is passed. */
function envelopeWith<S extends z.ZodType>(data: S) {
  // `looseObject` keeps every key the schema does not name, matching
  // `JSON.parse`'s old behaviour of handing back every key: validation is not
  // licence to silently drop fields.
  return z.looseObject({
    ok: z.boolean(),
    // `command` is the one head field that is genuinely optional: the
    // `printCliEnvelope` shim (`src/cli/cli-helpers.ts`, used only by
    // `sediment-commands.ts`) writes `{ ok, data }` / `{ ok, error }`, and
    // `_super.ts` writes `{ ok, data, warnings, nextActions }`.
    command: z.string().optional(),
    data,
    // `warnings` / `nextActions` are OPTIONAL, and that is a MEASURED fact,
    // not a convenience. S12 first made them required on the theory that
    // "every emitter writes them" — then the integration suite proved the
    // theory false: `peaks workspace clean --json`
    // (`src/cli/commands/workspace/clean-command.ts`) writes `{ ok, data }`
    // and nothing else. So the premise this slice inherited — "the CLI stdout
    // envelope has a fixed shape `{ ok, command, data, warnings, nextActions }`"
    // — is wrong as stated; `ok` and `data` are the only universal members.
    // A caller that needs `nextActions` must say so — `program.test.ts` names
    // it in a schema rather than looping over a possibly-absent array.
    warnings: z.array(z.string()).optional(),
    nextActions: z.array(z.string()).optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    errorId: z.string().optional()
  });
}

const baseEnvelopeSchema = envelopeWith(anyJsonObject);

/**
 * Build the envelope schema with a payload schema — for the callers that read
 * `data.<field>` at depth >= 2 and can say what they expect there.
 */
export function cliEnvelopeSchema<S extends z.ZodType>(payload: S) {
  return envelopeWith(payload);
}

/**
 * `ok` + `data` (any JSON object) + the optional head fields.
 */
export type CliEnvelope = z.infer<typeof baseEnvelopeSchema>;

/**
 * Parse a CLI stdout envelope, validating the head. Throws when the text is
 * not JSON, or is JSON that is not an envelope — a caller that fed this
 * something else wants to know, not to read `undefined.ok` further down.
 */
export function parseCliEnvelope(raw: string): CliEnvelope {
  return parseJson(raw, baseEnvelopeSchema);
}

/**
 * Parse a CLI stdout envelope for a caller that reads `data.<field>` at depth
 * >= 2, validating that field's own shape as well. The caller names the shape;
 * nothing is asserted on its behalf.
 */
export function parseCliEnvelopeWith<S extends z.ZodType>(raw: string, payload: S) {
  return parseJson(raw, cliEnvelopeSchema(payload));
}
