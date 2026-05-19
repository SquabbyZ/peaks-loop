import { describe, expect, test } from 'vitest';
import {
  makeUnavailableResponse,
  makeAvailableResponse,
  isUnavailableResponse,
  WORKSPACE_UNAVAILABLE_NEXT_ACTIONS,
} from '../../src/shared/planner-response.js';

describe('makeUnavailableResponse', () => {
  test('returns preview behavior with next actions', () => {
    const resp = makeUnavailableResponse('preview', 'Artifact workspace not configured');
    expect(resp.available).toBe(false);
    expect(resp.behavior).toBe('preview');
    expect(resp.reason).toBe('Artifact workspace not configured');
    expect(resp.nextActions).toEqual(WORKSPACE_UNAVAILABLE_NEXT_ACTIONS);
  });

  test('returns blocked behavior with next actions', () => {
    const resp = makeUnavailableResponse('blocked', 'Persistent output requested but no workspace configured');
    expect(resp.available).toBe(false);
    expect(resp.behavior).toBe('blocked');
    expect(resp.reason).toBe('Persistent output requested but no workspace configured');
    expect(resp.nextActions).toEqual(WORKSPACE_UNAVAILABLE_NEXT_ACTIONS);
  });

  test('does not expose shared mutable next actions', () => {
    const resp = makeUnavailableResponse('preview', 'Artifact workspace not configured');
    const mutated = [...resp.nextActions, 'local mutation'];

    expect(resp.nextActions).toEqual(WORKSPACE_UNAVAILABLE_NEXT_ACTIONS);
    expect(mutated).not.toEqual(WORKSPACE_UNAVAILABLE_NEXT_ACTIONS);
    expect(WORKSPACE_UNAVAILABLE_NEXT_ACTIONS).toEqual([
      'Configure a Peaks artifact workspace in your workspace config.',
      'See peaks artifacts workspace --help for setup instructions.',
    ]);
  });
});

describe('makeAvailableResponse', () => {
  test('returns available true with data', () => {
    const data = { taskId: 'rd-impl-001', purpose: 'Implement checkout frontend' };
    const resp = makeAvailableResponse(data);
    expect(resp.available).toBe(true);
    expect(resp.data).toEqual(data);
  });
});

describe('isUnavailableResponse', () => {
  test('returns true for unavailable response', () => {
    const resp = makeUnavailableResponse('blocked', 'no workspace');
    expect(isUnavailableResponse(resp)).toBe(true);
  });

  test('returns false for available response', () => {
    const resp = makeAvailableResponse({ foo: 'bar' });
    expect(isUnavailableResponse(resp)).toBe(false);
  });
});