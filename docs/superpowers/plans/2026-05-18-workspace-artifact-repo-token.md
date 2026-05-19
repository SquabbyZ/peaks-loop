# Workspace Artifact Repo Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `config.json` 的每个 `workspaces[]` 项都能在现有 `artifactRepo` 中保存共用 git 仓信息和对应 git token，用于中间产物与 `.claude/memory`。

**Architecture:** 沿用现有 `WorkspaceConfig.artifactRepo`，只新增可选 `token` 字段，不新增 `memoryRepo`。配置归一化、CLI 写入、artifact sync 认证都以 workspace token 优先；未配置时保留现有 `GH_TOKEN` fallback。

**Tech Stack:** TypeScript, Node.js 20+, Commander, Vitest, git extra header auth.

---

## 文件结构

- 修改 [config-types.ts](../../src/services/config/config-types.ts)：给 `WorkspaceConfig.artifactRepo` 增加 `token?: string`。
- 修改 [config-service.ts](../../src/services/config/config-service.ts)：归一化 `artifactRepo.token`，并允许 `workspaces[].artifactRepo.token` 在配置读写和展示中保持原值。
- 修改 [config-commands.ts](../../src/cli/commands/config-commands.ts)：给 `peaks config workspace add` 增加 `--repo-token <token>`。
- 修改 [workspace-service.ts](../../src/services/artifacts/workspace-service.ts)：artifact sync 优先使用 workspace token 构造 git auth env。
- 修改 [config-service.test.ts](../../tests/unit/config-service.test.ts)：覆盖 token 归一化、读取、展示和 project layer 写入。
- 修改 [cli-program.core.test.ts](../../tests/unit/cli-program.core.test.ts)：覆盖 CLI 写入 token。
- 修改 [workspace-service-git-auth.test.ts](../../tests/unit/workspace-service-git-auth.test.ts)：覆盖 workspace token 优先级和 fallback。
- 修改 [README.md](../../README.md) 和 [README-en.md](../../README-en.md)：更新配置示例与说明。

---

### Task 1: 配置类型与归一化

**Files:**
- Modify: `src/services/config/config-types.ts:36-45`
- Modify: `src/services/config/config-service.ts:120-123,245-256,324-357,441-490`
- Test: `tests/unit/config-service.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/unit/config-service.test.ts` 的 `describe('secret config handling', ...)` 内新增测试：

```ts
test('preserves workspace artifact repo token without redacting it', () => {
  const workspace = {
    workspaceId: 'ws-token',
    name: 'Workspace Token',
    rootPath: '/tmp/ws-token',
    installedCapabilityIds: [],
    artifactRepo: {
      provider: 'github' as const,
      owner: 'acme',
      name: 'artifact-repo',
      token: 'workspace-token'
    }
  };

  writeConfig({ workspaces: [workspace] }, 'user');

  expect(readConfig().workspaces[0]?.artifactRepo?.token).toBe('workspace-token');
  expect(getConfig({ key: 'workspaces[0].artifactRepo.token' })).toBe('workspace-token');
  expect(isSensitiveConfigPath('workspaces[0].artifactRepo.token')).toBe(false);
  expect(isSensitiveConfigPath('workspaces.0.artifactRepo.token')).toBe(false);

  const redacted = redactConfigSecrets(readConfig()) as {
    workspaces: Array<{ artifactRepo?: { token?: string } }>;
  };
  expect(redacted.workspaces[0]?.artifactRepo?.token).toBe('workspace-token');
});
```

同一个 `describe` 内再新增 project layer 写入测试：

```ts
test('allows workspace artifact repo token in project layer config', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({}), 'utf8');

  const workspace = {
    workspaceId: 'project-token',
    name: 'Project Token',
    rootPath: '/tmp/project-token',
    installedCapabilityIds: [],
    artifactRepo: {
      provider: 'github' as const,
      owner: 'acme',
      name: 'artifact-repo',
      token: 'project-workspace-token'
    }
  };

  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
  try {
    expect(() => writeConfig({ workspaces: [workspace] }, 'project')).not.toThrow();
    expect(readConfig().workspaces[0]?.artifactRepo?.token).toBe('project-workspace-token');
  } finally {
    cwdSpy.mockRestore();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm vitest run tests/unit/config-service.test.ts --runInBand
```

Expected: FAIL，原因应包含 `token` 没被保留、被红action 成 `***`，或 project layer 因敏感字段被拒绝。

- [ ] **Step 3: 修改 `WorkspaceConfig` 类型**

在 `src/services/config/config-types.ts` 中把 `artifactRepo` 类型改成：

