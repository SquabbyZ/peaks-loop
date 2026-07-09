/**
 * Polyrepo service — slice S2-b of RD-2.
 *
 * Thin orchestrator wrapping the scanner + dispatcher. CLI commands
 * call into this service so they don't need to know about the
 * individual helpers.
 */
import { dispatchArtifact, readManifest, writeManifest, manifestPath } from './polyrepo-dispatcher.js';
import { scanPolyrepo } from './polyrepo-scanner.js';
import type { PolyrepoChild, PolyrepoManifest } from './polyrepo-types.js';

export interface PolyrepoInitOptions {
  readonly root: string;
  readonly children?: readonly string[];
}

export interface PolyrepoInitResult {
  readonly manifest: PolyrepoManifest;
  readonly created: boolean;
}

export interface PolyrepoStatusResult {
  readonly root: string;
  readonly manifestExists: boolean;
  readonly children: PolyrepoChild[];
  readonly detectedAt: string | null;
}

export class PolyrepoService {
  /** Run a scan and persist the manifest. Returns the manifest + a
   *  `created` flag indicating whether a new manifest was written
   *  (false = existing manifest was overwritten). */
  init(opts: PolyrepoInitOptions): PolyrepoInitResult {
    const existing = readManifest(opts.root);
    const manifest = opts.children === undefined
      ? scanPolyrepo(opts.root)
      : scanPolyrepo(opts.root, { explicitChildren: opts.children });
    writeManifest(opts.root, manifest);
    return { manifest, created: existing === null };
  }

  /** Read the persisted manifest + report children. */
  status(root: string): PolyrepoStatusResult {
    const m = readManifest(root);
    return {
      root,
      manifestExists: m !== null,
      children: m?.children ?? [],
      detectedAt: m?.detectedAt ?? null
    };
  }

  /** Dispatch an artifact to the named child targets. Wrapper
   *  around dispatchArtifact that resolves the manifest from disk
   *  first. Throws when no manifest exists (caller should run init
   *  first). */
  dispatch(root: string, params: {
    sid: string;
    rid: string;
    targets: readonly string[];
    role: 'prd' | 'rd' | 'qa';
    artifactPath: string;
  }) {
    const manifest = readManifest(root);
    if (manifest === null) {
      throw new Error(`no polyrepo manifest at ${manifestPath(root)} — run \`peaks polyrepo init\` first`);
    }
    return dispatchArtifact({
      manifest,
      sid: params.sid,
      rid: params.rid,
      targets: params.targets,
      artifact: { role: params.role, path: params.artifactPath }
    });
  }
}