export type ProjectArchetype =
  | 'greenfield'
  | 'legacy-frontend'
  | 'legacy-fullstack'
  | 'frontend-monorepo'
  | 'fullstack-monorepo'
  | 'unknown';

export type ArchetypeSignal = {
  name: string;
  matched: boolean;
  detail?: string;
};

/**
 * Which of the three frontend integration scenarios the consumer project
 * is in. Derived from signals `ArchetypeReport.detected` already carries —
 * no new probes. `frontendOnly` stays for back-compat; this is additive.
 */
export type IntegrationMode = 'full-stack' | 'prd-plus-interface-doc' | 'prd-only';

export type ArchetypeReport = {
  archetype: ProjectArchetype;
  confidence: 'high' | 'medium' | 'low';
  frontendOnly: boolean;
  frontendOnlyReason: string;
  integrationMode: IntegrationMode;
  integrationModeReason: string;
  signals: ArchetypeSignal[];
  detected: {
    hasPackageJson: boolean;
    hasBackendFramework: boolean;
    backendFrameworks: string[];
    /** Backend evidence the ROOT manifest cannot see: a workspace package's own
     *  `package.json` (`apps/gateway: express`) and any non-Node service
     *  manifest (`go.mod`, `services/checkout/requirements.txt (fastapi)`).
     *  Every probe that filled `detected` before this field read Node's
     *  manifest only, so a Go or Java service reported as `frontendOnly`. */
    nestedServiceEvidence: string[];
    /** Next.js server actions (`'use server'` under `app/`). Route handlers
     *  (`pages/api` / `app/api`) were the only Next backend recognised. */
    hasNextServerActions: boolean;
    hasSwaggerOrProto: boolean;
    swaggerPaths: string[];
    hasMonorepoConfig: boolean;
    monorepoConfigs: string[];
    hasNextApiRoutes: boolean;
    srcFileCount: number;
    backendDirsPresent: string[];
    lockfileAgeDays: number | null;
  };
};

export type VisualTokenSource = {
  path: string;
  kind:
    | 'less-vars'
    | 'sass-vars'
    | 'css-vars'
    | 'tailwind-config'
    | 'antd-config-provider'
    | 'theme-file';
};

export type VisualToken = {
  name: string;
  value: string;
  source: string;
};

export type ConventionSample = {
  path: string;
  kind: 'component' | 'service' | 'hook' | 'page';
};

export type HookReturnShape = 'object' | 'tuple' | 'other';

/**
 * One exported function found in a hook directory, read from file text only.
 * Every field is OBSERVED, not verified: `returnShape` comes from the leading
 * token of the returned expression. It is not a type-flow check — a shape
 * produced by a call or held in an identifier is reported as `other`, and
 * `returnSignature` is null when the keys could not be read.
 */
export type HookObservation = {
  file: string;
  name: string;
  usePrefix: boolean;
  returnShape: HookReturnShape;
  returnSignature: string | null;
};

export type HookDirectoryConvention = {
  dir: string;
  hookCount: number;
  hookFileCount: number;
  namingPattern: 'use<X>' | 'mixed' | 'no-use-prefix' | 'unknown';
  /** Null when no class is strictly dominant (a tie), not an arbitrary pick. */
  dominantReturnShape: HookReturnShape | null;
  dominantReturnSignature: string | null;
  /** Hooks whose shape CLASS differs from the dominant one. Key-level drift
   *  is separate detail and never makes an object deviate from objects. */
  offShapeCount: number;
  offShapeHooks: string[];
  /** Files whose import specifiers match /mapper/i — a FILE-level observation:
   *  an import belongs to a module, so it is not attributed to each hook that
   *  module exports. An absent entry is the absence of an observation, NOT
   *  evidence that a hook maps data inline (that would need a value's type). */
  mapperFiles: string[];
  hooks: HookObservation[];
};

export type HookConventionReport = {
  directories: HookDirectoryConvention[];
  inconsistencies: string[];
};

export type ExistingSystemReport = {
  archetype: ProjectArchetype;
  scanned: boolean;
  scanSkippedReason?: string;
  visualTokens: {
    colors: VisualToken[];
    spacing: VisualToken[];
    typography: VisualToken[];
    radii: VisualToken[];
    sources: VisualTokenSource[];
  };
  conventions: {
    componentNaming: 'PascalCase' | 'kebab-case' | 'mixed' | 'unknown';
    componentDir: string | null;
    serviceDir: string | null;
    hookDir: string | null;
    samples: ConventionSample[];
    hookConvention: HookConventionReport;
  };
  inconsistencies: string[];
};
