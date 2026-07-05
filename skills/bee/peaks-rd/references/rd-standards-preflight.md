# Project standards preflight (RD)

> Body of `## Project standards preflight`. Before RD planning or implementation work in a code repository, call the Peaks-Loop CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

If `CLAUDE.md` is missing, treat creation as the preferred path. If `CLAUDE.md` already exists, use `standards update` to decide whether to append a managed index block or surface review-only suggestions. Apply only when write authorization exists; otherwise keep the CLI output as a preflight next action. Do not hand-write standards file mutations inside the skill.