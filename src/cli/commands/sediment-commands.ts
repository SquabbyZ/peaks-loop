/**
 * `peaks skill sediment <verb>` — Sediment pool CLI primitives.
 *
 * Slices 2026-07-04-cli-15a (Task 15a) and 2026-07-04-cli-15b (Task 15b)
 * of the 18-verb plan. This file implements 8 of 18 verbs:
 *
 *   Task 15a:
 *     add-segment   — scaffold ~/.peaks/skills/segments/<name>/SKILL.md
 *     add-bee       — write ~/.peaks/skills/bees/<name>/manifest.json
 *     list          — read index.json via readPool
 *     rebuild-index — rewrite index.json from filesystem state
 *
 *   Task 15b:
 *     refine-bee    — append a NL-described patch to an existing bee manifest
 *     clone-bee     — duplicate an existing bee to a new name, status reset
 *     promote       — flip candidate → stable when PromotionGate passes
 *     retire        — flip → retired, optionally record a reason
 *
 * Other verbs (dispose / releases / release-show / release-diff / export /
 * import / gc-blobs / search / recent / show) return
 * `{ ok: false, error: "UNKNOWN_VERB: …" }` until Tasks 15c / 15d fill them.
 *
 * The CLI boundary is runSediment(argv, { home }): it returns a
 * `{ ok, error?, data? }` envelope so program.ts can render the result
 * as JSON via peaks-cli's existing printResult primitive.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import type { Command } from "commander";
import {
  SYSTEM_PATH_FORBIDDEN,
  assertNotSystemPath,
  resolveSegmentsDir,
  resolveStateDbPath,
  resolveBlobsDir,
  resolveUserBeesDir,
  resolveUserBeeDir,
} from "../../services/sediment/pool-paths.js";
import { writeBeeManifest } from "../../services/sediment/pool-write.js";
import { readPool } from "../../services/sediment/pool-read.js";
import { rebuildIndexFromFs } from "../../services/sediment/pool-rebuild-index.js";
import { evaluateGate } from "../../services/sediment/promotion-gate.js";
import type { BeeManifest } from "../../services/sediment/types.js";
import type { ProgramIO } from "../cli-helpers.js";
import { printCliEnvelope } from "../cli-helpers.js";
import { openStateDb } from "../../services/skillhub/sqlite-store.js";
import { retainRelease } from "../../services/skillhub/release-retain.js";
import { releaseDiff } from "../../services/skillhub/release-diff.js";
import { exportRelease } from "../../services/skillhub/release-export.js";
import { importRelease } from "../../services/skillhub/release-import.js";
import { gcBlobs } from "../../services/skillhub/release-gc-blobs.js";

export interface CliResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** Typed accessor over the flag map produced by `parseFlags`.
 *
 * `parseFlags` internally stores every flag with at least one value as a
 * `string[]`. A flag with no following non-flag token (e.g. `--apply`,
 * `--dry-run`) is recorded as `true`. This helper exposes three typed
 * accessors so call-sites don't have to re-narrow `unknown` or
 * `string | boolean | string[]` on every read:
 *
 *   - `flags.list(name)`     → `string[]` (always an array; a single
 *                              occurrence is wrapped to a 1-element
 *                              array at parse time)
 *   - `flags.bool(name)`     → `boolean` (presence-of flag; missing
 *                              flag is `false`)
 *   - `flags.maybeString(name)` → `string | undefined` (first value,
 *                              or `undefined` if the flag was given
 *                              as a bare boolean with no value)
 *
 * The dispatch layer (runSediment) was previously peppered with
 * `typeof flags.x === "string"` / `Array.isArray(flags.x)` narrowing.
 * With this helper the call-sites collapse to one-line reads and the
 * raw flag map stops leaking across the runSediment boundary.
 */
