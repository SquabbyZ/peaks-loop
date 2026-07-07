# Peaks Code Refactor Mode

`peaks-code refactor` is the primary MVP path.

## Flow

1. Detect refactor intent and risk.
2. Ask CLI doctor for available runtime capabilities.
3. Coordinate `peaks-prd` for goals, non-goals, preserved behavior, and acceptance spec.
4. Coordinate `peaks-txt` for initial context capsule.
5. Coordinate `peaks-rd` for project scan, standards scan, coverage report, slice map, and options.
6. Block implementation unless UT coverage is >= 95%.
7. Coordinate `peaks-qa` for regression matrix and baseline report.
8. Ask the user to confirm option, scope, and accepted risks.
9. Execute one minimal functional slice at a time.
10. After every RD slice, coordinate `peaks-qa`; if QA reports any failed, blocked, missing, or unverified item, return the report to RD for repair and repeat QA.
11. Require 100% acceptance for the slice before completion or the next slice.
12. Coordinate `peaks-sc` for local artifact retention and the `.peaks/_runtime/<session-id>/sc/retention-boundary.md` boundary.
13. Exclude login URLs, cookies, headers, tokens, storage state, browser traces, and PII/SSO/MFA screenshots or logs from retained artifacts.
14. Refuse the next slice until code changes and sanitized intermediate artifacts are traceable in local `.peaks/_runtime/<session-id>/` storage; commit or sync only after explicit user or profile authorization.

## Runtime resources

Use CLI-managed profiles for hooks, agents, swarm, MCP, and external skills. Do not install them from the skill body.
