import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "./_cli-helper.js";

// In-process CLI invocation (see tests/integration/_cli-helper.ts).
// Replaces the previous `execFileSync(TSX, ...)` spawn which became
// the dominant cost under vitest single-fork full-suite execution
// on Windows (`Test timed out in 120000ms` for the propose/evaluate
// path despite per-test runs completing in <1s).

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "peaks-evolution-cli-"));
}

function cli(args: string[], cwd: string) {
  return runCli(args, cwd);
}

function extractProposalId(stdout: string): string {
  const out = JSON.parse(stdout);
  if (!out.ok) throw new Error("propose returned ok=false: " + stdout);
  return out.data.proposal.id as string;
}

describe("peaks evolution CLI integration", () => {
  test("propose / status / revert happy path", async () => {
    const project = makeProject();
    try {
      const proposeResult = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "agent-1",
          "--json",
        ],
        project
      );
      expect(proposeResult.code).toBe(0);
      const proposalId = extractProposalId(proposeResult.stdout);
      expect(proposalId).toMatch(/^eval-[0-9a-f]{12}$/);

      const statusResult = await cli(
        ["evolution", "status", "--target", "loop:loop-1", "--json"],
        project
      );
      expect(statusResult.code).toBe(0);
      const statusOut = JSON.parse(statusResult.stdout);
      expect(statusOut.ok).toBe(true);
      expect(statusOut.data.target_kind).toBe("loop");
      expect(statusOut.data.target_release_id).toBe("loop-1");
      expect(statusOut.data.total).toBe(1);
      expect(statusOut.data.byVerdict["needs-user-decision"]).toBe(1);

      const revertResult = await cli(
        [
          "evolution", "revert",
          "--proposal", proposalId,
          "--user-confirmation", "user-pick-revert",
          "--json",
        ],
        project
      );
      expect(revertResult.code).toBe(0);
      const revertOut = JSON.parse(revertResult.stdout);
      expect(revertOut.ok).toBe(true);
      expect(revertOut.data.verdict).toBe("revert");
      expect(revertOut.data.user_confirmation_pointer).toBe("user-pick-revert");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("evaluate path: auto-derives verdict='keep' when delta >= delta_min", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      const evalResult = await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "8",
          "--refute-paragraph", "looks good",
          "--json",
        ],
        project
      );
      expect(evalResult.code).toBe(0);
      const evalOut = JSON.parse(evalResult.stdout);
      expect(evalOut.ok).toBe(true);
      expect(evalOut.data.verdict).toBe("needs-user-decision");
      expect(evalOut.data.score_delta).toBe(3.0);
      expect(evalOut.data.score_delta_min).toBe(1.0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("evaluate path: rejects self-score (AC-10) with EVOLUTION_SELF_SCORE", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      const evalResult = await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "author-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "8",
          "--json",
        ],
        project
      );
      expect(evalResult.code).not.toBe(0);
      const out = JSON.parse(evalResult.stdout);
      expect(out.ok).toBe(false);
      expect(out.code).toBe("EVOLUTION_SELF_SCORE");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("evaluate path: rejects skeptic === evaluator (AC-12/AC-14) with EVOLUTION_SELF_SCORE", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      const evalResult = await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "evaluator-1",
          "--evaluator-score", "8",
          "--json",
        ],
        project
      );
      expect(evalResult.code).not.toBe(0);
      const out = JSON.parse(evalResult.stdout);
      expect(out.ok).toBe(false);
      expect(out.code).toBe("EVOLUTION_SELF_SCORE");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("evaluate path: auto-derives verdict='revert' when score_delta < score_delta_min (AC-11)", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "7",
          "--after-score", "7.5",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      const evalResult = await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "7.5",
          "--json",
        ],
        project
      );
      // verdict='revert' is a non-zero exit (failure).
      expect(evalResult.code).not.toBe(0);
      const out = JSON.parse(evalResult.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.verdict).toBe("revert");
      expect(out.data.score_delta).toBeCloseTo(0.5, 5);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("mark-keep: rejected with EVOLUTION_DELTA_BELOW_THRESHOLD when delta < delta_min (AC-11)", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "7",
          "--after-score", "7.5",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "7.5",
          "--json",
        ],
        project
      );
      const keepResult = await cli(
        [
          "evolution", "mark-keep",
          "--proposal", proposalId,
          "--user-confirmation", "user-pick",
          "--json",
        ],
        project
      );
      expect(keepResult.code).not.toBe(0);
      const out = JSON.parse(keepResult.stdout);
      expect(out.ok).toBe(false);
      expect(out.code).toBe("EVOLUTION_DELTA_BELOW_THRESHOLD");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("mark-keep: requires user_confirmation_pointer (AC-15)", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "8",
          "--json",
        ],
        project
      );
      const keepResult = await cli(
        [
          "evolution", "mark-keep",
          "--proposal", proposalId,
          "--json",
        ],
        project
      );
      expect(keepResult.code).not.toBe(0);
      const out = JSON.parse(keepResult.stdout);
      expect(out.ok).toBe(false);
      expect(out.code).toBe("EVOLUTION_MISSING_USER_CONFIRMATION");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("mark-keep: succeeds when delta >= delta_min and user_confirmation is set", async () => {
    const project = makeProject();
    try {
      const propose = await cli(
        [
          "evolution", "propose",
          "--target", "loop:loop-1",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      const proposalId = extractProposalId(propose.stdout);
      await cli(
        [
          "evolution", "evaluate",
          "--proposal", proposalId,
          "--evaluator", "evaluator-1",
          "--skeptic", "skeptic-1",
          "--evaluator-score", "8",
          "--json",
        ],
        project
      );
      const keepResult = await cli(
        [
          "evolution", "mark-keep",
          "--proposal", proposalId,
          "--user-confirmation", "user-pick-keep",
          "--json",
        ],
        project
      );
      expect(keepResult.code).toBe(0);
      const out = JSON.parse(keepResult.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.verdict).toBe("keep");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("invalid --target flag is rejected with EVOLUTION_INVALID_TARGET", async () => {
    const project = makeProject();
    try {
      const result = await cli(
        [
          "evolution", "propose",
          "--target", "badformat",
          "--dimension", "clarity",
          "--before-score", "5",
          "--after-score", "8",
          "--author", "author-1",
          "--json",
        ],
        project
      );
      expect(result.code).not.toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.ok).toBe(false);
      expect(out.code).toBe("EVOLUTION_INVALID_TARGET");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
