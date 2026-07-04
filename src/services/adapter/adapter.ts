export interface AdapterSegment {
  name: string;
  skillMd: string;
  scripts: { name: string; content: string }[];
}
export interface AdapterEnvelope {
  preamble: string;
  refs: { path: string; kind: "file" | "dir" | "script" }[];
}

export interface Adapter {
  readonly name: "claude" | "codex" | "copilot" | "auto";
  resolveScratchDir(beeName: string): Promise<string>;
  materialize(
    beeName: string,
    env: AdapterEnvelope,
    segments: AdapterSegment[],
  ): Promise<string>;
  publish(scratchDir: string): Promise<string>;
  activate(scratchDir: string): Promise<void>;
  cleanup(scratchDir: string): Promise<void>;
  detect(): Promise<boolean>;
}

export class ADAPTER_NOT_IMPLEMENTED extends Error {
  constructor(adapter: string, method: string) {
    super(`ADAPTER_NOT_IMPLEMENTED: ${adapter}.${method} — stub until later slice`);
  }
}
