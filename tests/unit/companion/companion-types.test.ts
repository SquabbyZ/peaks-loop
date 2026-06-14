import { describe, expect, it } from 'vitest';
import {
  CHANNEL_UNSUPPORTED_EXIT_CODE,
  COMPANION_CHANNELS,
  COMPANION_PAIRING_LABELS,
  DEFAULT_COMPANION_CHANNEL
} from '../../../src/services/companion/companion-types.js';

describe('companion-types', () => {
  it('exports the weixin-only channel list for slice 1', () => {
    expect(COMPANION_CHANNELS).toEqual(['weixin']);
  });

  it('defaults the channel to weixin', () => {
    expect(DEFAULT_COMPANION_CHANNEL).toBe('weixin');
  });

  it('uses EX_USAGE (64) as the unsupported-channel exit code', () => {
    expect(CHANNEL_UNSUPPORTED_EXIT_CODE).toBe(64);
  });

  it('exposes a label for every documented pairing state', () => {
    expect(COMPANION_PAIRING_LABELS['unknown']).toBeTruthy();
    expect(COMPANION_PAIRING_LABELS['not-scanned']).toBeTruthy();
    expect(COMPANION_PAIRING_LABELS['scanned-waiting-confirm']).toBeTruthy();
    expect(COMPANION_PAIRING_LABELS['logged-in']).toBeTruthy();
    expect(COMPANION_PAIRING_LABELS['expired']).toBeTruthy();
    expect(COMPANION_PAIRING_LABELS['error']).toBeTruthy();
  });
});