export class ParsedFlags {
  private readonly raw: Record<string, string[] | true>;
  constructor(raw: Record<string, string[] | true>) {
    this.raw = raw;
  }
  /** Always returns an array. Missing flag → []. Single-occurrence
   *  flag → a 1-element array (parseFlags normalizes this). */
  list(name: string): string[] {
    const v = this.raw[name];
    if (v === undefined) return [];
    if (v === true) return [];
    return v;
  }
  /** Presence-of a bare boolean flag. Missing → false. */
  bool(name: string): boolean {
    const v = this.raw[name];
    if (v === undefined) return false;
    // A flag given as `--name <value>` is also "present" (it just happens
    // to carry values too). Existing call-sites that want `--dry-run`
    // semantics care about presence, not whether values are attached.
    return true;
  }
  /** First value of a flag, or `undefined` if the flag is absent or
   *  was given as a bare boolean. */
  maybeString(name: string): string | undefined {
    const v = this.raw[name];
    if (v === undefined) return undefined;
    if (v === true) return undefined;
    return v[0];
  }
}

/** Parse an argv tail into positional args + flag map.
 *
 * Supports:
 *   --flag value    → flags[flag] = [value, ...] (advance i by 1)
 *   --flag          → flags[flag] = true        (when next token starts with `--` or is undefined)
 *   --flag v1 --flag v2   → repeated `--flag` values are accumulated
 *
 * Internally stores all values as `string[]` (or `true` for a bare
 * boolean flag). Use the `ParsedFlags` helper to read typed accessors.
 *
 * Repeatable flag handling (Task 15b): when the same `--key` appears
 * consecutively (e.g. `--segment a --segment b --segment c`), values
 * are accumulated into a single `string[]`. A single occurrence is
 * normalized to a 1-element array so callers can use `.list(name)`
 * uniformly without shape-narrowing on the call-site.
 */
export function parseFlags(argv: string[]): {
  positional: string[];
  flags: ParsedFlags;
} {
  const positional: string[] = [];
  const rawFlags: Record<string, string[] | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        rawFlags[k] = true;
      } else {
        // Capture first value, then look ahead for `--k <value>` repeats.
        const values: string[] = [v];
        i += 2;
        while (
          i < argv.length &&
          argv[i] === `--${k}` &&
          i + 1 < argv.length &&
          !argv[i + 1]!.startsWith("--")
        ) {
          values.push(argv[i + 1]!);
          i += 2;
        }
        // Back up one — the outer for-loop will i++ past the flag, so the
        // next iteration sees the next real token.
        i--;
        rawFlags[k] = values;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags: new ParsedFlags(rawFlags) };
}

/** Dispatch a sediment verb argv to the matching implementation.
 *
 * Returns { ok: true, data? } on success and { ok: false, error }
 * on validation failure or SYSTEM_PATH_FORBIDDEN. Unknown verbs
 * return `{ ok: false, error: "UNKNOWN_VERB: <v>" }` so callers can
 * distinguish "not yet implemented" from "zod rejected".
 */