```ts
  artifactRepo?: {
    provider: 'github' | 'gitlab';
    owner: string;
    name: string;
    token?: string;
  };
```

- [ ] **Step 4: 增加 workspace token 路径判断**

在 `src/services/config/config-service.ts` 的 `isSensitiveConfigPath` 前增加：

```ts
function isWorkspaceArtifactRepoTokenPath(path: string): boolean {
  return /^workspaces(?:\[\d+\]|\.\d+)\.artifactRepo\.token$/.test(path);
}
```

然后把 `isSensitiveConfigPath` 改成：

```ts
export function isSensitiveConfigPath(path: string): boolean {
  if (isWorkspaceArtifactRepoTokenPath(path)) return false;
  const normalized = path.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('apikey') || normalized.includes('accesskey') || normalized.includes('privatekey') || normalized.includes('token') || normalized.includes('secret') || normalized.includes('password') || normalized.includes('bearer') || normalized.includes('credential') || normalized.includes('auth');
}
```

- [ ] **Step 5: 保留 `artifactRepo.token` 归一化结果**

把 `toWorkspaceConfig` 中构造 `artifactRepo` 的代码替换为：

```ts
  let artifactRepo: WorkspaceConfig['artifactRepo'];
  if (isRecord(value.artifactRepo) && (value.artifactRepo.provider === 'github' || value.artifactRepo.provider === 'gitlab') && typeof value.artifactRepo.owner === 'string' && typeof value.artifactRepo.name === 'string') {
    const token = typeof value.artifactRepo.token === 'string' && value.artifactRepo.token.trim().length > 0
      ? value.artifactRepo.token.trim()
      : undefined;
    artifactRepo = {
      provider: value.artifactRepo.provider,
      owner: value.artifactRepo.owner,
      name: value.artifactRepo.name,
      ...(token ? { token } : {})
    };
  }
```

- [ ] **Step 6: 让敏感字段检测跳过 workspace git token**

把 `containsSensitiveConfigValue` 替换为带路径参数的版本：

```ts
export function containsSensitiveConfigValue(value: unknown, path = ''): boolean {
  if (Array.isArray(value)) {
    return value.some((entry, index) => containsSensitiveConfigValue(entry, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => {
    const nextPath = path ? `${path}.${key}` : key;
    return (!isWorkspaceArtifactRepoTokenPath(nextPath) && isSecretKey(key)) || containsSensitiveConfigValue(entry, nextPath);
  });
}
```

- [ ] **Step 7: 让配置展示不红action workspace git token**

把 `redactConfigSecrets` 的对象分支替换为：

```ts
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSecretKey(key) && !isWorkspaceArtifactRepoTokenPath(nextPath)) {
      return [key, '***'];
    }
    if (isProviderBaseUrlPath(nextPath) && typeof entry === 'string') {
      return [key, sanitizeBaseUrlForDisplay(entry)];
    }
    return [key, redactConfigSecrets(entry, nextPath)];
  }));
```

- [ ] **Step 8: 运行配置测试确认通过**

Run:

