import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "./_cli-helper.js";

// In-process CLI invocation (see tests/integration/_cli-helper.ts).
// Replaces the previous `execFileSync(TSX, ...)` spawn which became
// the dominant cost under vitest single-fork full-suite execution
// on Windows (`Test timed out in 120000ms` for the crystallize path
// despite per-test runs completing in <2s).

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "peaks-asset-cli-"));
}

function cli(args: string[], cwd: string) {
  return runCli(args, cwd);
}

describe("peaks asset CLI integration — M5", () => {
  test("crystallize end-to-end: writes loop + bee + relation + crystallization_event", async () => {
    const project = makeProject();
    try {
      const result = await cli(
        [
          "asset",
          "crystallize",
          "--from-task",
          "task-1",
          "--loop-id",
          "loop-onboarding",
          "--loop-name",
          "Loop Onboarding",
          "--loop-scenario",
          "Onboard a new contributor to peaks-loop.",
          "--loop-trigger-policy",
          "Match: onboard contributor",
          "--loop-interaction-policy",
          "Human-NL-Choice-Only",
          "--loop-feedback-policy",
          "Brief is NL-primary; counts feed bullets.",
          "--loop-evolution-policy",
          "Darwin-style ratchet.",
          "--loop-success-criterion",
          "row written",
          "--loop-evaluator-policy",
          "independent scorer",
          "--loop-version",
          "0.1.0",
          "--bee-name",
          "bee-onboarding",
          "--bee-version",
          "0.1.0",
          "--bee-description",
          "Main bee for onboarding.",
          "--bee-relation-reason",
          "primary bee",
          "--brief-what-happened",
          "Walked a new contributor through crystallization end-to-end.",
          "--brief-why-it-matters",
          "Without this, contributors cannot land a real change.",
          "--brief-what-learned",
          "4-section brief framing drives explicit user choice.",
          "--brief-what-action",
          "Promote this run to a stable loop after 2 cycles.",
          "--brief-bullet",
          "3 phases",
          "--source-trace",
          "trace-onboarding-1",
          "--evaluator-summary",
          "scorer OK",
          "--user-decision-summary",
          "user picked create",
          "--trigger",
          "user_explicit",
          "--project",
          project,
          "--json",
        ],
        project
      );
      if (result.code !== 0) {
        // Emit the captured streams so the failure is debuggable
        // through the test report.
        // eslint-disable-next-line no-console
        console.error(
          "STDOUT:",
          result.stdout,
          "\nSTDERR:",
          result.stderr,
          "\nCODE:",
          result.code
        );
      }
      expect(result.code).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.recommendation.brief.what_action).toMatch(/Promote/);
      expect(out.data.recommendation.brief.what_happened).toMatch(/Walked/);
      expect(out.data.result.loop_release_id).toBe("loop-onboarding");
      expect(out.data.result.bee_release_id).toBeGreaterThan(0);
      expect(out.data.result.loop_bee_relation_id).toBeGreaterThan(0);
      expect(out.data.result.crystallization_event_id).toMatch(
        /^crys-[0-9a-f]{12}$/
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("crystallize refuses to render a recommendation when a brief section is missing", async () => {
    const project = makeProject();
    try {
      // Every other flag set; only --brief-what-action is missing.
      const result = await cli(
        [
          "asset",
          "crystallize",
          "--from-task",
          "task-1",
          "--loop-id",
          "loop-missing",
          "--loop-name",
          "Loop Missing",
          "--loop-scenario",
          "Scenario.",
          "--loop-trigger-policy",
          "Trigger.",
          "--loop-interaction-policy",
          "Human-NL-Choice-Only",
          "--loop-feedback-policy",
          "Feedback.",
          "--loop-evolution-policy",
          "Evolution.",
          "--loop-success-criterion",
          "criterion-1",
          "--loop-evaluator-policy",
          "evaluator-1",
          "--loop-version",
          "0.1.0",
          "--bee-name",
          "bee-missing",
          "--bee-version",
          "0.1.0",
          "--bee-description",
          "Main bee.",
          "--bee-relation-reason",
          "primary bee",
          "--brief-what-happened",
          "What happened.",
          "--brief-why-it-matters",
          "Why it matters.",
          "--brief-what-learned",
          "What we learned.",
          // --brief-what-action INTENTIONALLY absent.
          "--trigger",
          "user_explicit",
          "--project",
          project,
          "--json",
        ],
        project
      );
      // Reject without proceeding. The CLI rejects EITHER at the
      // commander layer (the --brief-what-action requiredOption
      // fails; the JSON envelope lands on stderr) OR at the
      // service layer (MISSING_BRIEF_SECTION on stdout). Both are
      // valid gates per AC-15 / RL-7; the assertion only verifies
      // the call did NOT succeed.
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined.length).toBeGreaterThan(0);
      // Find the JSON envelope in either stream.
      const jsonMatch = combined.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();
      const out = JSON.parse(jsonMatch![0]);
      expect(out.ok).toBe(false);
      expect(
        out.code === "MISSING_BRIEF_SECTION" ||
          out.code === "UNHANDLED_ERROR"
      ).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("status lists the loop + bee lifecycle after crystallization", async () => {
    const project = makeProject();
    try {
      // First crystallize a loop+bee so status has something to show.
      const crys = await cli(
        [
          "asset",
          "crystallize",
          "--from-task",
          "task-1",
          "--loop-id",
          "loop-status",
          "--loop-name",
          "Loop Status",
          "--loop-scenario",
          "Scenario.",
          "--loop-trigger-policy",
          "Trigger.",
          "--loop-interaction-policy",
          "Human-NL-Choice-Only.",
          "--loop-feedback-policy",
          "Feedback.",
          "--loop-evolution-policy",
          "Evolution.",
          "--loop-success-criterion",
          "c-1",
          "--loop-evaluator-policy",
          "e-1",
          "--loop-version",
          "0.1.0",
          "--bee-name",
          "bee-status",
          "--bee-version",
          "0.1.0",
          "--bee-description",
          "Main bee.",
          "--bee-relation-reason",
          "primary",
          "--brief-what-happened",
          "We did the work.",
          "--brief-why-it-matters",
          "It matters.",
          "--brief-what-learned",
          "We learned.",
          "--brief-what-action",
          "Promote after 2 cycles.",
          "--trigger",
          "user_explicit",
          "--json",
        ],
        project
      );
      expect(crys.code).toBe(0);

      // Then run `peaks asset status --loop loop-status` and verify the
      // dashboard reflects the asset.
      const status = await cli(
        ["asset", "status", "--loop", "loop-status", "--json"],
        project
      );
      expect(status.code).toBe(0);
      const out = JSON.parse(status.stdout);
      expect(out.ok).toBe(true);
      expect(out.data.crystallization_events).toBe(1);
      expect(out.data.events[0].created_loop_release_id).toBe("loop-status");
      expect(out.data.loop_release_counts_by_lifecycle["candidate"]).toBeGreaterThan(
        0
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("dispose trace_only retires the crystallization_event", async () => {
    const project = makeProject();
    try {
      const crys = await cli(
        [
          "asset",
          "crystallize",
          "--from-task",
          "task-1",
          "--loop-id",
          "loop-dispose",
          "--loop-name",
          "Loop Dispose",
          "--loop-scenario",
          "Scenario.",
          "--loop-trigger-policy",
          "Trigger.",
          "--loop-interaction-policy",
          "Human-NL-Choice-Only.",
          "--loop-feedback-policy",
          "Feedback.",
          "--loop-evolution-policy",
          "Evolution.",
          "--loop-success-criterion",
          "c-1",
          "--loop-evaluator-policy",
          "e-1",
          "--loop-version",
          "0.1.0",
          "--bee-name",
          "bee-dispose",
          "--bee-version",
          "0.1.0",
          "--bee-description",
          "Main bee.",
          "--bee-relation-reason",
          "primary",
          "--brief-what-happened",
          "We did the work.",
          "--brief-why-it-matters",
          "It matters.",
          "--brief-what-learned",
          "We learned.",
          "--brief-what-action",
          "Promote after 2 cycles.",
          "--trigger",
          "user_explicit",
          "--json",
        ],
        project
      );
      expect(crys.code).toBe(0);
      const crysOut = JSON.parse(crys.stdout);
      const eventId = crysOut.data.result.crystallization_event_id;

      const dispose = await cli(
        [
          "asset",
          "dispose",
          "--crystallization-event",
          eventId,
          "--mode",
          "trace_only",
          "--json",
        ],
        project
      );
      expect(dispose.code).toBe(0);
      const disposeOut = JSON.parse(dispose.stdout);
      expect(disposeOut.ok).toBe(true);
      expect(disposeOut.data.mode).toBe("trace_only");
      expect(disposeOut.data.lifecycle_status).toBe("retired");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
