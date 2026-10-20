---
name: a-new-cli-flag-is-described-in-four-places-and-only-one-of-them-is-tested
description: a new CLI flag is described in four places and only one of them is tested
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff-003.md
---

Three times in one session, a document claimed something the code did not do. First `--filter-language` was passed to a binary that never had the flag. Then a source comment called `severityFor` exported when nothing imported it. Then `--envelope` was documented as inline JSON in the option text, the nextAction, `SKILL.md` and the reference, while the code called `readFileSync` on it.

The pattern: adding or changing a flag writes the same fact into four surfaces — the option description, the refusal/nextAction string, the skill that invokes it, and the reference that explains it — and none of them is executed by a test. The code moves; the prose stays.

The cheap check is a grep, and it has to be run on the *name*, not on the wording: `grep -rn '<flag-name>' src skills` and read every hit. That is how the fourth surface gets found, because whoever edits the option description will not think to look in a skill reference three directories away.

The stronger fix is to make a refusal do the teaching: when the input is wrong, say what the expected shape is in the message itself (`--envelope must be a path to a readable JSON file: <value>`). A wrong invocation then corrects the caller directly, instead of relying on prose that may have drifted.

Related: [[a-claim-written-in-three-places-and-pinned-by-no-test-will-drift]], [[a-mocked-external-cli-is-not-evidence-of-its-contract]].
