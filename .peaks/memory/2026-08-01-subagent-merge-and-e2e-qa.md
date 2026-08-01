---
name: 2026-08-01-subagent-merge-and-e2e-qa
kind: feedback
---

# QA validation result for sub-agent merge-back + E2E (effective 2026-08-01)

The sub-agent merge-back + E2E slice (RID `2026-08-01-subagent-merge-and-e2e`) passed 4-dimension QA: 88/88 tests (76 unit + 4 integration + 8 dispatched-prompt unit), `pnpm build` OK, `tsc -p tsconfig.build.json --noEmit` clean. All 8 acceptance criteria (A1-A8) are met. The known stub status of `runE2EVerify` is documented and isolated to a follow-up rid; everything else is production-grade.

**Why:** The slice ships the contract that every downstream peaks-loop consumer needs so sub-agent dispatches stop bypassing the merge-back pipeline and stop colliding on Playwright sessions. The downstream impact is straightforward: `npm install peaks-loop@4.0.4` brings the new CLI verbs (`peaks sub-agent shutdown register|unregister|list` and `peaks e2e verify --slice <rid>`), the dispatch record schema bump (v3.1 → v3.2 is additive), the Playwright profile isolation (no token cost), and the conflict-replay loop (no human pause for first-attempt conflicts).

**How to apply:**

- `planMergeBack({ callerBranch, agentBranch, commitsBehind, conflictingFiles })` is the single source of truth for merge planning; downstream code MUST go through it rather than shelling `git merge` directly.
- Long-lived local services in a sub-agent slice MUST be registered via `peaks sub-agent shutdown register --pid <pid> --name <label>`; the registration file is `.peaks/_runtime/<sid>/dispatch/<dispatchId>/service-registrations.json` and is gitignored.
- The `PEAKS_PLAYWRIGHT_USER_DATA_DIR` + `PEAKS_PLAYWRIGHT_PROFILE_NAME` env pair is the only sanctioned way to isolate concurrent playwright MCP sessions; downstream adapters MUST stamp both into the dispatch envelope.
- `runE2EVerify` is a deterministic stub for v1. Downstream projects that need real E2E should run a follow-up rid that wires the CLI to a real Playwright MCP server.
- `rd/security-review.md` and `rd/perf-baseline.md` for this RID are deferred. They should be added in a separate audit slice; QA does not re-do them by policy.
