// tests/unit/services/fresh-context/trigger-scan.test.ts
//
// 4-dimension unit test for the fresh-context trigger scan (slice
// 2026-09-07-search-first-preflight). Covers the deterministic keyword scan:
// signal hit / miss / force keyword / kill-switch / case-insensitive English.
//
// Dimensions covered:
//   - behavior: input prompt + enabled flag → { triggered, forced, signals, enabled }
//   - render:    not applicable (returns a plain object)
//   - integration: not applicable (pure function, no fs / network / config IO)
//   - a11y:     not applicable (no user-visible text or exit code)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/fresh-context/trigger-scan.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'pure function, no fs / network / config boundary' },
    { dim: 'render', reason: 'returns a plain object, no structured output surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { scanFreshContextTrigger } from '~/src/services/fresh-context/trigger-scan';

describe('Scenario: behavior — fresh-context trigger scan', () => {
  it("when a signal keyword is present, should trigger and report the matched signals", () => {
    // given: a prompt carrying upgrade/migration signal keywords and the switch enabled
    // when:  the scan is invoked
    const out = scanFreshContextTrigger('升级 antd 到最新版本', true);
    // then:  triggered is true, forced is false, and the matched signals are listed
    expect(out.triggered).toBe(true);
    expect(out.forced).toBe(false);
    expect(out.signals).toContain('升级');
    expect(out.signals).toContain('最新');
    expect(out.signals).toContain('版本');
    expect(out.enabled).toBe(true);
  });

  it("when no signal keyword is present, should not trigger", () => {
    // given: a neutral refactor request with no trigger keyword
    // when:  the scan is invoked
    const out = scanFreshContextTrigger('重构内部工具函数', true);
    // then:  triggered is false with no signals
    expect(out.triggered).toBe(false);
    expect(out.forced).toBe(false);
    expect(out.signals).toEqual([]);
  });

  it("when a force keyword is present, should force a trigger even without signal keywords", () => {
    // given: a prompt with only a force keyword (联网搜) and no signal keyword
    // when:  the scan is invoked
    const out = scanFreshContextTrigger('请帮我联网搜一下', true);
    // then:  forced is true and triggered is true while signals stay empty
    expect(out.forced).toBe(true);
    expect(out.triggered).toBe(true);
    expect(out.signals).toEqual([]);
  });

  it("when the kill-switch is disabled, should no-op regardless of signal hit", () => {
    // given: a clear signal keyword but the kill-switch set to false
    // when:  the scan is invoked
    const out = scanFreshContextTrigger('升级 antd', false);
    // then:  triggered is false and enabled is false (signals still reflect the raw scan)
    expect(out.enabled).toBe(false);
    expect(out.triggered).toBe(false);
    expect(out.signals).toContain('升级');
  });

  it("when English signal keywords are present with mixed case, should match case-insensitively", () => {
    // given: a prompt with mixed-case English signal keywords
    // when:  the scan is invoked
    const out = scanFreshContextTrigger('Migrate to the NEWEST React and check BREAKING changes', true);
    // then:  the english keywords are matched case-insensitively and the scan triggers
    expect(out.triggered).toBe(true);
    expect(out.signals).toContain('migrate');
    expect(out.signals).toContain('new');
    expect(out.signals).toContain('breaking');
  });
});