export async function runSediment(
  argv: string[],
  { home }: { home: string }
): Promise<CliResult> {
  const { positional, flags } = parseFlags(argv);
  const verb = positional[0];
  try {
    switch (verb) {
      case "add-segment": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: name" };
        const description = flags.maybeString("describe") ?? "";
        const segDir = join(resolveSegmentsDir({ home }), name);
        // Soft-protection guard: refuse to write under any `.system` path
        // segment. Mirrors the same guard in writeBeeManifest.
        assertNotSystemPath(segDir);
        mkdirSync(segDir, { recursive: true });
        writeFileSync(
          join(segDir, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${description}\n---\n`
        );
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "add-bee": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: name" };
        // Collect --segment values; the brief uses repeatable --segment
        // flags (one token per segment). parseFlags now returns a
        // 1-element array for a single occurrence and a longer array
        // for repeated keys, so .list() returns a uniform string[].
        const segList = flags.list("segment");
        const description = flags.maybeString("description") ?? "";
        const m: BeeManifest = {
          schemaVersion: "peaks.bee/1",
          name,
          source: "user",
          promotion_status: "candidate",
          description,
          segments: segList.map((s) => ({
            name: s,
            inputs: [],
            outputs: [],
            sideEffects: [],
          })),
          entrypoint: { preamble: `## ${name}`, refs: [] },
          promotion: {
            minCycles: 1,
            requiresHumanApproval: true,
            requiresSmokeTest: true,
          },
          createdBy: "llm",
          lastTouchedAt: new Date().toISOString(),
        };
        // writeBeeManifest runs zod validation + SYSTEM_PATH_FORBIDDEN
        // guard internally.
        writeBeeManifest({ home }, m);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "list": {
        const idx = readPool({ home });
        return { ok: true, data: idx.entries };
      }
      case "rebuild-index": {
        const idx = rebuildIndexFromFs({ home });
        return { ok: true, data: idx };
      }
      // --- Task 15b verbs ---
      case "refine-bee": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: refine-bee requires <name>" };
        const patch = flags.maybeString("patch") ?? "";
        if (!patch) return { ok: false, error: "MISSING_ARG: refine-bee requires --patch" };
        const manifestPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(manifestPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as BeeManifest;
        // Append patch note to description, preserving prior content. Cap at
        // 1000 chars to avoid unbounded growth.
        const ts = new Date().toISOString();
        const note = `[refine ${ts}] ${patch}`;
        m.description = (m.description + (m.description ? "\n" : "") + note).slice(0, 1000);
        m.lastTouchedAt = ts;
        // promotion_status is preserved (do not touch it here).
        writeBeeManifest({ home }, m);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "clone-bee": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: clone-bee requires <name>" };
        const asName = flags.maybeString("as") ?? "";
        if (!asName) return { ok: false, error: "MISSING_ARG: clone-bee requires --as <new-name>" };
        const srcPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(srcPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        const src = JSON.parse(readFileSync(srcPath, "utf-8")) as BeeManifest;
        // Fresh id, reset promotion_status to candidate, rename. The source
        // manifest is unchanged on disk.
        const clone: BeeManifest = {
          ...src,
          name: asName,
          promotion_status: "candidate",
          lastTouchedAt: new Date().toISOString(),
        };
        writeBeeManifest({ home }, clone);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "promote": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: promote requires <name>" };
        const manifestPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(manifestPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as BeeManifest;
        if (m.source === "system") return { ok: false, error: "PROMOTION_SYSTEM_REFUSED" };
        // Evaluate the PromotionGate (Task 5). The CLI is a thin shim; the
        // humanApproved / smokeTestPresent inputs default to "true" here
        // because the LLM-driven peaks-maker workflow has already obtained
        // those approvals before calling promote.
        const gate = evaluateGate(
          { home },
          m,
          { humanApproved: true, smokeTestPresent: m.promotion.requiresSmokeTest }
        );
        if (!gate.ok) {
          return {
            ok: false,
            error: `PROMOTION_GATE_FAILED: ${gate.failedSubconditions.join(",")}`,
          };
        }
        m.promotion_status = "stable";
        m.lastTouchedAt = new Date().toISOString();
        writeBeeManifest({ home }, m);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      case "retire": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: retire requires <name>" };
        const reason = flags.maybeString("reason") ?? "";
        const manifestPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(manifestPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as BeeManifest;
        if (m.source === "system") return { ok: false, error: "RETIRE_SYSTEM_REFUSED" };
        m.promotion_status = "retired";
        if (reason) {
          const ts = new Date().toISOString();
          const note = `[retire ${ts}] ${reason}`;
          m.description = (m.description + (m.description ? "\n" : "") + note).slice(0, 1000);
        }
        m.lastTouchedAt = new Date().toISOString();
        writeBeeManifest({ home }, m);
        rebuildIndexFromFs({ home });
        return { ok: true };
      }
      // --- Task 15c verbs ---
      case "dispose": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: dispose requires <name>" };
        const decision = flags.maybeString("decision") ?? "";
        if (decision !== "destroy" && decision !== "retain") {
          return { ok: false, error: "MISSING_ARG: dispose requires --decision destroy|retain" };
        }
        const manifestPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(manifestPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        const m = JSON.parse(readFileSync(manifestPath, "utf-8")) as BeeManifest;
        // System bees: silently destroy; refuse retain (Task 9 contract).
        if (m.source === "system") {
          if (decision === "retain") return { ok: false, error: "RETAIN_SYSTEM_REFUSED" };
          return { ok: true, data: { systemDestroyed: true } };
        }
        // User bee destroy: remove the manifest dir from the pool. The
        // scratch materialization is cleaned up by the dispatch flow
        // (its concern), but the pool's bees/<name>/manifest.json entry
        // is removed here so the index reflects reality on next read.
        if (decision === "destroy") {
          const beeDir = resolveUserBeeDir({ home }, name);
          rmSync(beeDir, { recursive: true, force: true });
          rebuildIndexFromFs({ home });
          return { ok: true, data: { userDestroyed: true, path: beeDir } };
        }
        // User bee retain: open state.db, call retainRelease.
        const version = flags.maybeString("version") ?? "0.1.0";
        const scratchDir = flags.maybeString("scratch") ?? join(home, "scratch");
        if (!existsSync(scratchDir)) return { ok: false, error: "SCRATCH_NOT_FOUND" };
        const stateDbPath = resolveStateDbPath({ home });
        const blobsDir = resolveBlobsDir({ home });
        mkdirSync(blobsDir, { recursive: true });
        const db = openStateDb(stateDbPath);
        try {
          retainRelease({ db, blobsDir, scratchDir, manifest: m, version });
        } finally {
          db.close();
        }
        return { ok: true, data: { retained: true, version } };
      }
      case "releases": {
        const beeName = positional[1];
        if (!beeName) return { ok: false, error: "MISSING_ARG: releases requires <bee-name>" };
        const stateDbPath = resolveStateDbPath({ home });
        const db = openStateDb(stateDbPath);
        try {
          const rows = db
            .prepare(
              "SELECT id, bee_name, version, source, archived_at, archived_by FROM bee_release WHERE bee_name = ? ORDER BY archived_at DESC"
            )
            .all(beeName) as Array<{
              id: number;
              bee_name: string;
              version: string;
              source: string;
              archived_at: string;
              archived_by: string;
            }>;
          return { ok: true, data: rows };
        } finally {
          db.close();
        }
      }
      case "release-show": {
        const beeName = positional[1];
        const version = flags.maybeString("version") ?? "";
        if (!beeName || !version) {
          return { ok: false, error: "MISSING_ARG: release-show requires <bee-name> and --version" };
        }
        const stateDbPath = resolveStateDbPath({ home });
        const db = openStateDb(stateDbPath);
        try {
          const row = db
            .prepare("SELECT * FROM bee_release WHERE bee_name = ? AND version = ?")
            .get(beeName, version) as Record<string, unknown> | undefined;
          if (!row) return { ok: false, error: "VERSION_NOT_FOUND" };
          const id = row.id as number;
          const manifest = db
            .prepare("SELECT * FROM bee_manifest WHERE release_id = ?")
            .get(id);
          const segments = db
            .prepare("SELECT * FROM bee_segment_ref WHERE release_id = ?")
            .all(id);
          const files = db
            .prepare("SELECT * FROM bee_file WHERE release_id = ?")
            .all(id);
          return { ok: true, data: { release: row, manifest, segments, files } };
        } finally {
          db.close();
        }
      }
      case "release-diff": {
        const beeName = positional[1];
        const fromVersion = flags.maybeString("from") ?? "";
        const toVersion = flags.maybeString("to") ?? "";
        if (!beeName || !fromVersion || !toVersion) {
          return { ok: false, error: "MISSING_ARG: release-diff requires <bee-name> and --from and --to" };
        }
        const stateDbPath = resolveStateDbPath({ home });
        const db = openStateDb(stateDbPath);
        try {
          const diff = releaseDiff({ db, beeName, fromVersion, toVersion });
          return { ok: true, data: diff };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        } finally {
          db.close();
        }
      }
      // --- Task 15d verbs ---
      case "export": {
        const beeName = positional[1];
        const version = flags.maybeString("version") ?? "";
        const outPath = flags.maybeString("out") ?? "";
        if (!beeName || !version || !outPath) {
          return { ok: false, error: "MISSING_ARG: export requires <bee-name>, --version, --out" };
        }
        const stateDbPath = resolveStateDbPath({ home });
        const blobsDir = resolveBlobsDir({ home });
        const db = openStateDb(stateDbPath);
        try {
          exportRelease({ db, blobsDir, beeName, version, outPath });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        } finally {
          db.close();
        }
        return { ok: true, data: { outPath } };
      }
      case "import": {
        const bundlePath = positional[1];
        const asNameRaw = flags.maybeString("as");
        const asName = asNameRaw && asNameRaw.length > 0 ? asNameRaw : undefined;
        if (!bundlePath) return { ok: false, error: "MISSING_ARG: import requires <bundle-path>" };
        if (!existsSync(bundlePath)) return { ok: false, error: "BUNDLE_NOT_FOUND" };
        const stateDbPath = resolveStateDbPath({ home });
        const blobsDir = resolveBlobsDir({ home });
        mkdirSync(blobsDir, { recursive: true });
        const db = openStateDb(stateDbPath);
        try {
          if (asName !== undefined) {
            importRelease({ db, blobsDir, inPath: bundlePath, asName });
          } else {
            importRelease({ db, blobsDir, inPath: bundlePath });
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        } finally {
          db.close();
        }
        return { ok: true, data: { asName: asName ?? basename(bundlePath) } };
      }
      case "gc-blobs": {
        const dryRun = flags.bool("dry-run");
        const stateDbPath = resolveStateDbPath({ home });
        const blobsDir = resolveBlobsDir({ home });
        const db = openStateDb(stateDbPath);
        try {
          const removed = gcBlobs({ db, blobsDir, dryRun });
          return { ok: true, data: { removed } };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        } finally {
          db.close();
        }
      }
      case "search": {
        const query = positional[1] ?? flags.maybeString("q") ?? "";
        if (!query) return { ok: false, error: "MISSING_ARG: search requires <query>" };
        const beesDir = resolveUserBeesDir({ home });
        const matches: Array<Record<string, unknown>> = [];
        const warnings: string[] = [];
        if (existsSync(beesDir)) {
          const q = query.toLowerCase();
          for (const name of readdirSync(beesDir)) {
            const manifestPath = join(beesDir, name, "manifest.json");
            if (!existsSync(manifestPath)) continue;
            let m: {
              name?: string;
              description?: string;
              source?: string;
              promotion_status?: string;
            };
            try {
              m = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
                name?: string;
                description?: string;
                source?: string;
                promotion_status?: string;
              };
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              warnings.push(`skipped ${name}: ${msg}`);
              continue;
            }
            const haystack = `${m.name ?? ""} ${m.description ?? ""}`.toLowerCase();
            if (haystack.includes(q)) {
              matches.push({
                name: m.name,
                description: m.description,
                source: m.source,
                promotion_status: m.promotion_status,
              });
            }
          }
        }
        return { ok: true, data: { matches, warnings } };
      }
      case "recent": {
        const sinceRaw = flags.maybeString("since") ?? "7d";
        const m = sinceRaw.match(/^(\d+)d$/);
        if (!m) return { ok: false, error: "MISSING_ARG: recent requires --since Nd (e.g. 7d)" };
        const sinceDays = parseInt(m[1]!, 10);
        const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
        const beesDir = resolveUserBeesDir({ home });
        const matches: Array<Record<string, unknown>> = [];
        const warnings: string[] = [];
        if (existsSync(beesDir)) {
          for (const name of readdirSync(beesDir)) {
            const manifestPath = join(beesDir, name, "manifest.json");
            if (!existsSync(manifestPath)) continue;
            let b: {
              name?: string;
              lastTouchedAt?: string;
              promotion_status?: string;
            };
            try {
              b = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
                name?: string;
                lastTouchedAt?: string;
                promotion_status?: string;
              };
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              warnings.push(`skipped ${name}: ${msg}`);
              continue;
            }
            if (typeof b.lastTouchedAt === "string" && b.lastTouchedAt >= cutoff) {
              matches.push({
                name: b.name,
                lastTouchedAt: b.lastTouchedAt,
                promotion_status: b.promotion_status,
              });
            }
          }
        }
        return { ok: true, data: { matches, warnings } };
      }
      case "show": {
        const name = positional[1];
        if (!name) return { ok: false, error: "MISSING_ARG: show requires <name>" };
        const manifestPath = join(resolveUserBeesDir({ home }), name, "manifest.json");
        if (!existsSync(manifestPath)) return { ok: false, error: "BEE_NOT_FOUND" };
        try {
          return { ok: true, data: JSON.parse(readFileSync(manifestPath, "utf-8")) };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: `MANIFEST_CORRUPT: ${msg}` };
        }
      }
      default:
        return { ok: false, error: `UNKNOWN_VERB: ${verb ?? ""}` };
    }
  } catch (e: unknown) {
    if (e instanceof SYSTEM_PATH_FORBIDDEN) {
      return { ok: false, error: e.message };
    }
    const msg =
      e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
    return { ok: false, error: msg };
  }
}

/** Resolve the `peaks skill` parent command from the program tree,
 *  creating it lazily when program.ts hasn't already registered
 *  the skill command (matches the pattern in
 *  src/cli/commands/workflow-plan-commands.ts:179).
 *
 *  Ordering note (T15a.1 future-proofing): `program.command("skill")` lazily
 *  registers a Command with description "Manage Peaks skills". If a future
 *  slice adds another `peaks skill <sub>` command (e.g. `peaks skill list`),
 *  it MUST be registered BEFORE sediment/adapter commands so that the first
 *  registration wins and the description is consistent. Today only sediment
 *  exists, so the lazy lookup is safe.
 */
function getOrCreateSkillCmd(program: Command): Command {
  const existing = program.commands.find((c) => c.name() === "skill");
  if (existing !== undefined) return existing;
  return program.command("skill").description("Manage Peaks skills");
}

/** Register the `peaks skill sediment <verb>` subcommand group.
 *
 *  Task 15a wired 4 verbs; Task 15b adds 4 more (refine-bee / clone-bee /
 *  promote / retire). The subcommand accepts variadic args so caller-side
 *  code (peaks-cli action handler) can re-dispatch to `runSediment` for
 *  the actual verb routing. Subsequent tasks (15c / 15d) will add the
 *  remaining 10 verbs by extending the `runSediment` switch statement.
 */
export function registerSedimentCommands(program: Command, io: ProgramIO): void {
  const skill = getOrCreateSkillCmd(program);
  skill
    .command("sediment <args...>")
    .description(
      "Sediment pool operations (LLM-coordinated; see peaks-maker skill)"
    )
    .action(async (args: string[]) => {
      const home =
        process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
      const r = await runSediment(args, { home });
      // Delegate the JSON rendering AND the process.exitCode side-effect
      // to the shared CLI shim helper (Critical #1 fix). The library
      // function runSediment itself never mutates process.exitCode —
      // it just returns { ok, error? } — so non-CLI callers (vitest,
      // programmatic dispatch) can re-use it without leaking an exit
      // code into the host process.
      printCliEnvelope(io, r);
    });
}
