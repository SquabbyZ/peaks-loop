import { describe, expect, test } from 'vitest';
import { createHarness } from './cli-program-test-utils.js';

describe('cli-program smoke', () => {
  test('creates a program harness', () => {
    const harness = createHarness();
    expect(harness.program).toBeDefined();
  });
});
