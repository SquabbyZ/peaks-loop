import { describe, it, expect } from 'vitest';
import { redactValue, redactLine, isSecretKey } from '../../../src/services/log/redact.js';

describe('log/redact', () => {
  describe('isSecretKey', () => {
    it('matches common secret keys case-insensitively', () => {
      expect(isSecretKey('api_key')).toBe(true);
      expect(isSecretKey('apiKey')).toBe(true);
      expect(isSecretKey('API_KEY')).toBe(true);
      expect(isSecretKey('password')).toBe(true);
      expect(isSecretKey('Password')).toBe(true);
      expect(isSecretKey('token')).toBe(true);
      expect(isSecretKey('Authorization')).toBe(true);
      expect(isSecretKey('authorization')).toBe(true);
    });

    it('does not match unrelated keys', () => {
      expect(isSecretKey('name')).toBe(false);
      expect(isSecretKey('userId')).toBe(false);
      expect(isSecretKey('version')).toBe(false);
      expect(isSecretKey('command')).toBe(false);
    });

    it('returns false for empty / non-string', () => {
      expect(isSecretKey(null as unknown as string)).toBe(false);
      expect(isSecretKey(undefined as unknown as string)).toBe(false);
    });
  });

  describe('redactValue', () => {
    it('replaces a known token-shaped string with <redacted>', () => {
      expect(redactValue('ghp_1234567890abcdefghij')).toBe('<redacted>');
      expect(redactValue('Bearer abc.def.ghi')).toBe('<redacted>');
    });

    it('preserves non-secret strings verbatim', () => {
      expect(redactValue('hello world')).toBe('hello world');
      expect(redactValue('2.2.2')).toBe('2.2.2');
    });
  });

  describe('redactLine', () => {
    it('redacts Authorization: Bearer <token> header form', () => {
      const redacted = redactLine('curl -H "Authorization: Bearer abc.def.ghi" https://example.com');
      expect(redacted).toContain('Authorization: Bearer <redacted>');
      expect(redacted).not.toContain('abc.def.ghi');
    });

    it('redacts api_key=value form', () => {
      const redacted = redactLine('config: api_key=supersecret12345');
      expect(redacted).toContain('api_key=<redacted>');
      expect(redacted).not.toContain('supersecret12345');
    });

    it('redacts "password": "..." form', () => {
      const redacted = redactLine('login: password="hunter2hunter2"');
      expect(redacted).toContain('password=<redacted>');
      expect(redacted).not.toContain('hunter2hunter2');
    });

    it('leaves non-secret lines alone', () => {
      const line = 'peaks slice check --project /Users/x/Desktop/foo';
      expect(redactLine(line)).toBe(line);
    });
  });
});
