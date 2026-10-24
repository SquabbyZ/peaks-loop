/**
 * The named error codes of the mutation pipeline, and the error type that
 * carries them.
 *
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------
 * The production invoker raises these codes from three places, and the plugin
 * resolver raises one of them from a module of its own. Keeping the codes
 * here lets both raise the SAME error type without an import cycle;
 * `production-stryker.ts` re-exports these names, so the names this package
 * exports are unchanged by the split.
 */

/** Named error codes surfaced by the production invoker (see R7). */
export const MUT_ERROR_CODES = {
  toolchainUnavailable: 'MUT_TOOLCHAIN_UNAVAILABLE',
  projectNotFound: 'MUT_PROJECT_NOT_FOUND',
  mutatePatternRequired: 'MUT_MUTATE_PATTERN_REQUIRED',
  noMutants: 'MUT_NO_MUTANTS',
  failed: 'MUT_FAILED'
} as const;

/** An error carrying a machine-readable `code` for the CLI envelope. */
export class MutToolchainError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MutToolchainError';
    this.code = code;
  }
}
