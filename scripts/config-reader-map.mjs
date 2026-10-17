/**
 * scripts/config-reader-map.mjs — the declared import path for the root-config → reader map.
 *
 * WHY THE DEFINITION LIVES IN `test-changed-classify.mjs` RATHER THAN HERE. Seven arms plant a
 * COPY of the classifier in a temp directory and import it (`test-changed-classify`,
 * `test-changed-config-path-triggers`, `test-changed-guard-tier`, `test-changed-git-env`,
 * `test-changed-nul-paths`, `test-changed-nul-e2e`, `tier-prose-carriers`). A relative import INTO
 * the classifier would make every one of those copies fail to resolve, so the classifier is
 * deliberately dependency-free and this file is the surface a reader imports instead.
 *
 * WHAT THE MAP DOES. `classifyChanged` unions the readers into a SUBSET only: a key-only diff
 * still reaches the whole suite through the unmapped backstop. The map WIDENS a subset; it does
 * not create one, and counting these keys as mapped would shrink a key-only diff to a few files.
 *
 * STATUS IS IGNORED for the lookup: a deleted or renamed key changes what its reader asserts just
 * as an edit does, so the reader is selected for any entry naming the key.
 *
 * `.gitattributes` is NOT a key: it has no root reader — the one mention under `tests/**` is a
 * comment, and the staged-parity fixture writes its own temp file — so its git-wide blast radius
 * is a full-suite trigger instead (`FULL_FALLBACK_TRIGGERS`).
 *
 * The map's definition carries a null prototype, because a changed path is untrusted input and
 * `CONFIG_READER_MAP['constructor']` would otherwise resolve up the prototype chain.
 */
export { CONFIG_READER_MAP, configReaderHits } from './test-changed-classify.mjs';
