/**
 * Runtime schemas for the on-disk session files.
 *
 * WHY THIS EXISTS (S12, 2026-09-20). Six readers across `session-manager.ts`
 * and `session-binding-bridge.ts` did `JSON.parse(readFileSync(path, 'utf8'))`
 * and then hand-rolled `typeof data.sessionId === 'string'` checks before
 * asserting the result with `as SessionInfo` / `as SessionMeta`. Because
 * `JSON.parse` returns `any`, the hand-rolled check could only ever cover the
 * one or two fields it happened to name, and the assertion claimed the rest —
 * an unchecked cast sitting on top of a partial check. Those sites are part of
 * the R1 root at the S12 census.
 *
 * The schemas below are the same checks, made total: every field the return
 * type promises is now checked, so the callers return the parsed value
 * directly and the `as` casts are gone. The check is STRICTER than it was —
 * that is the point, and it is stated here rather than discovered later. A
 * file that lacks `createdAt` or `projectRoot` used to be handed back typed as
 * `SessionInfo`; it now reads as `null`, which is what the readers do with
 * every other unusable file.
 *
 * THREE schemas, layered, because three different readers check three
 * different things. Each one validates EXACTLY the fields its reader relies
 * on and nothing more — a schema that demanded more than the code checks
 * would be a new requirement smuggled in under a type, and it would show up
 * as passing tests having to be rewritten. It did, during S12: requiring
 * `createdAt` in the project-level binding schema broke five statusline tests
 * that seed `{ sessionId, projectRoot }`, and no consumer reads `createdAt`
 * from that reader. That finding is why this file has three schemas.
 */
import { z } from 'zod';

/**
 * The minimum a reader needs to LOCATE a session: a non-empty id. Equivalent
 * to the `typeof data.sessionId === 'string' && data.sessionId.length > 0`
 * check it replaces.
 */
export const SessionIdentitySchema = z.looseObject({
  sessionId: z.string().min(1)
});

/**
 * What the project-level binding readers (`readSessionFile` /
 * `readSessionFileCanonical`, in both `session-manager.ts` and
 * `session-binding-bridge.ts`) actually use: the id, and the `projectRoot`
 * they compare against the caller. Equivalent to the
 * `data.sessionId && typeof data.projectRoot === 'string'` check it replaces.
 */
export const SessionBindingSchema = z.looseObject({
  sessionId: z.string().min(1),
  projectRoot: z.string()
});

/**
 * The full session record, as written by `writeSessionFile` (`.peaks/_runtime/
 * session.json`) and `setSessionMeta` (`.peaks/_runtime/<sid>/session.json`).
 * This is the shape the META readers promise a caller (`SessionMeta` requires
 * `createdAt` and `projectRoot`); the optional fields are `SessionMeta`'s own.
 * `looseObject` preserves any further key the file carries, so a reader still
 * sees everything on disk.
 */
export const SessionFileSchema = z.looseObject({
  sessionId: z.string().min(1),
  createdAt: z.string(),
  projectRoot: z.string(),
  title: z.string().optional(),
  skill: z.string().optional(),
  mode: z.string().optional(),
  gate: z.string().optional(),
  lastActivity: z.string().optional(),
  outerSessionId: z.string().optional()
});

/** What the project-level binding readers hand back: validated, and nothing more. */
export type SessionBinding = z.infer<typeof SessionBindingSchema>;
