# Security Review Standards

Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code
Scope: project-local standards for peaks-rd, peaks-qa, and peaks-solo workflow preflight.
- Never hardcode secrets, API keys, passwords, tokens, or credentials.
- Do not send private code or secrets to external services without explicit user authorization.
- Guard filesystem writes against path traversal, symlink, and junction escapes.
- Require explicit confirmation for destructive actions, external state changes, and credential use.
