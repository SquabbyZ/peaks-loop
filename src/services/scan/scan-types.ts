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

export type ArchetypeReport = {
  archetype: ProjectArchetype;
  confidence: 'high' | 'medium' | 'low';
  frontendOnly: boolean;
  frontendOnlyReason: string;
  signals: ArchetypeSignal[];
  detected: {
    hasPackageJson: boolean;
    hasBackendFramework: boolean;
    backendFrameworks: string[];
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
  kind: 'less-vars' | 'sass-vars' | 'css-vars' | 'tailwind-config' | 'antd-config-provider' | 'theme-file';
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
  };
  inconsistencies: string[];
};
