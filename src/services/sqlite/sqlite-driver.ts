/**
 * The SQLite driver seam for every store in this CLI.
 *
 * WHY A SEAM AT ALL. `better-sqlite3` is a native addon: a consumer either got a prebuilt
 * binary matching their exact Node ABI or they needed a C++ toolchain, and the failure was
 * discovered at runtime, not at install. Node ships `node:sqlite`, so the stores do not
 * need that requirement. But the two are NOT the same library — the three places they
 * genuinely differ are the whole reason this file exists, and each is a behaviour, not an
 * import path:
 *
 *   - **there is no `pragma()`.** `exec('PRAGMA …')` sets a pragma but returns nothing, so
 *     reading one back needs a statement (`pragmaValue`). A pragma that is silently not
 *     applied is worse than no pragma: `foreign_keys = ON` is what makes the skillhub
 *     schema's REFERENCES clauses mean anything.
 *   - **`BEGIN` inside a transaction throws.** better-sqlite3's `db.transaction(fn)` nests
 *     with SAVEPOINTs for free, so a store whose body called another store's body worked.
 *     Here nesting is explicit and counted, and the inner unit rolls back on its own.
 *   - **a read-only open must not create the file.** `codegraph-index-integrity` opens the
 *     index read-only; an empty database created by the open is indistinguishable from an
 *     index with no rows, and the staleness gate would report a clean graph for a project
 *     that was never indexed.
 *   - **`foreign_keys` is ON by default here and was OFF in better-sqlite3.** Measured on
 *     Node 24.21 (`PRAGMA foreign_keys` answers 1 on a fresh database). The stores that
 *     asked for it are unaffected; a site that never asked — the capability guard's
 *     `:memory:` probe — gains enforcement, so write order that used to work can start
 *     throwing. That is why the call sites keep saying the pragma out loud.
 *
 * WHAT THIS IS NOT. It is not an ORM and not a query builder: statements stay at the call
 * sites, and `prepare`/`run`/`get`/`all`/`exec`/`close` are node:sqlite's own. Only the
 * three behaviours above are wrapped, because those are the ones a port gets wrong quietly.
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** The database handle the stores hold. Exported so call sites stop naming the addon. */
export type SqliteDatabase = DatabaseSync;

export type OpenSqliteOptions = {
  /**
   * Open without creating. A missing file is an error, not an empty database — the
   * read-only caller's question is "what does the existing index say", and an empty
   * database answers that in the most misleading way available.
   */
  readonly readOnly?: boolean;
};

/**
 * Open (or create) the SQLite file at `path`.
 *
 * `readOnly` on a path that does not exist throws here rather than producing a handle over
 * a freshly created empty file — see the option.
 */
export function openSqlite(path: string, options: OpenSqliteOptions = {}): SqliteDatabase {
  const readOnly = options.readOnly === true;
  if (readOnly && !existsSync(path)) {
    throw new Error(`no such file (opened read-only): ${path}`);
  }
  return new DatabaseSync(path, { readOnly });
}

/**
 * Apply each `PRAGMA` setting, in order.
 *
 * A `;` is refused rather than passed through: these strings are literals today, and the
 * shape that would hurt is a future caller interpolating a name into one and landing a
 * second statement inside a single `exec`.
 */
export function applyPragmas(db: SqliteDatabase, pragmas: readonly string[]): void {
  for (const pragma of pragmas) {
    if (pragma.includes(';')) {
      throw new Error(`a pragma must be one statement, got: ${pragma}`);
    }
    db.exec(`PRAGMA ${pragma}`);
  }
}

/**
 * Read one `PRAGMA` back.
 *
 * `journal_mode` answers with a row keyed `journal_mode`; `foreign_keys` answers with a
 * row keyed `foreign_keys`. Both come back as the FIRST column, whatever the name, so that
 * is what this returns.
 */
export function pragmaValue(db: SqliteDatabase, name: string): unknown {
  if (name.includes(';')) {
    throw new Error(`a pragma name must be one statement, got: ${name}`);
  }
  const row = db.prepare(`PRAGMA ${name}`).get();
  if (row === undefined) return undefined;
  const values = Object.values(row);
  return values[0];
}

/** The depth of open transactions per handle, so nesting is counted, not guessed. */
const transactionDepth = new WeakMap<SqliteDatabase, number>();

/**
 * Run `body` as ONE unit of work: commit if it returns, roll back everything it wrote if
 * it throws, and let the error continue.
 *
 * Nesting is by SAVEPOINT, which is what `db.transaction(fn)` did in better-sqlite3: an
 * inner unit that fails undoes only itself, and an outer unit that fails undoes both. The
 * alternative — a bare `BEGIN` — throws the moment one store body calls another, which is
 * the least-tested path in the product and the reason this function is not five lines.
 */
export function withTransaction<T>(db: SqliteDatabase, body: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  transactionDepth.set(db, depth + 1);
  const savepoint = `peaks_sp_${String(depth + 1)}`;
  if (depth === 0) {
    db.exec('BEGIN');
  } else {
    db.exec(`SAVEPOINT ${savepoint}`);
  }
  try {
    const result = body();
    if (depth === 0) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE ${savepoint}`);
    }
    return result;
  } catch (error) {
    if (depth === 0) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    }
    throw error;
  } finally {
    transactionDepth.set(db, depth);
  }
}
