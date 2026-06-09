# Frontend project generation (RD)

> Body of `## Frontend project generation`. When RD work creates a frontend application and the user has not specified a technology stack, and the current scan plus existing project standards still do not establish a frontend stack, default to React + Vite + shadcn/ui with:

- `peaks shadcn init --preset [CODE] --template vite`

`[CODE]` is the preset code supplied by the shadcn registry or user workflow; if it is unknown, stop and resolve the intended preset before scaffolding.

If the user specifies a frontend stack or scaffold command, use the specified technology. If the scaffold emits JavaScript, convert generated application files to TypeScript before continuing; if conversion is not practical, ask for a TypeScript-compatible scaffold.

Application projects generated through this skill must not contain JavaScript source or config files. Generate TypeScript only (`.ts`, `.tsx`, and TypeScript config equivalents), including when adapting examples from libraries or templates.