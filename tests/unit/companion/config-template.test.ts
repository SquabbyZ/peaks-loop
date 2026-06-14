import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ccConnectConfigFile,
  CC_CONNECT_CONFIG_FILENAME,
  detectNonWeixinPlatforms,
  renderWeixinConfig,
  writeCcConnectConfig,
  readCcConnectConfig
} from '../../../src/services/companion/config-template.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peaks-config-template-'));
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe('paths', () => {
  it('ccConnectConfigFile lives under ~/.cc-connect', () => {
    const file = ccConnectConfigFile(home);
    expect(file).toBe(join(home, '.cc-connect', CC_CONNECT_CONFIG_FILENAME));
  });
});

describe('renderWeixinConfig', () => {
  it('emits a [projects] block and a single weixin platform', () => {
    const body = renderWeixinConfig();
    expect(body).toContain('[projects]');
    expect(body).toContain('[[projects.platforms]]');
    expect(body).toContain('type = "weixin"');
  });

  it('does not include any non-weixin platform types', () => {
    const body = renderWeixinConfig();
    expect(detectNonWeixinPlatforms(body)).toEqual([]);
  });

  it('uses the supplied project name (defaulted to "default")', () => {
    expect(renderWeixinConfig({ projectName: 'my-bot' })).toContain('name = "my-bot"');
    expect(renderWeixinConfig()).toContain('name = "default"');
  });

  it('emits allow_from when supplied', () => {
    const body = renderWeixinConfig({ allowFrom: 'user@im.wechat' });
    expect(body).toContain('allow_from = "user@im.wechat"');
  });

  it('omits allow_from when not supplied', () => {
    const body = renderWeixinConfig();
    expect(body).not.toContain('allow_from');
  });

  it('throws when a non-weixin channel is passed (slice 1 hard constraint)', () => {
    expect(() => renderWeixinConfig({ channel: 'feishu' as never })).toThrow(/channel not supported/);
  });
});

describe('writeCcConnectConfig', () => {
  it('writes a fresh config when no file exists', () => {
    const body = renderWeixinConfig({ projectName: 'alpha' });
    const result = writeCcConnectConfig(body, { home });
    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(false);
    expect(existsSync(result.path)).toBe(true);
    const reRead = readCcConnectConfig(home);
    expect(reRead?.body).toContain('name = "alpha"');
  });

  it('preserves an existing config when overwrite is false (AC7 default)', () => {
    mkdirSync(join(home, '.cc-connect'), { recursive: true });
    const existingPath = ccConnectConfigFile(home);
    writeFileSync(existingPath, '# original content\n', 'utf8');
    const result = writeCcConnectConfig('# new content\n', { home });
    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(true);
    const onDisk = readFileSync(existingPath, 'utf8');
    expect(onDisk).toBe('# original content\n');
  });

  it('overwrites when overwrite is true', () => {
    mkdirSync(join(home, '.cc-connect'), { recursive: true });
    const existingPath = ccConnectConfigFile(home);
    writeFileSync(existingPath, '# original content\n', 'utf8');
    const result = writeCcConnectConfig('# new content\n', { home, overwrite: true });
    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(false);
    const onDisk = readFileSync(existingPath, 'utf8');
    expect(onDisk).toBe('# new content\n');
  });
});

describe('readCcConnectConfig', () => {
  it('returns null when the file is absent', () => {
    expect(readCcConnectConfig(home)).toBeNull();
  });

  it('returns the body + mtime when present', () => {
    const body = '# hello\n';
    mkdirSync(join(home, '.cc-connect'), { recursive: true });
    writeFileSync(ccConnectConfigFile(home), body, 'utf8');
    const result = readCcConnectConfig(home);
    expect(result?.body).toBe(body);
    expect(typeof result?.mtimeMs).toBe('number');
  });
});

describe('detectNonWeixinPlatforms', () => {
  it('returns an empty list for a weixin-only config', () => {
    expect(detectNonWeixinPlatforms(renderWeixinConfig())).toEqual([]);
  });

  it('flags every non-weixin platform type found', () => {
    const body = `
[[projects.platforms]]
type = "weixin"
[[projects.platforms]]
type = "feishu"
[[projects.platforms]]
type = "slack"
[[projects.platforms]]
type = "discord"
`;
    expect(detectNonWeixinPlatforms(body).sort()).toEqual(['discord', 'feishu', 'slack']);
  });

  it('tolerates comments and whitespace before type=', () => {
    const body = `  # comment
   type = "dingtalk"
`;
    expect(detectNonWeixinPlatforms(body)).toEqual(['dingtalk']);
  });
});
