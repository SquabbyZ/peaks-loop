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

/**
 * Slice L3.1 — UA opt-in UX state. 'unset' triggers an opt-in prompt on
 * first scan; 'skip-this-session' suppresses the prompt for the current
 * session; 'skip-forever' writes to .peaks/preferences.json to suppress
 * all future prompts. Mirrors preferences.json:uaPrompt.
 */
export type UaPromptDecision = 'unset' | 'skip-this-session' | 'skip-forever';

export type UnderstandScanReport = {
  exists: boolean;
  artifactDir: string;
  graph: UnderstandGraphReport;
  intermediate: UnderstandFlagReport;
  diffOverlay: UnderstandFlagReport;
  /** Slice L3.1: opt-in UX state from preferences.json:uaPrompt. */
  readonly uaPrompt?: UaPromptDecision;
};

/**
 * Slice L3.1 — opt-in prompt payload. When uaPrompt === 'unset' and UA is
 * absent, the peaks-solo / peaks-ide layer surfaces this to the user via
 * AskUserQuestion. The CLI does not prompt directly; it returns this
 * payload so the LLM-side UX layer can decide.
 */
export interface UaOptInPrompt {
  readonly version: 1;
  readonly tool: 'ua-opt-in';
  readonly artifactDir: string;
  readonly reason: 'ua-artifact-missing';
  readonly options: readonly {
    readonly id: 'install' | 'fallback-this-session' | 'fallback-forever';
    readonly label: string;
    readonly description: string;
  }[];
}
