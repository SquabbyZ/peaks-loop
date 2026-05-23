# Peaks UI Workflow

Use Peaks UI only when refactor scope affects user-facing behavior, interaction, visual structure, design systems, or page states.

## Full-auto frontend design path

Use this path before generating or accepting frontend UI:

1. Pull visual direction from `awesome-design-md` style references or equivalent curated design markdown.
2. Apply `taste-skill`/`design-taste-frontend` critique rules to set design variance, motion intensity, visual density, typography, palette, and interaction feel.
3. Produce a concrete visual direction, not vague “clean modern” language.
4. Reject generic AI UI tells: centered stock hero, uniform card grids, default shadcn/library styling, purple-blue gradients, three equal feature cards, generic placeholder copy, and static-only happy states.
5. Require meaningful loading, empty, error, hover, focus, active, and responsive states.
6. Use Playwright MCP on the running page or prototype to inspect real browser output (install via `peaks mcp plan/apply --capability playwright-mcp.browser-validation --yes` if not yet present; open with `mcp__playwright__browser_navigate` / `navigate_page`, capture with `take_snapshot` and `take_screenshot`); visible browser confirmation is mandatory, and login/CAPTCHA/SSO/MFA requires waiting for explicit user confirmation before continuing.
7. If the browser view looks generic, visually weak, broken, inaccessible, or has console/runtime errors, return to design/RD and iterate before handing off to QA.

## Outputs

- UX flow;
- page state map;
- visual direction with references;
- design dials and rejected generic patterns;
- interaction constraints;
- Playwright MCP browser observations when frontend output exists (`mcp__playwright__browser_snapshot`, `take_screenshot`, `list_console_messages`, `list_network_requests`);
- UI regression seeds;
- accessibility notes;
- taste report.
