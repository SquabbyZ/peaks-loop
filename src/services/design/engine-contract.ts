/**
 * The render engine contract — `design/engine.json`.
 *
 * `render.url` is deliberately `null` by default: a fixed address is written
 * only after the user explicitly confirms one. `startPolicy: 'never'` means
 * peaks only probes a URL it is given; it never launches the dev server on its
 * own during S1.
 */

export type EngineContractFile = {
  schemaVersion: 1;
  contractVersion: string | null;
  engine: {
    name: 'designlang';
    supportedMajor: number;
  };
  render: {
    startCommand: string | null;
    cwd: string;
    port: number;
    path: string;
    pages: string[];
    startPolicy: 'never';
    url: string | null;
  };
  archetypes: string[];
};

export type EngineContractInput = {
  cwd: string;
  startCommand: string | null;
  port: number;
  pages: readonly string[];
  archetypes: readonly string[];
};

export function buildEngineContract(input: EngineContractInput): EngineContractFile {
  return {
    schemaVersion: 1,
    contractVersion: null,
    engine: { name: 'designlang', supportedMajor: 13 },
    render: {
      startCommand: input.startCommand,
      cwd: input.cwd,
      port: input.port,
      path: '/',
      pages: [...input.pages],
      startPolicy: 'never',
      url: null
    },
    archetypes: [...input.archetypes]
  };
}
