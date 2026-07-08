/**
 * peaks skill search — service-layer primitive for S0 of the
 * 4.0.0-beta.5 peaks-solo dispatcher release.
 *
 * Spec: docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
 * Plan: docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s0-skill-search-cli.md
 *
 * This service is the single source of truth for skill pool retrieval
 * and is reused by the `peaks skill search` CLI. It is intentionally
 * pure (synchronous frontmatter parse + substring scoring) so the
 * dispatcher (`peaks-solo`, S1) can call it without paying for any
 * async I/O during the triage decision flow.
 *
 * v1 scope (locked, see plan §"Match rules (v1)"):
 *   - --query: case-insensitive substring match on description + triggers
 *   - --tag:   case-insensitive exact match on `metadata.tags`
 *   - --domain: exact match on `metadata.domain` (locked enum)
 *   - All three compose with AND; at least one filter is required
 *   - No match → `[]` (not error, not null)
 *   - --limit truncates to the top N by matchScore desc
 *
 * Out of v1 scope (deferred, see plan §"Goal"): fuzzy / FTS5 / semantic
 * matching, ML-based ranking, pagination, i18n, caching.
 */
import { z } from 'zod';
import { listSkills } from '../skills/skill-registry.js';
import { parseFrontmatter } from '../../shared/frontmatter.js';
import { readText } from '../../shared/fs.js';
import { skillsDir } from '../../shared/paths.js';

const SKILL_DOMAINS = [
  'code',
  'content',
  'doctor',
  'research',
  'triage',
  'sop',
  'audit',
  'final-review',
  'resume',
  'status',
  'test',
  'ide',
  'slice-decompose',
  'issue-fix-orchestrator',
  'perf-audit',
  'security-audit',
  'reviewer'
] as const;

export const SkillSearchInputSchema = z
  .object({
    query: z.string().min(1).max(500).optional(),
    tag: z.string().min(1).max(100).optional(),
    domain: z.enum(SKILL_DOMAINS).optional(),
    limit: z.number().int().min(1).max(100).optional().default(20)
  })
  .refine(
    (v) => v.query !== undefined || v.tag !== undefined || v.domain !== undefined,
    { message: 'At least one of --query / --tag / --domain is required' }
  );

export type SkillSearchInput = z.input<typeof SkillSearchInputSchema>;

export const SkillSearchResultSchema = z.object({
  name: z.string(),
  description: z.string(),
  triggers: z.array(z.string()),
  tags: z.array(z.string()),
  domain: z.string(),
  matchScore: z.number().min(0).max(1)
});

export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>;

type EnrichedSkill = {
  name: string;
  description: string;
  triggers: string[];
  tags: string[];
  domain: string;
  skillPath: string;
};

/**
 * Extract trigger phrases from a skill description. The convention is
 * `Triggers on \`/x\`, "y", "z".` at the end of the description
 * (or anywhere within). v1 parses quoted/back-tick tokens after the
 * "Triggers on" marker. When the marker is missing, the trigger set
 * is empty (description-only matching still works).
 */
