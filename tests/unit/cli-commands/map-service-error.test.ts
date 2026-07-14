// Slice 015 — guard the message-substring risk (PRD risk A) by pinning
// the goal-validation message format here. If a future slice changes
// `validatePlanningInput`'s literal, this test fails loudly instead of
// silently degrading the helper into `INTERNAL_ERROR`.
import { describe, expect, test } from 'vitest';
import {
  mapServiceError,
  type EnvelopeMapping,
} from '../../../src/cli/commands/_cli-error-envelope.js';
import { ProviderNotConfiguredError } from '../../../src/services/config/model-routing.js';

describe('mapServiceError (Slice 015)', () => {
  test('provider-not-configured → INVALID_PROVIDERS with config hint', () => {
    const result: EnvelopeMapping = mapServiceError(new ProviderNotConfiguredError());
    expect(result.code).toBe('INVALID_PROVIDERS');
    expect(result.nextActions).toContain('Configure provider model: peaks config provider <id> set --model <id>');
  });

  test('goal-validation message substring → INVALID_GOAL with current literal hint', () => {
    // PIN the literal substring here. The actual throw site at
    // src/cli/commands/workflow-commands.ts:145 emits
    //   Error('Goal must be non-empty')
    // If validatePlanningInput changes, this test fails and
    // Slice 015's risk-A mitigation needs updating.
    const result = mapServiceError(new Error('Goal must be non-empty'));
    expect(result.code).toBe('INVALID_GOAL');
    expect(result.nextActions).toEqual(['Use a non-empty goal']);
  });

  test('unknown error → INTERNAL_ERROR with trace hint', () => {
    const result = mapServiceError(new Error('some unrelated failure'));
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.nextActions).toEqual(['See errorId for trace']);
  });

  test('non-Error throw value (string, undefined, object) → INTERNAL_ERROR', () => {
    expect(mapServiceError('a string error').code).toBe('INTERNAL_ERROR');
    expect(mapServiceError(undefined).code).toBe('INTERNAL_ERROR');
    expect(mapServiceError({ random: 'object' }).code).toBe('INTERNAL_ERROR');
  });
});
