/**
 * Per spec §4.1 — the single source of truth for context.json shape.
 * The Zod schema in context-schema.ts must mirror this interface exactly;
 * the schema is the runtime validator, the interface is the compile-time contract.
 *
 * Hard constraint H8: Audit trail must be hashable. `sha256` is the field
 * that lets peaks-state-lock chain signatures between stages.
 */

export type ContextVersion = '1.0';

export type Audience = 'peaks-rd' | 'peaks-qa' | 'peaks-mut' | 'all';

export type DepsMode = 'locked' | 'latest';

export type FileKind = 'source' | 'test' | 'config' | 'doc';

export interface CollectedFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly lines: number;
  readonly hash: string;
}

export interface GitStatus {
  readonly branch: string;
  readonly lastCommit: string;
  readonly dirty: boolean;
}

export interface MemoryEntry {
  readonly path: string;
  readonly title: string;
  readonly relevanceScore: number;
  readonly excerptHash: string;
}

export interface DepInfo {
  readonly version: string;
  readonly source: 'package.json' | 'pnpm-lock.yaml' | 'yarn.lock';
  readonly resolved: string;
}

export interface DocSection {
  readonly title: string;
  readonly tokenEstimate: number;
  readonly excerpt: string;
}

export interface FetchedDoc {
  readonly dep: string;
  readonly version: string;
  readonly source: 'local-cache' | 'remote-fetch';
  readonly url?: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly sections: ReadonlyArray<DocSection>;
  readonly stale: boolean;
}

export interface SkippedDoc {
  readonly dep: string;
  readonly reason: 'unconfigured' | 'network_error' | 'version_unknown';
}

export type MetaKind = 'doc' | 'code' | 'memory' | 'git';

export interface TokenizedItem {
  readonly id: string;
  readonly kind: MetaKind;
  readonly version?: string;
  readonly blastRadius: ReadonlyArray<string>;
  readonly conflictScore: number;
  readonly timeDecayScore: number;
  readonly tags: ReadonlyArray<string>;
}

export interface CollectorOutput {
  readonly files: ReadonlyArray<CollectedFile>;
  readonly gitStatus: GitStatus;
  readonly memoryEntries: ReadonlyArray<MemoryEntry>;
  readonly deps: Readonly<Record<string, DepInfo>>;
}

export interface DocRetrieverOutput {
  readonly fetchedDocs: ReadonlyArray<FetchedDoc>;
  readonly skipped: ReadonlyArray<SkippedDoc>;
}

export interface TokenizerOutput {
  readonly metadata: ReadonlyArray<TokenizedItem>;
}

export interface RendererOutput {
  readonly audience: Audience;
  readonly renderedAt: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
  readonly truncatedReason?: 'doc_budget_exceeded' | 'section_count_exceeded';
}

export interface ContextJson {
  readonly version: ContextVersion;
  readonly goal: string;
  readonly generatedAt: string;
  readonly sha256: string;
  readonly collector: CollectorOutput;
  readonly docRetriever: DocRetrieverOutput;
  readonly tokenizer: TokenizerOutput;
  readonly renderer: RendererOutput;
}