function extractTriggers(description: string): string[] {
  const lower = description.toLowerCase();
  const marker = 'triggers on';
  const idx = lower.indexOf(marker);
  if (idx === -1) return [];
  const after = description.slice(idx + marker.length);
  // Stop at the first period that ends the trigger clause.
  // Heuristic: take everything up to the next `.` that is followed by
  // whitespace + capital letter, or end-of-string.
  const stopMatch = /\.\s+[A-Z]|\.\s*$/.exec(after);
  const clause = stopMatch ? after.slice(0, stopMatch.index + 1) : after;
  // Extract every quoted/back-tick token.
  const tokenRegex = /[`"']([^`"']+)[`"']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(clause)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Parse metadata tags / domain from the raw SKILL.md frontmatter.
 * `parseFrontmatter()` flattens nested YAML mapping into dotted keys,
 * so `metadata.tags: a, b` becomes a single string we split on `, `.
 * The existing `skill-registry` already calls `parseFrontmatter` but
 * does not surface the metadata block, so we re-parse the file.
 *
 * R8 mitigation: if the file is missing, malformed, or unreadable we
 * return empty tags + domain so the search itself can still proceed
 * with description-only matching. The malformed-file warning is
 * already emitted by the registry layer (`loadSkillRegistry`'s
 * `failures[]` channel); this function is best-effort metadata.
 */
async function parseMetadata(skillPath: string): Promise<{ tags: string[]; domain: string }> {
  try {
    const raw = await readText(skillPath);
    const fm = parseFrontmatter(raw) as Record<string, string>;
    const tagsRaw = fm['metadata.tags'] ?? '';
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const domain = (fm['metadata.domain'] ?? '').trim();
    return { tags, domain };
  } catch {
    return { tags: [], domain: '' };
  }
}

async function loadEnrichedSkills(): Promise<EnrichedSkill[]> {
  const skills = await listSkills();
  return Promise.all(
    skills.map(async (s) => {
      const meta = await parseMetadata(s.skillPath);
      return {
        name: s.name,
        description: s.description,
        triggers: extractTriggers(s.description),
        tags: meta.tags,
        domain: meta.domain,
        skillPath: s.skillPath
      };
    })
  );
}

/**
 * Substring match score for a single (skill, query) pair.
 *
 * matchScore = 0.5 * (query_hits_in_description / description_length_words)
 *            + 0.5 * (query_hits_in_triggers / triggers_count)
 *            clamped to [0, 1]
 *
 * "hits" = number of occurrences of the query substring (lowercased)
 * in the lowercased target. Length is normalized as word count (so a
 * 1-word description that matches returns the full 0.5 contribution).
 */
function scoreQuery(
  query: string,
  description: string,
  triggers: string[]
): number {
  const q = query.toLowerCase();
  const desc = description.toLowerCase();
  const descHits = countOccurrences(desc, q);
  const descWords = Math.max(1, desc.split(/\s+/).filter((w) => w.length > 0).length);
  const descContribution = Math.min(1, descHits / descWords);

  const triggersJoined = triggers.map((t) => t.toLowerCase()).join(' | ');
  const trigHits = countOccurrences(triggersJoined, q);
  const trigCount = Math.max(1, triggers.length);
  const trigContribution = Math.min(1, trigHits / trigCount);

  const raw = 0.5 * descContribution + 0.5 * trigContribution;
  // Clamp to [0, 1] and round to 4 decimals to keep envelope tidy.
  return Math.round(Math.max(0, Math.min(1, raw)) * 10_000) / 10_000;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length) {
    const next = haystack.indexOf(needle, pos);
    if (next === -1) break;
    count += 1;
    pos = next + needle.length;
  }
  return count;
}

/**
 * Search the in-tree skill pool. Validates `input` against
 * `SkillSearchInputSchema`; the schema's refine rejects empty input
 * with a ZodError, which is the contract test U-7 / I-3 rely on.
 *
 * @param input  One of `query | tag | domain` is required.
 *               All provided filters compose with AND.
 * @returns      Matching skills sorted by matchScore desc, name asc.
 *               Empty array (not error, not null) when nothing matches.
 */
export async function searchSkills(rawInput: SkillSearchInput): Promise<SkillSearchResult[]> {
  const input = SkillSearchInputSchema.parse(rawInput);
  const skills = await loadEnrichedSkills();

  const filtered = skills.filter((skill) => {
    if (input.tag !== undefined) {
      const wanted = input.tag.toLowerCase();
      const has = skill.tags.some((t) => t.toLowerCase() === wanted);
      if (!has) return false;
    }
    if (input.domain !== undefined) {
      if (skill.domain.toLowerCase() !== input.domain.toLowerCase()) return false;
    }
    if (input.query !== undefined) {
      const q = input.query.toLowerCase();
      const inDesc = skill.description.toLowerCase().includes(q);
      const inTrig = skill.triggers.some((t) => t.toLowerCase().includes(q));
      if (!inDesc && !inTrig) return false;
    }
    return true;
  });

  const scored = filtered.map<SkillSearchResult>((skill) => ({
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    tags: skill.tags,
    domain: skill.domain,
    matchScore:
      input.query !== undefined
        ? scoreQuery(input.query, skill.description, skill.triggers)
        : 1
  }));

  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.name.localeCompare(b.name);
  });

  return scored.slice(0, input.limit);
}

// Re-export `skillsDir` only for tests that want to assert on-disk I/O
// behavior end-to-end. Not part of the public CLI surface.
export { skillsDir as __skillsDirForTests };
