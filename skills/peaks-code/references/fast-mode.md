# Solo fast mode (slice 2 — round-trip ≤ 30s)

For hot-fix / small-bug slices where the full 5-step workflow is overkill,
use **fast mode**: `peaks solo plan --fast <change-id>`. Fast mode skips
three steps that dominate cold-start cost:

| Step | Default | Fast |
|------|---------|------|
| `load-memory` (full `.peaks/memory/*` load) | run | **skip** (use last-touched subset / `--tag` filter) |
| `standards-preflight` (5-axis rule fan-out) | run | **skip** |
| `qa-cycle` (single round + repair loop) | repair=on | repair=off |
| `rd-cycle`, `emit-txt` | run | run |

## Acceptance gate

`test pass + tsc pass + lint pass` = GO. Single QA round, NO repair loop.
Use fast mode only when the user explicitly opts in (default stays
conservative).

## Karpathy-4 in fast mode

= condensed 1-paragraph version (not the full 4-block injection).
Full guidelines still apply, just shipped inline as one block.
