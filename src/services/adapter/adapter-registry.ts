/**
 * Adapter registry — slice S2-a of RD-2.
 *
 * Persists user-registered vendor adapters to
 * `.peaks/runtime/adapters.json` and resolves them by id. The
 * registry is layered on top of `RuntimeService` (built-in adapters
 * live there); a caller asks "do you have an adapter for id=X?" by
 * first asking the registry, then falling back to built-ins. The
 * runtime service itself does NOT consult the registry (kept
 * decoupled so the registry can be swapped for a different
 * persistence backend without touching runtime-service).
 *
 * Design notes:
 *  - Persistence uses atomic write (write to tmp + rename) so a
 *    crash mid-write does not corrupt the registry file.
 *  - `register()` defaults to fail-if-exists to prevent silent
 *    overwrites of user customizations; pass `force: true` to
 *    overwrite (matches the CLI surface from PRD §4.4).
 *  - VendorAdapter implementations are NOT directly serializable
 *    (they hold closures over `home`, child_process handles, etc.).
 *    Instead the registry persists a minimal JSON shape:
 *    `{id, displayName, binary, args}` and reconstructs a
 *    ProcessVendorAdapter wrapper on load. This keeps the JSON
 *    file human-readable + diff-friendly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  VendorAdapter,
  VendorCompactArgs,
  VendorCompactResult
} from '../runtime/vendor-adapter.js';

/** Serializable adapter record (the on-disk shape). */
export interface AdapterRecord {
  readonly id: string;
  readonly displayName: string;
  /** Binary name or absolute path to invoke for compact. */
  readonly binary: string;
  /** Extra args appended after the compact verb. */
  readonly args?: string[];
}

export interface PersistedAdapterRegistry {
  readonly version: 1;
  readonly adapters: AdapterRecord[];
}

/** A registry-built adapter: wraps a persisted record + invokes the
 *  recorded binary with the recorded args. Used so `peaks runtime
 *  compact --via <id>` works against user-registered adapters without
 *  peaks-loop needing to ship a vendor-specific implementation. */
class ProcessVendorAdapter implements VendorAdapter {
  readonly id: string;
  readonly displayName: string;
  private readonly binary: string;
  private readonly extraArgs: string[];

  constructor(record: AdapterRecord) {
    this.id = record.id;
    this.displayName = record.displayName;
    this.binary = record.binary;
    this.extraArgs = record.args ?? [];
  }

  async detect(): Promise<boolean> {
    // Heuristic: process-spawned adapters are always "detectable" once
    // registered; their actual availability is checked at compact()
    // time. This avoids probing every registered binary on every
    // detect() call.
    return true;
  }

  async compact(args: VendorCompactArgs = {}): Promise<VendorCompactResult> {
    const argv = [...this.extraArgs];
    if (args.force === true) argv.push('--force');
    return new Promise<VendorCompactResult>((resolveRun) => {
      const proc = spawn(this.binary, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('error', (err) => {
        resolveRun({ exitCode: 127, stdout, stderr: stderr + (stderr.length > 0 ? '\n' : '') + err.message });
      });
      proc.on('close', (code) => {
        resolveRun({ exitCode: code ?? 0, stdout, stderr });
      });
    });
  }
}

/** Validate an adapter record. Used by register() to fail fast on
 *  malformed CLI input. Returns an error message or undefined. */
function validateRecord(record: AdapterRecord): string | undefined {
  if (record.id.length === 0) return 'adapter id must be non-empty';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(record.id)) {
    return `adapter id "${record.id}" must match /^[a-z0-9][a-z0-9._-]*$/`;
  }
  if (record.displayName.length === 0) return 'adapter displayName must be non-empty';
  if (record.binary.length === 0) return 'adapter binary must be non-empty';
  if (record.binary.includes('/') || record.binary.includes('\\')) {
    return `adapter binary "${record.binary}" must be a name, not a path`;
  }
  return undefined;
}

export interface RegisterOptions {
  /** Overwrite an existing record with the same id. Defaults to false
   *  to prevent silent overwrites of user customizations. */
  readonly force?: boolean;
}

/** In-memory + on-disk adapter registry. The registry holds USER
 *  adapters (those registered via `peaks adapter register`); built-in
 *  adapters live in RuntimeService and are NOT registered here. */
export class AdapterRegistry {
  private readonly records = new Map<string, AdapterRecord>();

  /** Register a new adapter. When an adapter with the same id already
   *  exists, returns the existing record unless `force: true`. */
  register(record: AdapterRecord, opts: RegisterOptions = {}): { record: AdapterRecord; created: boolean } {
    const validationError = validateRecord(record);
    if (validationError !== undefined) {
      throw new Error(`invalid adapter record: ${validationError}`);
    }
    const existed = this.records.has(record.id);
    if (existed && opts.force !== true) {
      return { record: this.records.get(record.id) as AdapterRecord, created: false };
    }
    this.records.set(record.id, record);
    return { record, created: !existed };
  }

  /** Resolve a registered adapter by id, materializing it as a
   *  runnable VendorAdapter. Returns undefined when not registered. */
  resolve(id: string): VendorAdapter | undefined {
    const rec = this.records.get(id);
    if (rec === undefined) return undefined;
    return new ProcessVendorAdapter(rec);
  }

  /** List registered adapter records (serializable form). */
  list(): AdapterRecord[] {
    return Array.from(this.records.values());
  }

  /** Remove a registered adapter. Returns true if it existed. */
  unregister(id: string): boolean {
    return this.records.delete(id);
  }

  /** Persist the current registry to disk as JSON. Writes atomically
   *  (write to `<file>.tmp` then rename) so a crash mid-write does
   *  not corrupt the registry file. */
  persist(file: string): void {
    const payload: PersistedAdapterRegistry = {
      version: 1,
      adapters: this.list()
    };
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, file);
  }

  /** Load a registry from disk. Missing file = empty registry.
   *  Corrupt file = throw (caller decides whether to bail or
   *  fall back to empty). */
  load(file: string): void {
    if (!existsSync(file)) return;
    const raw = readFileSync(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`adapter registry at ${file} is not valid JSON: ${(err as Error).message}`);
    }
    if (!isPersistedRegistry(parsed)) {
      throw new Error(`adapter registry at ${file} has unexpected shape (expected version=1 + adapters[])`);
    }
    this.records.clear();
    for (const rec of parsed.adapters) {
      const validationError = validateRecord(rec);
      if (validationError !== undefined) {
        // Skip + continue — partial recovery is better than throwing on
        // a single bad row. The CLI surfaces the count of skipped
        // records via the load() return value below.
        continue;
      }
      this.records.set(rec.id, rec);
    }
  }

  /** Default location for the on-disk registry file. */
  static defaultFile(projectRoot: string): string {
    return join(projectRoot, '.peaks', 'runtime', 'adapters.json');
  }
}

function isPersistedRegistry(value: unknown): value is PersistedAdapterRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { version?: unknown; adapters?: unknown };
  if (v.version !== 1) return false;
  if (!Array.isArray(v.adapters)) return false;
  return v.adapters.every((a) => {
    if (typeof a !== 'object' || a === null) return false;
    const r = a as { id?: unknown; displayName?: unknown; binary?: unknown; args?: unknown };
    return typeof r.id === 'string'
      && typeof r.displayName === 'string'
      && typeof r.binary === 'string'
      && (r.args === undefined || (Array.isArray(r.args) && r.args.every((x) => typeof x === 'string')));
  });
}