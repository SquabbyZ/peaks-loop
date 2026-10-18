/**
 * THE CANONICAL `- type:` RULE, stated here and again where the other reader
 * lives (`src/services/artifacts/request-artifact-metadata.ts`). Both answer
 * "what type does this carrier declare?", and a carrier answered two ways would
 * pick two different prerequisite tables on one tree.
 *
 * THE RULE:
 *   1. each line is TRIMMED before it is read, so indentation is not a difference;
 *   2. the bullet is a HYPHEN (`-`); a `*` bullet is not this rule's syntax;
 *   3. the value is EVERYTHING after `type:` with trailing whitespace removed —
 *      prose appended to the line makes it unusable rather than being truncated;
 *   4. the value must be a request type, checked by the caller (`isRequestType`);
 *   5. the LAST usable line wins, so a later correction overrides an earlier one,
 *      and an unusable later line does not erase an earlier usable one;
 *   6. with no usable line the caller substitutes its own fail-closed default.
 *
 * WHY THIS IS A REIMPLEMENTATION AND NOT AN IMPORT. `contract-verdict.mjs` and
 * this module must load under bare `node`: that is what makes the commit leg's
 * "the checker cannot run" a refusal with a reason instead of a module-resolution
 * stack trace (see that module's header). Importing `src/**` would reintroduce
 * exactly the failure the split avoids. The parity arm in
 * `tests/unit/hooks/pipeline-verify-type-derivation.test.ts` drives both readers
 * over one corpus and holds them equal, so this rule cannot drift alone.
 */

/** `- type: <value>` on a line that has already been trimmed. */
const TYPE_LINE = /^-\s*type:\s*(.+?)\s*$/;

/** Every `- type:` value in a carrier's text, top to bottom, unvalidated. */
export function parseTypeLines(markdown) {
  const values = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = TYPE_LINE.exec(line.trim());
    if (match !== null && match[1] !== undefined) values.push(match[1]);
  }
  return values;
}