```bash
pnpm vitest run tests/unit/config-service.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 9: 提交检查点**

仅当用户明确授权提交时执行：

```bash
git add src/services/config/config-types.ts src/services/config/config-service.ts tests/unit/config-service.test.ts
git commit -m "feat: add workspace artifact repo token config"
```

---

### Task 2: CLI 写入 workspace token

**Files:**
- Modify: `src/cli/commands/config-commands.ts:7-17,162-179,213-233`
- Test: `tests/unit/cli-program.core.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/unit/cli-program.core.test.ts` 的 `describe('createProgram', ...)` 内新增测试：

```ts
test('workspace add writes artifact repo token when provided', async () => {
  const result = await runCommand([
    'config',
    'workspace',
    'add',
    '--id',
    'ws-token',
    '--name',
    'Workspace Token',
    '--path',
    '/tmp/ws-token',
    '--provider',
    'github',
    '--repo-owner',
    'acme',
    '--repo-name',
    'artifact-repo',
    '--repo-token',
    'workspace-token',
    '--json'
  ]);
  const output = parseJsonOutput<{ artifactRepo?: { token?: string } }>(result.stdout);

  expect(output.ok).toBe(true);
  expect(output.data.artifactRepo?.token).toBe('workspace-token');

  const listResult = await runCommand(['config', 'workspace', 'list', '--json']);
  const listOutput = parseJsonOutput<{ workspaces: Array<{ artifactRepo?: { token?: string } }> }>(listResult.stdout);

  expect(listOutput.data.workspaces[0]?.artifactRepo?.token).toBe('workspace-token');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm vitest run tests/unit/cli-program.core.test.ts --runInBand
```

Expected: FAIL，原因应是 unknown option `--repo-token`。

- [ ] **Step 3: 扩展 CLI 输入类型**

在 `src/cli/commands/config-commands.ts` 中把类型改成：

```ts
interface ArtifactRepoInput {
  provider?: string;
  repoOwner?: string;
  repoName?: string;
  repoToken?: string;
}

interface ArtifactRepoConfig {
  provider: 'github' | 'gitlab';
  owner: string;
  name: string;
  token?: string;
}
```

- [ ] **Step 4: 给 workspace add 增加 token option**

把 `configWorkspace.command('add')...` 链式定义改成包含：

```ts
.option('--repo-token <token>', 'artifact repo git token')
```

对应 action 的 options 类型改成：

```ts
(options: { id: string; name: string; path: string; provider?: string; repoOwner?: string; repoName?: string; repoToken?: string; layer?: string; json?: boolean }) => {
```

- [ ] **Step 5: 让 parser 接受 token**

把 `parseArtifactRepoInput` 开头和返回值改成：

```ts
  const hasArtifactRepoInput = options.provider !== undefined || options.repoOwner !== undefined || options.repoName !== undefined || options.repoToken !== undefined;
```

在 repo segment 校验之后新增：

```ts
  const token = options.repoToken?.trim();
  if (options.repoToken !== undefined && !token) {
    printResult(io, fail('config.workspace.add', 'INVALID_ARTIFACT_REPO_CONFIG', 'Artifact repo token must be a non-empty string when provided', {}, ['Provide a non-empty --repo-token value, or omit it']), asJson);
    process.exitCode = 1;
    return null;
  }
```

把 return 改成：

```ts
  return { provider: options.provider, owner: options.repoOwner, name: options.repoName, ...(token ? { token } : {}) };
```

- [ ] **Step 6: 运行 CLI 测试确认通过**

Run:

```bash
pnpm vitest run tests/unit/cli-program.core.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 7: 提交检查点**

仅当用户明确授权提交时执行：

```bash
git add src/cli/commands/config-commands.ts tests/unit/cli-program.core.test.ts
git commit -m "feat: write artifact repo token from workspace cli"
```

---

### Task 3: Artifact sync 使用 workspace token

**Files:**
- Modify: `src/services/artifacts/workspace-service.ts:80-110,143-165,183-186`
- Test: `tests/unit/workspace-service-git-auth.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `tests/unit/workspace-service-git-auth.test.ts` 的现有 `describe` 内新增测试：

```ts
test('prefers workspace artifact repo token over GH_TOKEN', async () => {
  vi.stubEnv('GH_TOKEN', 'env-token');
  currentWorkspace = {
    workspaceId: 'ws-auth',
    name: 'Auth Workspace',
    rootPath: join(tmpdir(), `peaks-auth-${Date.now()}`),
    artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo', token: 'workspace-token' },
    installedCapabilityIds: []
  };

  const result = await executeArtifactSync();
  const expectedAuth = Buffer.from('x-access-token:workspace-token', 'utf-8').toString('base64');

  expect(result.success).toBe(true);
  expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${expectedAuth}`);
});
```

再新增 GitLab token 测试：

```ts
test('uses workspace token for GitLab artifact repo auth', async () => {
  currentWorkspace = {
    workspaceId: 'ws-gitlab-auth',
    name: 'GitLab Auth Workspace',
    rootPath: join(tmpdir(), `peaks-gitlab-auth-${Date.now()}`),
    artifactRepo: { provider: 'gitlab', owner: 'acme', name: 'artifact-repo', token: 'workspace-token' },
    installedCapabilityIds: []
  };

  const result = await executeArtifactSync();
  const expectedAuth = Buffer.from('oauth2:workspace-token', 'utf-8').toString('base64');

  expect(result.success).toBe(true);
  expect(result.remoteUrl).toBe('https://gitlab.com/acme/artifact-repo.git');
  expect(execCalls[0]?.env?.GIT_CONFIG_KEY_0).toBe('http.https://gitlab.com/.extraheader');
  expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${expectedAuth}`);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm vitest run tests/unit/workspace-service-git-auth.test.ts --runInBand
```

Expected: FAIL，原因应是 workspace token 未被使用，GitLab token auth env 未生成。

- [ ] **Step 3: 实现 token 选择逻辑**

在 `src/services/artifacts/workspace-service.ts` 中替换 `getGitAuthEnv`：

```ts
function getArtifactRepoToken(artifactRepo: WorkspaceConfig['artifactRepo']): string | undefined {
  if (!artifactRepo) return undefined;
  const workspaceToken = artifactRepo.token?.trim();
  if (workspaceToken) return workspaceToken;
  return artifactRepo.provider === 'github' ? process.env.GH_TOKEN : process.env.GITLAB_TOKEN;
}

function getGitAuthEnv(artifactRepo: WorkspaceConfig['artifactRepo']): NodeJS.ProcessEnv | undefined {
  if (!artifactRepo) return undefined;

  const token = getArtifactRepoToken(artifactRepo);
  if (!token) return undefined;

  const authUser = artifactRepo.provider === 'github' ? 'x-access-token' : 'oauth2';
  const authHost = artifactRepo.provider === 'github' ? 'github.com' : 'gitlab.com';
  const authValue = Buffer.from(`${authUser}:${token}`, 'utf-8').toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://${authHost}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authValue}`
  };
}
```

- [ ] **Step 4: 保持现有 GitHub fallback 测试通过**

现有测试 `uses public clone URL and passes GitHub auth separately` 不需要删除。它继续验证没有 workspace token 时使用 `GH_TOKEN`。

- [ ] **Step 5: 运行 artifact auth 测试确认通过**

Run:

```bash
pnpm vitest run tests/unit/workspace-service-git-auth.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 6: 提交检查点**

仅当用户明确授权提交时执行：

```bash
git add src/services/artifacts/workspace-service.ts tests/unit/workspace-service-git-auth.test.ts
git commit -m "feat: authenticate artifact sync with workspace token"
```

---

### Task 4: README 示例与全量验证

**Files:**
- Modify: `README.md:70-110`
- Modify: `README-en.md:70-110`
- Test: package scripts

- [ ] **Step 1: 更新中文 README 示例**

把 `README.md` 的 workspace 示例中 `artifactRepo` 改成：

```json
      "artifactRepo": {
        "provider": "github",
        "owner": "YOUR_ARTIFACT_REPO_OWNER",
        "name": "YOUR_ARTIFACT_REPO_NAME",
        "token": "YOUR_GIT_TOKEN"
      }
```

把说明区相关 bullet 改成：

```md
- artifact repo 是中间产物和 `.claude/memory` 共用的 git 仓库，不是目标代码仓库。
- `artifactRepo.token` 是该仓库对应的 git token，目前直接存放在 workspace 配置中。
- 中间产物和 `.claude/memory` 不要写进目标仓库。
```

- [ ] **Step 2: 更新英文 README 示例**

把 `README-en.md` 的 workspace 示例中 `artifactRepo` 改成：

```json
      "artifactRepo": {
        "provider": "github",
        "owner": "YOUR_ARTIFACT_REPO_OWNER",
        "name": "YOUR_ARTIFACT_REPO_NAME",
        "token": "YOUR_GIT_TOKEN"
      }
```

把说明区相关 bullet 改成：

```md
- The artifact repo is the shared git repository for intermediate artifacts and `.claude/memory`; it is not the target code repository.
- `artifactRepo.token` is the git token for that repository and is currently stored directly in the workspace config.
- Do not write intermediate artifacts or `.claude/memory` into the target repository.
```

- [ ] **Step 3: 运行目标测试**

Run:

```bash
pnpm vitest run tests/unit/config-service.test.ts tests/unit/cli-program.core.test.ts tests/unit/workspace-service-git-auth.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 4: 运行 typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS，无 TypeScript errors。

- [ ] **Step 5: 运行全量测试**

Run:

```bash
pnpm test
```

Expected: PASS。

- [ ] **Step 6: 查看 git diff**

Run:

```bash
git diff -- src/services/config/config-types.ts src/services/config/config-service.ts src/cli/commands/config-commands.ts src/services/artifacts/workspace-service.ts tests/unit/config-service.test.ts tests/unit/cli-program.core.test.ts tests/unit/workspace-service-git-auth.test.ts README.md README-en.md
```

Expected: diff 只包含 workspace artifact repo token 相关改动。

- [ ] **Step 7: 最终提交检查点**

仅当用户明确授权提交时执行：

```bash
git add README.md README-en.md
git commit -m "docs: document workspace artifact repo token"
```

---

## 自查结果

- Spec 覆盖：计划覆盖了配置形状、单仓共用、CLI 写入、sync 使用 token、`GH_TOKEN` fallback、README 和测试。
- 占位符扫描：没有 `TBD`、`TODO`、`implement later` 或未定义函数名。
- 类型一致性：统一使用 `artifactRepo.token`、`--repo-token`、`WorkspaceConfig['artifactRepo']`。
- 安全/范围说明：按用户确认，workspace git token 直接存储且配置展示不做额外脱敏；计划不引入单独 `memoryRepo`。
