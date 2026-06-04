#!/usr/bin/env bash
# Mirror of skills/peaks-solo/SKILL.md Step 0.7 detection logic.
# Returns the "deepest completed gate" classification for a session dir.
#
# Usage: bash skill-resume-mode-detect.sh <sid> <peaks-root>
# Outputs: one of:
#   fresh                            no slice started
#   complete                         all gates done
#   resume:rd-planning               PRD handed-off, RD planning missing
#   resume:qa-validation             RD qa-handoff, QA validation missing
#   resume:txt-handoff               QA verdict-issued, TXT handoff missing
#   in-flight:<state>                RD/QA in some non-terminal state
set -e
shopt -s nullglob
sid="$1"
root="$2"

if [ ! -d "$root/$sid" ]; then
  echo "fresh"
  exit 0
fi

# Check role request states (one-pass grep on files that exist)
# Real artifacts use `- state: handed-off` (bullet list item under `## Status`);
# some legacy files may have `state: handed-off` (no leading dash). Match both.
# Note: separate -m and -E flags — ugrep (the BSD-replacement on this system)
# doesn't support combined short options like -m1E.
# After grepping, sed strips the `- state:` / `state:` prefix to leave just the value
# (we don't use `awk '{print $2}'` because `$2` would be `state:` for bullet items).
extract_state() {
  grep -m 1 -E '^-? *state:' "$1" | sed -E 's/^-? *state: *//' | head -1
}
prd_state=""
rd_state=""
qa_state=""
for f in "$root/$sid"/prd/requests/*.md; do
  [ -f "$f" ] && prd_state=$(extract_state "$f")
done
for f in "$root/$sid"/rd/requests/*.md; do
  [ -f "$f" ] && rd_state=$(extract_state "$f")
done
for f in "$root/$sid"/qa/requests/*.md; do
  [ -f "$f" ] && qa_state=$(extract_state "$f")
done

# Classification
if [ -z "$prd_state" ] && [ -z "$rd_state" ] && [ -z "$qa_state" ]; then
  echo "fresh"
elif [ "$qa_state" = "verdict-issued" ]; then
  if [ -f "$root/$sid/txt/handoff.md" ]; then
    echo "complete"
  else
    echo "resume:txt-handoff"
  fi
elif [ "$rd_state" = "qa-handoff" ]; then
  echo "resume:qa-validation"
elif [ "$prd_state" = "handed-off" ] && [ -z "$rd_state" ]; then
  echo "resume:rd-planning"
else
  # Use bash parameter expansion for the in-flight marker
  effective="${rd_state:-${prd_state:-${qa_state:-unknown}}}"
  echo "in-flight:$effective"
fi
