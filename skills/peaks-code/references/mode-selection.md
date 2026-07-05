# Step 1 — Mode selection

> Body of `### Peaks-Loop Step 1`. After Step 0 has anchored the workspace and presence, when the user invokes Peaks-Loop Solo without explicitly naming an execution profile, use `AskUserQuestion` to pick the profile. Present the recommended full-auto path as the first/default option with a practical description for each:

1. **Full auto (Recommended)** — Peaks-Loop handles planning, role coordination, validation, and compact handoff end-to-end while preserving required confirmation gates for risky or shared-state actions.
2. **Assisted** — Peaks-Loop proposes plans, artifacts, and checks, then pauses for user decisions at major workflow boundaries.
3. **Swarm** — Peaks-Loop maximizes safe parallel role/worker execution for larger RD or QA workloads while keeping reducer validation and artifact boundaries explicit.
4. **Strict** — Peaks-Loop uses the most conservative gates: explicit confirmations, strict slice specs, coverage evidence, QA acceptance, and commit boundaries before continuing.

Map the user's selection to the `--mode` flag value (used by `peaks skill presence:set`; `presence:set --mode` accepts any string, so the name matches the user-facing label rather than overloading "solo" which is also the skill name):

| User selects | `--mode` value |
|---|---|
| Full auto | `full-auto` |
| Assisted | `assisted` |
| Swarm | `swarm` |
| Strict | `strict` |

> Note: `peaks workflow route --mode solo|team` is a **different** CLI dimension (solo developer vs team flow) and is unrelated to the profile choice here. Do not conflate them.

If the user already names a profile in their invocation (e.g. `/peaks-code --full-auto`, "用全自动模式"), skip this question and use the named profile directly.