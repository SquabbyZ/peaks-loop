import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ccConnectConfigFile,
  CC_CONNECT_CONFIG_FILENAME,
  CompanionConfigError,
  detectNonWeixinPlatforms,
  projectNameFromIlinkQrPayload,
  renderCompanionConfig,
  renderWeixinConfig,
  writeCcConnectConfig,
  readCcConnectConfig
} from '../../../src/services/companion/config-template.js';
import type { CompanionConfig } from '../../../src/services/config/config-types.js';

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
  it('emits canonical [[projects]] schema with agent + weixin platform', () => {
    const body = renderWeixinConfig();
    // BUG 6 fix: cc-connect expects array-of-tables, not single map.
    expect(body).toContain('[[projects]]');
    expect(body).toContain('name = "default"');
    expect(body).toContain('[projects.agent]');
    expect(body).toContain('type = "claudecode"');
    expect(body).toContain('[projects.agent.options]');
    expect(body).toContain('work_dir =');
    expect(body).toContain('mode = "default"');
    expect(body).toContain('[[projects.platforms]]');
    expect(body).toContain('type = "weixin"');
    expect(body).toContain('[projects.platforms.options]');
    expect(body).toContain('allow_from = "*"');
    expect(body).toContain('account_id = "default"');
  });

  it('does not include any non-weixin platform types', () => {
    const body = renderWeixinConfig();
    expect(detectNonWeixinPlatforms(body)).toEqual([]);
  });

  it('uses the supplied project name (defaulted to "default")', () => {
    expect(renderWeixinConfig({ projectName: 'my-bot' })).toContain('name = "my-bot"');
    expect(renderWeixinConfig()).toContain('name = "default"');
  });

  it('emits allow_from when supplied (overrides the "*" default)', () => {
    const body = renderWeixinConfig({ allowFrom: 'user@im.wechat' });
    expect(body).toContain('allow_from = "user@im.wechat"');
    expect(body).not.toContain('allow_from = "*"');
  });

  it('defaults allow_from to "*" when not supplied', () => {
    const body = renderWeixinConfig();
    expect(body).toContain('allow_from = "*"');
  });

  it('overrides the agent type when agentType is supplied', () => {
    const body = renderWeixinConfig({ agentType: 'codex' });
    expect(body).toContain('type = "codex"');
    expect(body).not.toContain('type = "claudecode"');
  });

  it('emits work_dir from agentWorkDir when supplied', () => {
    const body = renderWeixinConfig({ agentWorkDir: '/tmp/agent' });
    expect(body).toContain('work_dir = "/tmp/agent"');
  });

  it('emits long_poll_timeout_ms when supplied', () => {
    const body = renderWeixinConfig({ longPollTimeoutMs: 45000 });
    expect(body).toContain('long_poll_timeout_ms = 45000');
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
    // BUG 6 fix: only `type = "..."` lines that follow a
    // `[[projects.platforms]]` marker are scanned. The synthetic body
    // below wraps the dingtalk line inside a platforms block so the
    // heuristic still flags it.
    const body = `[[projects.platforms]]
  # comment
   type = "dingtalk"
`;
    expect(detectNonWeixinPlatforms(body)).toEqual(['dingtalk']);
  });
});

// Slice 2026-06-14-cc-connect-weixin (change-1): tests for the
// typed `renderCompanionConfig` entry point. Peaks config is the
// source of truth; the renderer derives the TOML from a typed
// `CompanionConfig`.

function makeCompanionConfig(overrides: Partial<CompanionConfig> = {}): CompanionConfig {
  return {
    enabled: true,
    defaultChannel: 'weixin',
    binaryPath: null,
    binaryPathSource: null,
    configPath: '~/.cc-connect/config.toml',
    weixin: {
      ilinkQrPayload: 'ilink://peaks-cli?project=default',
      loginTimeoutSec: 60
    },
    autoStart: false,
    ...overrides
  };
}

