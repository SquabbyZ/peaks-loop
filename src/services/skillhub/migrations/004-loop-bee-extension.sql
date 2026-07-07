-- 004-loop-bee-extension.sql — M3 / spec §4.1 / §4.2 / §7A
-- Adds the share / desktop extension fields to `loop_release` and
-- `bee_release`. The migration is non-breaking: every new column has
-- a DEFAULT, so existing 4.x rows continue to read cleanly with the
-- spec values applied. M3 writes the SCHEMA only — `shareable=false`
-- is NOT enforced anywhere yet; full export / desktop enforcement
-- lands in M7 (see plan m3-bee-release-extension.md).
--
-- AC-3: this migration does NOT modify any pre-existing `bee_release`
-- column. The only changes to `bee_release` are two new columns
-- appended at the end of the table:
--
--   - shareable         BOOLEAN  (default true)
--   - desktop_visible   BOOLEAN  (default true)
--
-- All other 4.x `bee_release` columns keep their definitions from
-- 001-initial.sql.
--
-- For `loop_release` we add four new columns:
--
--   - shareable              BOOLEAN  (default true)
--   - share_excluded_paths   TEXT     (default '[]'  — JSON array)
--   - desktop_visible        BOOLEAN  (default true)
--   - export_bundle_format   TEXT     (default 'peaks.bundle/1')
--
-- Notes on the column choices:
--   - share_excluded_paths is TEXT (JSON-encoded array). Matches the
--     existing `loop_release` style (success_criteria_json, etc.);
--     parsing happens at the store / Zod boundary, not at SQLite.
--   - export_bundle_format is a TEXT constant. The CHECK constraint
--     below pins the column to 'peaks.bundle/1' — there is no other
--     valid value in this schema version. M7 may relax this when a
--     v2 format lands; until then the constant is hard-pinned.
--   - DEFAULT 1 / 0 covers both columns for SQLite (no native
--     BOOLEAN — the JS layer normalizes to boolean on read).
--   - The CHECK constraints on `shareable` and `desktop_visible`
--     accept only 0/1 (SQLite's BOOLEAN idiom). The Zod schema on
--     read coerces 0/1 to true/false.
--
-- Defense in depth: defaults are set both here (storage) and in the
-- Zod schema (parse boundary) so an in-memory object created from a
-- pre-M3 snapshot still parses after the migration runs.

ALTER TABLE loop_release
  ADD COLUMN shareable INTEGER NOT NULL DEFAULT 1
    CHECK (shareable IN (0, 1));

ALTER TABLE loop_release
  ADD COLUMN share_excluded_paths TEXT NOT NULL DEFAULT '[]';

ALTER TABLE loop_release
  ADD COLUMN desktop_visible INTEGER NOT NULL DEFAULT 1
    CHECK (desktop_visible IN (0, 1));

ALTER TABLE loop_release
  ADD COLUMN export_bundle_format TEXT NOT NULL DEFAULT 'peaks.bundle/1'
    CHECK (export_bundle_format = 'peaks.bundle/1');

ALTER TABLE bee_release
  ADD COLUMN shareable INTEGER NOT NULL DEFAULT 1
    CHECK (shareable IN (0, 1));

ALTER TABLE bee_release
  ADD COLUMN desktop_visible INTEGER NOT NULL DEFAULT 1
    CHECK (desktop_visible IN (0, 1));
