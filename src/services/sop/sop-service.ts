import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SOP_GATE_CHECK_TYPES, SOP_ID_PATTERN, type SopGate, type SopManifest } from './sop-types.js';
import { sopDir, sopManifestPath, sopSkillPath } from './sop-paths.js';

/**
 * SOP authoring substrate — Feature A, Slice 1.
 *
 * `initSop` scaffolds a user-authored SOP (manifest + registrable SKILL.md);
 * `lintSop` validates the manifest. No registry, no enforcement here — Slice 1
 * only lets users create and validate a SOP. The SOP id grammar
 * (SOP_ID_PATTERN: lowercase kebab, no dots/slashes) doubles as the path
 * traversal guard, matching how request artifacts guard their ids.
 *
 * SOP definitions are GLOBAL (`~/.peaks/sops/<id>/`, see ./sop-paths) so one
 * authored SOP is reusable across projects; only run-state is per-project. The
 * authoring ops here therefore take no projectRoot.
 */

const RESERVED_ID_PREFIX = 'peaks-';
const RESERVED_IDS = new Set(['peaks']);

export type SopInitOptions = {
  id: string;
  name?: string;
  apply?: boolean;
};

export type SopInitResult = {
  id: string;
  dir: string;
  manifestPath: string;
  skillPath: string;
  manifest: SopManifest;
  skillContent: string;
  applied: boolean;
};

export type SopLintSeverity = 'error' | 'warning';

export type SopLintFinding = {
  code: string;
  message: string;
  gateId?: string;
  severity: SopLintSeverity;
};

export type SopLintResult = {
  ok: boolean;
  id: string;
  manifestPath: string;
  gateCount: number;
  gateIds: string[];
  findings: SopLintFinding[];
};

export type SopLintOptions = {
  id: string;
  /** `command`-type gates run shell-less processes; require explicit opt-in (OQ3 security). */
  allowCommands?: boolean;
};

/**
 * Read and JSON-parse a SOP manifest. Returns null when the SOP does not exist;
 * throws on malformed JSON. Callers that need validation should run lintSop.
 */