describe('projectNameFromIlinkQrPayload', () => {
  it('extracts project from a basic ilink://peaks-cli?project=NAME payload', () => {
    expect(projectNameFromIlinkQrPayload('ilink://peaks-cli?project=alpha')).toBe('alpha');
  });

  it('decodes percent-encoded project names', () => {
    expect(projectNameFromIlinkQrPayload('ilink://peaks-cli?project=my%20bot')).toBe('my bot');
  });

  it('falls back to "default" when no project= is present', () => {
    expect(projectNameFromIlinkQrPayload('ilink://peaks-cli?other=x')).toBe('default');
  });

  it('falls back to "default" for null/undefined/empty payloads', () => {
    expect(projectNameFromIlinkQrPayload(undefined)).toBe('default');
    expect(projectNameFromIlinkQrPayload(null)).toBe('default');
    expect(projectNameFromIlinkQrPayload('')).toBe('default');
  });
});

describe('renderCompanionConfig (typed peaks config)', () => {
  it('emits the canonical [[projects]] schema with agent + weixin platform', () => {
    const body = renderCompanionConfig(makeCompanionConfig({
      enabled: true,
      weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=default', loginTimeoutSec: 60 }
    }));
    expect(body).toContain('[[projects]]');
    expect(body).toContain('[[projects.platforms]]');
    expect(body).toContain('type = "weixin"');
    expect(body).toContain('name = "default"');
    expect(body).toContain('[projects.agent]');
    expect(body).toContain('type = "claudecode"');
    expect(body).toContain('[projects.agent.options]');
    expect(body).toContain('work_dir =');
    expect(body).toContain('[projects.platforms.options]');
    expect(body).toContain('allow_from =');
    expect(body).toContain('account_id =');
    expect(detectNonWeixinPlatforms(body)).toEqual([]);
  });

  it('weixin-only: no feishu/slack/discord platforms rendered', () => {
    const body = renderCompanionConfig(makeCompanionConfig({ enabled: true }));
    expect(body).not.toContain('"feishu"');
    expect(body).not.toContain('"slack"');
    expect(body).not.toContain('"discord"');
    expect(body).not.toContain('"wecom"');
    expect(body).not.toContain('"telegram"');
    expect(detectNonWeixinPlatforms(body)).toEqual([]);
  });

  it('uses the project name from weixin.ilinkQrPayload', () => {
    const body = renderCompanionConfig(makeCompanionConfig({
      enabled: true,
      weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=team-bot', loginTimeoutSec: 60 }
    }));
    expect(body).toContain('name = "team-bot"');
  });

  it('peaksConfig.companion.agentType overrides default agent type', () => {
    const body = renderCompanionConfig(makeCompanionConfig({
      enabled: true,
      agentType: 'codex'
    }));
    expect(body).toContain('type = "codex"');
    expect(body).not.toContain('type = "claudecode"');
  });

  it('peaksConfig.companion.agentWorkDir overrides the default work_dir', () => {
    const body = renderCompanionConfig(makeCompanionConfig({
      enabled: true,
      agentWorkDir: '/srv/peaks/agent'
    }));
    expect(body).toContain('work_dir = "/srv/peaks/agent"');
  });

  it('enabled=false renders empty body (no [[projects]] at all)', () => {
    const body = renderCompanionConfig(makeCompanionConfig({ enabled: false }));
    expect(body).not.toContain('[[projects]]');
    expect(body).not.toContain('[[projects.platforms]]');
    expect(body).not.toContain('type = "weixin"');
    expect(body).not.toContain('[projects.agent]');
    expect(detectNonWeixinPlatforms(body)).toEqual([]);
    expect(body).toMatch(/companion\.enabled=false/);
  });

  it('throws a typed CompanionConfigError when defaultChannel !== "weixin"', () => {
    expect(() => renderCompanionConfig(makeCompanionConfig({
      defaultChannel: 'feishu' as never
    }))).toThrow(CompanionConfigError);
    try {
      renderCompanionConfig(makeCompanionConfig({ defaultChannel: 'feishu' as never }));
    } catch (err) {
      expect(err).toBeInstanceOf(CompanionConfigError);
      expect((err as CompanionConfigError).code).toBe('COMPANION_CONFIG_INVALID');
    }
  });
});
