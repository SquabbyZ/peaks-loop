// tests/unit/_setup/index.ts
//
// Single setupFiles entrypoint referenced by vitest.config.ts. Individual
// helpers (tmp workspace, fake clock, IO capture) live in sibling files and
// are NOT auto-registered here — they are opt-in per test file via
// `withTmpWorkspacePerTest()` / `freezeTimeAt()` / `makeCapturedIo()`.
//
// Why: auto-registering them would force every test file to pay the
// mkdtemp + fake-timer cost, including pure utility tests that touch no
// time and no fs. Opt-in keeps the bulk of the suite at <1s.
export {};
