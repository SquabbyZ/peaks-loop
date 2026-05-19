import { describe, expect, test } from 'vitest';
import { getScHelpText } from '../../src/services/sc/index.js';

describe('sc service index', () => {
  test('re-exports sc service functions', () => {
    expect(getScHelpText()[0]).toContain('peaks sc status');
  });
});
