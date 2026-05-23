export type UnderstandGraphReport = {
  exists: boolean;
  path: string;
  sizeBytes?: number;
  topLevelFields?: string[];
  counts?: {
    nodes: number;
    edges: number;
    layers: number;
    tours: number;
  };
  parseError?: string;
};

export type UnderstandFlagReport = {
  exists: boolean;
  path: string;
};

export type UnderstandScanReport = {
  exists: boolean;
  artifactDir: string;
  graph: UnderstandGraphReport;
  intermediate: UnderstandFlagReport;
  diffOverlay: UnderstandFlagReport;
};
