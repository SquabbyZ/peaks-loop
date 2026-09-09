# Step 1 — Mode selection

> Body of `### Peaks-Loop Step 1`. After Step 0 has anchored the workspace and presence, when the user invokes Peaks-Loop Code without explicitly naming an execution profile, use `AskUserQuestion` to pick the profile. Present the recommended full-auto path as the first/default option with a practical description for each:

1. **Full auto (Recommended)** — Peaks-Loop handles planning, role coordination, validation, and compact handoff end-to-end while preserving required confirmation gates for risky or shared-state actions.
2. **24h** — Long-run autonomy profile: auto-proceed gates, periodic checkpoints, and the partial auto-compact cadence for overnight / multi-hour runs. It may be auto-engaged by the T1–T5 triggers without a pick.
3. **Assisted** — Peaks-Loop proposes plans, artifacts, and checks, then pauses for user decisions at major workflow boundaries.
4. **Strict** — Peaks-Loop uses the most conservative gates: explicit confirmations, strict slice specs, coverage evidence, QA acceptance, and commit boundaries before continuing.

Map the user's selection to the `--mode` flag value (used by `peaks skill presence:set`; `presence:set --mode` accepts any string, so the name matches the user-facing label rather than overloading "code" which is also the skill name):

| User selects | `--mode` value |
|---|---|
| Full auto | `full-auto` |
| 24h | `24h` |
| Assisted | `assisted` |
| Strict | `strict` |

> Note: in `assisted` / `strict`, a workflow-boundary confirmation is resolved by asking the user via `AskUserQuestion` and, on approval, re-running the same CLI command with `--confirm`. The CLI never opens a terminal prompt (no stdin read, no `y/N`) — an LLM-driven session has no TTY.

> Note: parallel role/worker fan-out is the default execution strategy in **every** mode — it is not a mode of its own. The old `swarm` profile was removed; a legacy on-disk `mode: 'swarm'` is read as `full-auto`.

> Note: `peaks workflow route --mode code|team` is a **different** CLI dimension (code developer vs team flow) and is unrelated to the profile choice here. Do not conflate them.

If the user already names a profile in their invocation (e.g. `/peaks-code --full-auto`, "用全自动模式"), skip this question and use the named profile directly.