import { describe, it, expect } from 'vitest';
import { mockFetcher } from '../../../../src/services/context/mock-fetcher.js';

describe('mockFetcher', () => {
  it('always returns null', async () => {
    expect(await mockFetcher('antd', '5.21.0')).toBeNull();
    expect(await mockFetcher('react', '18.3.1')).toBeNull();
  });
});
