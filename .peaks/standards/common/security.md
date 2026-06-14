# Security Review Standards (2.0 canonical)

- Never hardcode secrets, API keys, passwords, tokens, or credentials.
- Do not send private code or secrets to external services without explicit user authorization.
- Guard filesystem writes against path traversal, symlink, and junction escapes.
- Require explicit confirmation for destructive actions, external state changes, and credential use.
