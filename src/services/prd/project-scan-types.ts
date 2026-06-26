/**
 * peaks-prd project-scan — types.
 *
 * `.peaks/project-scan/` is the **git-tracked** project-level artifact
 * that carries tech-stack snapshot + business-knowledge sediment. It
 * is the load-bearing input to peaks-prd Step 0.8 ("Read project-scan
 * before brainstorm") and the output sink for peaks-txt's sediment
 * step (Group C, AC-5).
 *
 * Layout:
 *   .peaks/project-scan/
 *     project-scan.md         — tech stack snapshot + architecture
 *     business-knowledge.md   — structured concept table (this file)
 *
 * Schema invariants:
 *   - `schemaVersion` is bumped on any breaking shape change.
 *   - `BusinessConcept.concept` + `sourceRid` is the idempotency key
 *     for sediment appends (Group C MUST NOT duplicate on re-run).
 */

/** Tech-stack snapshot. `language` / `packageManager` are closed
 *  unions (Karpathy §2 — no string sprawl); `runtime` / `buildTool`
 *  are free-form (peaks-cli does not constrain them). */
export interface ProjectScanTechStack {
  readonly language: 'typescript';
  readonly packageManager: 'pnpm';
  readonly runtime: string;
  readonly buildTool?: string;
}

/** Library versions mirror `package.json` dependencies at snapshot
 *  time. The reader does NOT re-resolve semver — the snapshot is the
 *  truth at `capturedAt`. */
export interface ProjectScanLibraryVersions {
  readonly [packageName: string]: string;
}

/** Karpathy §2 5-anti-pattern self-check. Captured at snapshot time
 *  by the LLM that runs `peaks project scan`. Mirrors the
 *  `andrej-karpathy-skills:karpathy-guidelines` checklist. */
export interface ProjectScanKarpathySelfCheck {
  readonly simpleFirst: string;
  readonly surgicalChanges: string;
  readonly goalDriven: string;
  readonly thinkBefore: string;
}

export interface ProjectScan {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly techStack: ProjectScanTechStack;
  readonly libraryVersions: ProjectScanLibraryVersions;
  readonly architecture: string;
  readonly karpathySelfCheck: ProjectScanKarpathySelfCheck;
}

/** Single business concept — schema-sedimented (NOT free text, per
 *  D3 in `v2-11-rm-rd-techdoc-immutable-handoff`). The 5-tuple shape
 *  is enforced by the sediment writer (Group C) so peaks-prd can
 *  query it deterministically. */
export interface BusinessConcept {
  readonly concept: string;
  readonly definition: string;
  readonly sourceRid: string;
  readonly decidedAt: string;
  readonly evidence: string;
}

export interface BusinessKnowledge {
  readonly schemaVersion: 1;
  readonly concepts: readonly BusinessConcept[];
}