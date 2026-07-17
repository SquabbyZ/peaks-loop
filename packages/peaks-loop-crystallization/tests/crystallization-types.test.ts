import { describe, expect, it } from "vitest";
import {
  EvidenceBriefSchema,
  CrystallizationEventSchema,
  parseEvidenceBrief,
  parseCrystallizationEvent,
  safeParseEvidenceBrief,
  safeParseCrystallizationEvent,
  hasAllFourBriefSections,
  type EvidenceBrief,
} from "../src/index.js";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function makeBrief(overrides: Partial<EvidenceBrief> = {}): EvidenceBrief {
  return EvidenceBriefSchema.parse({
    what_happened: "We shipped the v4 sediment pool.",
    why_it_matters: "Users can now keep their work as reuse-ready assets.",
    what_learned: "Count-only evidence was not enough; brief-first framing works.",
    what_action: "Promote this run to a stable loop after 2 cycles.",
    ...overrides,
  }) as EvidenceBrief;
}

/* ---------------------------------------------------------------------- */
/* EvidenceBrief — 4-section guard (AC-15 / AC-16)                       */
/* ---------------------------------------------------------------------- */

describe("EvidenceBrief — 4-section guard", () => {
  it("accepts a complete brief (all 4 sections)", () => {
    const brief = makeBrief();
    expect(brief.what_happened).toMatch(/shipped/);
    expect(hasAllFourBriefSections(brief)).toBe(true);
  });

  it("rejects a brief missing what_happened", () => {
    const r = safeParseEvidenceBrief({
      why_it_matters: "x",
      what_learned: "x",
      what_action: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISSING_BRIEF_SECTION");
  });

  it("rejects a brief missing why_it_matters", () => {
    const r = safeParseEvidenceBrief({
      what_happened: "x",
      what_learned: "x",
      what_action: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISSING_BRIEF_SECTION");
  });

  it("rejects a brief missing what_learned", () => {
    const r = safeParseEvidenceBrief({
      what_happened: "x",
      why_it_matters: "x",
      what_action: "x",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a brief missing what_action", () => {
    const r = safeParseEvidenceBrief({
      what_happened: "x",
      why_it_matters: "x",
      what_learned: "x",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a brief with an empty section (whitespace only)", () => {
    const r = safeParseEvidenceBrief({
      what_happened: "x",
      why_it_matters: "x",
      what_learned: "x",
      what_action: "    ",
    });
    expect(r.ok).toBe(false);
  });

  it("parses a complete brief via parseEvidenceBrief", () => {
    const brief = parseEvidenceBrief({
      what_happened: "a",
      why_it_matters: "b",
      what_learned: "c",
      what_action: "d",
    });
    expect(hasAllFourBriefSections(brief)).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* CrystallizationEvent — full row parse                                  */
/* ---------------------------------------------------------------------- */

describe("CrystallizationEvent — full row parse", () => {
  const baseEvent = {
    id: "crys-deadbeef0001",
    trigger: "user_explicit" as const,
    evidence_brief: makeBrief(),
    evidence_bullets: ["3 phases", "2 gates"],
    source_trace_pointers: ["trace-1"],
    evaluator_summary: "scorer says ok",
    user_decision_summary: "user picked create",
    created_loop_release_id: "loop-1",
    created_bee_release_id: 7,
    lifecycle_status: "candidate" as const,
    schema_version: "peaks.crystallization/1" as const,
    created_at: "2026-07-07T00:00:00.000Z",
  };

  it("parses a complete event", () => {
    const row = parseCrystallizationEvent(baseEvent);
    expect(row.id).toBe("crys-deadbeef0001");
    expect(row.evidence_brief.what_action).toMatch(/Promote/);
    expect(row.schema_version).toBe("peaks.crystallization/1");
  });

  it("rejects an event whose brief is missing a section", () => {
    const tampered = {
      ...baseEvent,
      evidence_brief: {
        what_happened: "x",
        why_it_matters: "x",
        what_learned: "x",
        // what_action intentionally missing
      },
    };
    const r = safeParseCrystallizationEvent(tampered);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISSING_BRIEF_SECTION");
  });

  it("rejects an event with an unknown trigger", () => {
    const tampered = { ...baseEvent, trigger: "magic" as unknown as "user_explicit" };
    expect(() => parseCrystallizationEvent(tampered)).toThrow();
  });

  it("rejects an event with an invalid id format", () => {
    const tampered = { ...baseEvent, id: "bad-id" };
    expect(() => parseCrystallizationEvent(tampered)).toThrow();
  });

  it("accepts the crystallize row with default lifecycle_status='candidate'", () => {
    const raw = CrystallizationEventSchema.parse({
      ...baseEvent,
      lifecycle_status: undefined,
    });
    expect(raw.lifecycle_status).toBe("candidate");
  });

  it("rejects the row when schema_version is not the literal", () => {
    const tampered = {
      ...baseEvent,
      schema_version: "peaks.crystallization/2" as unknown as "peaks.crystallization/1",
    };
    expect(() => parseCrystallizationEvent(tampered)).toThrow();
  });
});

/* ---------------------------------------------------------------------- */
/* CrystallizationEventSchema — schema_version default                    */
/* ---------------------------------------------------------------------- */

describe("CrystallizationEventSchema — defaults", () => {
  it("schema_version is pinned to peaks.crystallization/1", () => {
    const row = CrystallizationEventSchema.parse({
      id: "crys-12345678abcd",
      trigger: "llm_suggested",
      evidence_brief: makeBrief(),
      created_at: "2026-07-07T00:00:00.000Z",
    });
    expect(row.schema_version).toBe("peaks.crystallization/1");
  });
});
