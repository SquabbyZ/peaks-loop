---
name: peaks-skill-output-style
description: Peaks skills should visibly announce active skill workflows and next process steps across projects.
metadata:
  type: feedback
---
When the user uses Peaks skills from `skills/` in any project, the response should look clearly different from normal Claude Code output. It should prominently tell the user which Peaks skill is active and what workflow/gates come next.

**Why:** The user wants a visible UX distinction when invoking these skills in other projects, especially for swarm development and economy-mode workflows.

**How to apply:** Prefer the `Peaks Skill Swarm` output style when available. For Peaks skill tasks, start with a visible skill-active banner or compact status header, then show the next workflow steps, current gate, and evidence. For non-Peaks tasks, keep normal concise Claude Code behavior.
