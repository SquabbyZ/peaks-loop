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

/**
 * Named error codes surfaced by the production invoker (see R7).
 *
 * THE TEST-FILE CODES. `--test-files` answers three different questions and
 * each gets its OWN name, because one name cannot tell a caller which of the
 * three happened:
 *   - `MUT_TEST_FILE_NOT_FOUND` — a LITERAL path that does not exist.
 *   - `MUT_TEST_FILE_NOT_A_FILE` — the path exists but is a directory.
 *   - `MUT_TEST_FILE_PATTERN_UNSUPPORTED` — the value is a PATTERN and the
 *     caller needs literal files (the assertion scanner reads files).
 */
export const MUT_ERROR_CODES = {
  toolchainUnavailable: 'MUT_TOOLCHAIN_UNAVAILABLE',
  projectNotFound: 'MUT_PROJECT_NOT_FOUND',
  mutatePatternRequired: 'MUT_MUTATE_PATTERN_REQUIRED',
  noMutants: 'MUT_NO_MUTANTS',
  failed: 'MUT_FAILED',
  testFileNotFound: 'MUT_TEST_FILE_NOT_FOUND',
  testFileNotAFile: 'MUT_TEST_FILE_NOT_A_FILE',
  testFilePatternUnsupported: 'MUT_TEST_FILE_PATTERN_UNSUPPORTED'
} as const;

/** An error carrying a machine-readable `code` for the CLI envelope. */
export class MutToolchainError extends Error {
  readonly code: string;
  /**
   * Machine-readable detail for the CLI envelope's `data` field — the place
   * an ABSOLUTE path belongs. The human-facing `message` names paths relative
   * to the project root instead, so the prose never leaks a machine path.
   */
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> }
  ) {
    super(message, options);
    this.name = 'MutToolchainError';
    this.code = code;
    this.details = options?.details ?? {};
  }
}
