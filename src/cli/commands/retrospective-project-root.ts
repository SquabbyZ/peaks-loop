/**
 * Project-root resolution shared by the three `peaks retrospective`
 * subcommands — hoisted VERBATIM from `retrospective-commands.ts`, where
 * the same four-line expression was written out three times (search,
 * index, show). Same branch order, same predicates: an explicit
 * `--project` is canonicalised, otherwise the discovered project root,
 * otherwise cwd.
 */

import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';

export function resolveRetrospectiveProjectRoot(project: string | undefined): string {
  return project !== undefined
    ? resolveCanonicalProjectRoot(project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}