export async function readSopManifest(id: string): Promise<SopManifest | null> {
  const manifestPath = sopManifestPath(id);
  if (!existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(await readFile(manifestPath, 'utf8')) as SopManifest;
}

/** Why an id cannot be used; null when the id is acceptable. */
function reservedIdReason(id: string): string | null {
  if (id.startsWith(RESERVED_ID_PREFIX) || RESERVED_IDS.has(id)) {
    return `SOP id "${id}" collides with the reserved built-in peaks-* namespace`;
  }
  return null;
}

function scaffoldManifest(id: string, name: string): SopManifest {
  return {
    id,
    name,
    description: '',
    phases: ['draft', 'review', 'done'],
    gates: [
      { id: 'example-gate', phase: 'review', check: { type: 'file-exists', path: 'README.md' } }
    ]
  };
}

function scaffoldSkill(manifest: SopManifest): string {
  const phaseList = manifest.phases.join(' → ');
  return [
    '---',
    `name: ${manifest.id}`,
    `description: User-authored Peaks SOP "${manifest.name}". Phases: ${phaseList}.`,
    '---',
    '',
    `# ${manifest.name}`,
    '',
    'A user-authored SOP. Edit `sop.json` to define phases and gates, then run',
    '`peaks sop lint` to validate it.',
    '',
    '## Phases',
    '',
    ...manifest.phases.map((phase) => `- ${phase}`),
    ''
  ].join('\n');
}

export async function initSop(options: SopInitOptions): Promise<SopInitResult> {
  if (!SOP_ID_PATTERN.test(options.id)) {
    throw new Error(`Invalid SOP id: ${options.id} (expected lowercase letters, digits, and dashes, starting alphanumeric)`);
  }
  const reserved = reservedIdReason(options.id);
  if (reserved !== null) {
    throw new Error(reserved);
  }

  const dir = sopDir(options.id);
  const manifestPath = sopManifestPath(options.id);
  const skillPath = sopSkillPath(options.id);

  if (existsSync(manifestPath)) {
    throw new Error(`A SOP with id "${options.id}" already exists at ${manifestPath}. Remove it before re-running peaks sop init.`);
  }

  const manifest = scaffoldManifest(options.id, options.name ?? options.id);
  const skillContent = scaffoldSkill(manifest);

  const result: SopInitResult = {
    id: options.id,
    dir,
    manifestPath,
    skillPath,
    manifest,
    skillContent,
    applied: false
  };

  if (options.apply !== true) {
    return result;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(skillPath, skillContent, 'utf8');
  return { ...result, applied: true };
}

function pushError(findings: SopLintFinding[], code: string, message: string, gateId?: string): void {
  findings.push(gateId === undefined ? { code, message, severity: 'error' } : { code, message, gateId, severity: 'error' });
}

function lintGate(
  gate: SopGate,
  index: number,
  phases: Set<string>,
  seenGateIds: Set<string>,
  allowCommands: boolean,
  findings: SopLintFinding[]
): void {
  const label = typeof gate?.id === 'string' && gate.id.length > 0 ? gate.id : `#${index}`;
  if (typeof gate?.id !== 'string' || !SOP_ID_PATTERN.test(gate.id)) {
    pushError(findings, 'INVALID_GATE_ID', `Gate ${label} has an invalid id (expected lowercase kebab)`, label);
    return;
  }
  if (seenGateIds.has(gate.id)) {
    pushError(findings, 'DUPLICATE_GATE_ID', `Duplicate gate id "${gate.id}"`, gate.id);
    return;
  }
  seenGateIds.add(gate.id);

  if (typeof gate.phase !== 'string' || !phases.has(gate.phase)) {
    pushError(findings, 'GATE_PHASE_UNKNOWN', `Gate "${gate.id}" binds to unknown phase "${String(gate.phase)}"`, gate.id);
  }

  const check = gate.check;
  if (check === null || typeof check !== 'object' || !(SOP_GATE_CHECK_TYPES as ReadonlyArray<string>).includes((check as { type?: string }).type ?? '')) {
    pushError(findings, 'INVALID_CHECK_TYPE', `Gate "${gate.id}" has an invalid or missing check type (expected ${SOP_GATE_CHECK_TYPES.join(' | ')})`, gate.id);
    return;
  }

  if (check.type === 'file-exists' && (typeof check.path !== 'string' || check.path.length === 0)) {
    pushError(findings, 'CHECK_MISSING_FIELD', `Gate "${gate.id}" file-exists check requires a non-empty "path"`, gate.id);
  }
  if (check.type === 'grep' && (typeof check.file !== 'string' || check.file.length === 0 || typeof check.pattern !== 'string' || check.pattern.length === 0)) {
    pushError(findings, 'CHECK_MISSING_FIELD', `Gate "${gate.id}" grep check requires non-empty "file" and "pattern"`, gate.id);
  }
  if (check.type === 'command') {
    if (!Array.isArray(check.run) || check.run.length === 0 || !check.run.every((part) => typeof part === 'string')) {
      pushError(findings, 'CHECK_MISSING_FIELD', `Gate "${gate.id}" command check requires a non-empty string array "run"`, gate.id);
    }
    if (!allowCommands) {
      pushError(findings, 'COMMAND_NOT_ALLOWED', `Gate "${gate.id}" uses a command check; re-run with --allow-commands to permit command-type gates`, gate.id);
    }
  }
}

export async function lintSop(options: SopLintOptions): Promise<SopLintResult | null> {
  const manifestPath = sopManifestPath(options.id);
  if (!existsSync(manifestPath)) {
    return null;
  }

  const findings: SopLintFinding[] = [];
  let manifest: SopManifest | null = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SopManifest;
  } catch (error) {
    pushError(findings, 'INVALID_JSON', `Manifest is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`);
    return { ok: false, id: options.id, manifestPath, gateCount: 0, gateIds: [], findings };
  }

  if (typeof manifest.id !== 'string' || !SOP_ID_PATTERN.test(manifest.id)) {
    pushError(findings, 'INVALID_ID', `Manifest id "${String(manifest.id)}" is invalid (expected lowercase kebab)`);
  } else {
    const reserved = reservedIdReason(manifest.id);
    if (reserved !== null) {
      pushError(findings, 'RESERVED_ID', reserved);
    }
    if (manifest.id !== options.id) {
      pushError(findings, 'ID_MISMATCH', `Manifest id "${manifest.id}" does not match its directory "${options.id}"`);
    }
  }

  const phases = Array.isArray(manifest.phases) ? manifest.phases : [];
  if (phases.length === 0) {
    pushError(findings, 'EMPTY_PHASES', 'Manifest must declare at least one phase');
  }
  const phaseSet = new Set<string>();
  for (const phase of phases) {
    if (phaseSet.has(phase)) {
      pushError(findings, 'DUPLICATE_PHASE', `Duplicate phase "${phase}"`);
    }
    phaseSet.add(phase);
  }

  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const seenGateIds = new Set<string>();
  gates.forEach((gate, index) => lintGate(gate, index, phaseSet, seenGateIds, options.allowCommands === true, findings));

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    id: options.id,
    manifestPath,
    gateCount: gates.length,
    gateIds: [...seenGateIds],
    findings
  };
}
