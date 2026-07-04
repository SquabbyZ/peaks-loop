#!/usr/bin/env bash
# Dogfood the full sediment cycle. Runs the CLI end-to-end:
#   1. add-segment
#   2. add-bee (with --description)
#   3. dispose --decision retain (writes to local SkillHub)
#   4. releases (list versioned releases)
#   5. release-show
#   6. export → import (round-trip)
#
# Usage: PEAKS_HOME=/path/to/sandbox ./scripts/dogfood-sediment-cycle.sh
# Requires the CLI to be built first: `npm run build`.
set -euo pipefail
: "${PEAKS_HOME:=/tmp/peaks-dogfood}"
: "${PEAKS_CLI:=$(pwd)/dist/cli/index.js}"

rm -rf "$PEAKS_HOME"
mkdir -p "$PEAKS_HOME"

HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment add-segment seg-foo --describe "fetches foo" --apply
HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment add-bee bee-foo --segment seg-foo --description "demo bee" --apply
HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment list
HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment rebuild-index

mkdir -p "$PEAKS_HOME/scratch"
cat > "$PEAKS_HOME/scratch/SKILL.md" << 'EOF'
---
name: bee-foo
description: foo
---
## bee-foo
EOF

HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment dispose bee-foo --decision retain --scratch "$PEAKS_HOME/scratch" --version 0.1.0 --apply
HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment releases bee-foo
HOME="$PEAKS_HOME" node "$PEAKS_CLI" peaks skill sediment release-show bee-foo --version 0.1.0

echo "→ done; see $PEAKS_HOME/.peaks/skills/"
ls -la "$PEAKS_HOME/.peaks/skills/" 2>/dev/null || true
