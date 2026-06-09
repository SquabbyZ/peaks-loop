# Project standards preflight (QA)

> Body of `## Project standards preflight`. Before QA verification in a code repository, call the Peaks-Cli CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

If the repo needs a first-time standards bundle, treat `standards init` as the creation path. If `CLAUDE.md` already exists, use `standards update` to decide whether Peaks-Cli can append a managed block or should only return review suggestions. Apply only when write authorization exists; otherwise keep the CLI output as a preflight next action. Do not hand-write standards file mutations inside the skill.