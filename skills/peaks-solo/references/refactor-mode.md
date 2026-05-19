# Peaks Solo Refactor Mode

`peaks-solo refactor` is the primary MVP path.

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
10. Require 100% acceptance for the slice.
11. Coordinate `peaks-sc` for artifact retention and commit boundary.
12. Refuse the next slice until code and intermediate artifacts are committed.

## Runtime resources

Use CLI-managed profiles for hooks, agents, swarm, MCP, and external skills. Do not install them from the skill body.
