---
name: a-predicate-written-for-one-domain-will-lie-in-another-and-the-lie-will-look-like-a-security-block
description: A predicate written for one domain will lie in another — and the lie will look like a security block
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-c0.md
---

`isSensitiveConfigPath` matches substrings against a lowercased, punctuation-stripped string. It is
correct for its own domain: a config **key** named `windowTokens` or `apiKey` really is sensitive, and
`includes('token')` is a fine way to catch it. Applied to a **prose title**, the same function refuses
a memory called "Derive from the **auth**ority" — because `authority` contains `auth` — and reports
`Refusing to store sensitive memory content` with the remedy "remove secrets".

**Why:** a substring predicate encodes "this domain's identifiers are short and are what they say",
which is true of keys and false of sentences. The failure is not a false positive to be narrowed away;
it is the predicate being asked a question its domain never prepared it for. And the damage is worse
than a blocked write: the message sends the reader hunting for a secret that does not exist.

**How to apply:** before reusing a validator outside the domain it was written for, name that domain's
assumption and check it holds. Here the fix was a **new** predicate built for prose (word-run matching,
camelCase-aware, returning the matched term) rather than a narrower substring — and the old one was
removed from that call site only, leaving its own domain untouched. Pair it with a **two-sided**
control: the innocuous titles must pass *and* `apiKey` / `private_key` / `access token` must still be
refused. A one-sided relaxation is how a guard gets loosened into decoration.
