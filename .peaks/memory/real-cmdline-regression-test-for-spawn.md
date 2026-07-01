---
name: real-cmdline-regression-test-for-spawn
description: For child_process.spawn on Windows, assertion-only dogfood of args[N] strings is insufficient; tests must construct the actual command line Node builds and check it
metadata:
  type: lesson
---

For any `child_process.spawn` call on Windows that goes through `cmd`, assertion-only dogfood (e.g. "does `args[5]` contain `title \"...\"`") is insufficient. The JSON envelope's `spawned` field shows the LOGICAL command line, not the one Node actually constructs. Node's `child_process.js` applies Windows-specific escaping (backslash-doubling, quote-escaping) to each arg before joining; the result can differ from the logical view in ways that break cmd's parser.

**Why:** slice `2026-06-06-sub-agent-spawn-bug-and-decouple` d493006 shipped a smoke-test dogfood that asserted the logical `spawned` string. The real Node-constructed command line had `\"peaks-loop: ...\"` inside the outer `start` arg, which cmd interpreted as a drive-letter prefix BEFORE the `&&` chain — so the dialog persisted for the user. The fix in 5257dca added a real-cmdline regression test that:
1. Constructs the same `cmdline = ['cmd', ...args].map(quote).join(' ')` that libuv would build
2. Walks the cmdline char-by-char with proper `\"` escape handling
3. Asserts the `&&` chain is ALWAYS inside a quoted region
4. Fails loud if the outer `cmd /c` script parser would see the `&&` as chain operators

**How to apply:**
- For any future Windows spawn fix, add a `buildCmdLineForWin32`-style helper that mirrors Node's `quote()` function and walks the constructed cmdline.
- The walker must handle: `\"` (literal `"` inside a quoted region), backslash before a non-quote (literal `\`), end-of-quote transitions.
- If a `&&` (or `|`, `&`, `||`, `>`, `<`) appears outside any quoted region in the constructed cmdline, fail the test with the exact position. This is the "outer parser will split on this" condition.
- The smoke test of `args[N].includes('...')` is still useful for the inner-script shape (does the inner `cmd /k` see what we want?) — it's just insufficient for the outer-parser shape.
- The same lesson applies to `cmd /c start ...` (used for sub-agent progress watch window), `cmd /c hooks install ...` (Windows-side hook install), and any future spawn that goes through a chain.

**Cross-references:**
- `[[coverage-red-line]]` — meaningful tests, not assertion padding; this is a concrete instance
- `[[windows-shell-quoting-divergence]]` — companion memory on the Git Bash vs PowerShell quoting divergence
- slice evidence: `.peaks/_runtime/2026-06-06-session-5b1095/qa/test-reports/2026-06-06-sub-agent-spawn-bug-and-decouple.md`
