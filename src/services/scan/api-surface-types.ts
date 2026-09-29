/**
 * `src/services/scan/api-surface-types.ts`
 *
 * Report and entry type declarations extracted verbatim from
 * `api-surface-service.ts` (wave 2, file-size cap campaign) so the
 * scanner stays under the 300 raw-line cap. Mechanical move only —
 * `api-surface-service.ts` re-exports every type from its original
 * path.
 */

export type ApiSurfaceOptions = {
  projectRoot: string;
  /** Maximum entries per kind in output (after filtering). */
  maxPerKind?: number;
  /** Comma-separated globs (substring match) to limit the walk. */
  includeDirs?: string;
};

export type CliEntry = {
  name: string;
  description: string;
  sourceFile: string;
};

export type ServiceEntry = {
  name: string;
  kind: 'function' | 'class' | 'const';
  isAsync: boolean;
  sourceFile: string;
  line: number;
};

export type TypeEntry = {
  name: string;
  kind: 'interface' | 'type' | 'enum';
  sourceFile: string;
  line: number;
};

export type ConstantEntry = {
  name: string;
  sourceFile: string;
  line: number;
};

export type ApiSurfaceReport = {
  projectRoot: string;
  scannedAt: string;
  counts: { cli: number; service: number; type: number; constant: number };
  cli: CliEntry[];
  service: ServiceEntry[];
  type: TypeEntry[];
  constant: ConstantEntry[];
  warnings: string[];
};
