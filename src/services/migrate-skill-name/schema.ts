import { z } from 'zod';

/**
 * Result shape for `peaks session migrate-skill-name`.
 *
 * Counters:
 *   - `scannedFiles` — every .json / .md under `.peaks/_runtime/**` (excluding
 *     skip dirs below).
 *   - `modifiedFiles` — files whose contents would change (dry-run reports
 *     the predicted count; --apply reports the actually-written count).
 *   - `keyValueReplacements` — `"skill": "<old>"` → `"skill": "<new>"`.
 *   - `stringReplacements` — `/<old>` → `/<new>` slash-trigger mentions.
 *
 * Errors are surfaced per-file with `errors: [ "<absPath>: <message>", … ]`;
 * the tool never silently skips a broken JSON file (Karpathy §4 honesty:
 * silence on bad data is the worst kind of fake-green).
 */
export const MigrateResultSchema = z.object({
  ok: z.boolean(),
  scannedFiles: z.number().int().nonnegative(),
  modifiedFiles: z.number().int().nonnegative(),
  keyValueReplacements: z.number().int().nonnegative(),
  stringReplacements: z.number().int().nonnegative(),
  skipped: z.array(z.string()),
  errors: z.array(z.string()),
});
export type MigrateResult = z.infer<typeof MigrateResultSchema>;
