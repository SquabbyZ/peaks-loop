/**
 * The REGISTRATION profile of one harness's MCP entry point (spec §8.3).
 *
 * WHY THIS IS NOT `IdeMcpProfile`. That profile (on `IdeAdapter.mcp`) answers
 * "how does this harness SPELL a peaks tool name", which the pre-tool branch
 * needs. This one answers "how does this harness register a server", which only
 * the distribution path needs. One field would conflate two questions asked by
 * two callers that never run together.
 *
 * WHY IT DECLARES ARGV AND NOT A COMMAND STRING. Registering is the HARNESS's
 * own operation: `peaks mcp install` calls the harness's entry point rather than
 * hand-editing the harness's config file, because that file is full of the
 * user's state and hand-editing it is neither safe nor version-stable (§8.3).
 * The entry is declared as an ARRAY with three placeholders, so the engine that
 * consumes it substitutes values into an array and never builds a command line.
 *
 * WHY add AND remove ARE BOTH DECLARED. A harness's register verb is not
 * idempotent — same name, same scope, and it fails, with no `--force` and no
 * `update` — so the install is delete-then-add (§8.3). Both halves are therefore
 * part of the contract, and `scopes` exists because the entry can already sit in
 * more than one of them: the delete is a sweep, not a targeted call.
 *
 * WHAT IS DELIBERATELY ABSENT: any harness name, any platform name, and any
 * branch on either. A vendor's own spellings belong in its adapter, which is the
 * only module that fills this type in.
 */

/** Placeholder for the server key the harness files peaks under. */
export const MCP_NAME_PLACEHOLDER = '<name>';
/** Placeholder for one scope the entry can live in; substituted once per removal. */
export const MCP_SCOPE_PLACEHOLDER = '<scope>';
/** Placeholder for the launched server argv — the command and every token after it. */
export const MCP_SERVER_ARGV_PLACEHOLDER = '<server-argv>';

/** The placeholders an argv template may carry, and nothing else may look like one. */
export const MCP_ARGV_PLACEHOLDERS = [
  MCP_NAME_PLACEHOLDER,
  MCP_SCOPE_PLACEHOLDER,
  MCP_SERVER_ARGV_PLACEHOLDER
] as const;

/**
 * How one harness registers, and unregisters, a peaks MCP server.
 *
 * Optional on `IdeAdapter`, like `skillInstall?` / `standardsProfile?`: an
 * adapter that omits it is declaring "this harness has no registration entry
 * peaks may call", and every consumer reads that as "nothing to do" rather than
 * as an error.
 */
export interface IdeMcpInstallProfile {
  /** The server key this harness files peaks under. The install touches only this one. */
  readonly serverName: string;
  /**
   * Every scope the entry can live in. The delete sweeps all of them, because a
   * previous install may have written a different one and the harness's own
   * removal fails on the scope that is empty.
   */
  readonly scopes: readonly string[];
  /** The scope the entry is (re-)written to. Must be one of `scopes`. */
  readonly targetScope: string;
  /** argv template that registers the server. Carries `<name>` and `<server-argv>`. */
  readonly addArgv: readonly string[];
  /** argv template that unregisters it. Carries `<name>` and `<scope>`. */
  readonly removeArgv: readonly string[];
}

/** The values an argv template is expanded with. */
export interface McpArgvValues {
  readonly serverName: string;
  readonly scope: string;
  readonly serverArgv: readonly string[];
}

/** A refusal, as the validator's single failure channel. */
type Refuse = (reason: string) => never;

/**
 * One template's structural requirements: it must carry something, its
 * bracket-shaped tokens must be ones the engine knows how to substitute, and the
 * placeholders the caller needs in it must be there. An unknown placeholder is a
 * refusal rather than a literal, because passing it through would hand the
 * harness an argument that means nothing to it.
 */
function assertArgvTemplate(
  label: string,
  argv: readonly string[],
  required: readonly string[],
  refuse: Refuse
): void {
  if (argv.length === 0) refuse(`${label} is empty`);
  for (const token of argv) {
    const bracketShaped = token.startsWith('<') && token.endsWith('>');
    const known = (MCP_ARGV_PLACEHOLDERS as readonly string[]).includes(token);
    if (bracketShaped && !known) refuse(`${label} carries unknown placeholder '${token}'`);
  }
  for (const placeholder of required) {
    if (!argv.includes(placeholder)) refuse(`${label} does not carry ${placeholder}`);
  }
}

/**
 * A declaration that cannot drive an install is a defect in the adapter, and it
 * is reported as one rather than silently producing an argv the harness will
 * reject. That is the whole argument for throwing here: a profile missing its
 * server-argv placeholder would install a registration that launches nothing,
 * and nothing would say so.
 */
export function assertMcpInstallProfile(profile: IdeMcpInstallProfile): void {
  const refuse: Refuse = (reason) => {
    throw new Error(`IdeMcpInstallProfile is not installable: ${reason}`);
  };
  if (profile.serverName.length === 0) refuse('serverName is empty');
  if (profile.scopes.length === 0) refuse('scopes is empty');
  if (!profile.scopes.includes(profile.targetScope)) {
    refuse(`targetScope '${profile.targetScope}' is not one of the declared scopes`);
  }
  assertArgvTemplate(
    'addArgv',
    profile.addArgv,
    [MCP_NAME_PLACEHOLDER, MCP_SCOPE_PLACEHOLDER, MCP_SERVER_ARGV_PLACEHOLDER],
    refuse
  );
  assertArgvTemplate(
    'removeArgv',
    profile.removeArgv,
    [MCP_NAME_PLACEHOLDER, MCP_SCOPE_PLACEHOLDER],
    refuse
  );
}

/**
 * Expand one argv template. A placeholder that stands for SEVERAL tokens expands
 * to all of them, which is why this returns an array and why the launched server
 * argv is passed as one: the caller never joins and never splits.
 */
export function expandMcpArgv(argv: readonly string[], values: McpArgvValues): readonly string[] {
  const expanded: string[] = [];
  for (const token of argv) {
    if (token === MCP_NAME_PLACEHOLDER) {
      expanded.push(values.serverName);
      continue;
    }
    if (token === MCP_SCOPE_PLACEHOLDER) {
      expanded.push(values.scope);
      continue;
    }
    if (token === MCP_SERVER_ARGV_PLACEHOLDER) {
      expanded.push(...values.serverArgv);
      continue;
    }
    expanded.push(token);
  }
  return expanded;
}
