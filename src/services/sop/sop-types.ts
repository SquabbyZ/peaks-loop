/**
 * User-authored SOP (standard operating procedure) skill types — Feature A.
 *
 * A SOP is a user-defined workflow: ordered phases plus gates that guard entry
 * into a phase. Gates are first-class, addressable objects (stable id) so a
 * later metering layer (Feature B) can count them; Slice 1 only models and
 * validates them — no registry, no enforcement.
 */

export type SopGateCheckType = 'file-exists' | 'grep' | 'command';

export type SopGateCheck =
  | { type: 'file-exists'; path: string }
  | { type: 'grep'; file: string; pattern: string }
  | { type: 'command'; run: string[]; expectExitZero?: boolean };

export type SopGate = {
  /** Stable id, unique within the SOP. Addressed by `peaks sop check --gate <id>`. */
  id: string;
  /** The phase whose entry this gate guards; must be one of the SOP's phases. */
  phase: string;
  check: SopGateCheck;
};

export type SopManifest = {
  /** SOP id; namespaced separately from built-in peaks-* skills. */
  id: string;
  name: string;
  description?: string;
  /** Ordered, unique phase names. */
  phases: string[];
  gates: SopGate[];
};

/**
 * A registered gate's workspace-level identity. `ref` (`<sopId>/<gateId>`) is
 * unique across the workspace; `transition` (`<sopId>:<phase>`) is the binding
 * a future enforcement layer (Slice 3) consults. Built-in peaks-* gates are
 * never recorded here.
 */
export type RegisteredGate = {
  ref: string;
  gateId: string;
  sopId: string;
  phase: string;
  transition: string;
};

export type RegisteredSop = {
  id: string;
  path: string;
  gates: RegisteredGate[];
};

export type SopRegistry = {
  version: 1;
  sops: RegisteredSop[];
  /** Total gate count across all registered SOPs — the workspace pool a metering layer would read. */
  gateCount: number;
};

export type SopCheckResult = 'pass' | 'fail' | 'blocked';

export const SOP_GATE_CHECK_TYPES: ReadonlyArray<SopGateCheckType> = ['file-exists', 'grep', 'command'];

/** SOP id grammar: lowercase kebab, must start alphanumeric. */
export const SOP_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
