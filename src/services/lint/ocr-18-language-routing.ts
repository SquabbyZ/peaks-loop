/**
 * The OCR 1.x language routing table — the single source of truth for which
 * language a file belongs to.
 *
 * The pinned CLI has NO language flag (`--filter-language` is not a flag of the
 * real binary), so routing happens AFTER `ocr review` returns: ONE review runs
 * over the whole range and each returned comment is attributed to a language by
 * the extension of its path. `OCR_18_LANGUAGES`, the extension lookup and
 * `--languages` token resolution are all derived from `LANGUAGE_EXTENSIONS`, so a
 * language cannot be routed without an extension entry.
 *
 * `ocr-18-allowlist.ts` holds the vendored copy of the pinned runtime's own
 * allowlist; the routing test reddens if the two drift apart.
 */
import { normalizePath } from '../../shared/path-utils.js';

export const LANGUAGE_EXTENSIONS = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyi'],
  go: ['.go'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  rust: ['.rs'],
  c: ['.c'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
  csharp: ['.cs'],
  fsharp: ['.fs', '.fsi', '.fsx'],
  vbnet: ['.vb'],
  ruby: ['.rb', '.rake', '.gemspec'],
  php: ['.php', '.phtml'],
  swift: ['.swift'],
  objc: ['.m', '.mm'],
  scala: ['.scala'],
  groovy: ['.groovy', '.gradle'],
  shell: ['.sh', '.bash', '.zsh', '.fish'],
  powershell: ['.ps1'],
  sql: ['.sql'],
  r: ['.r'],
  lua: ['.lua'],
  perl: ['.pl', '.pm'],
  elixir: ['.ex', '.exs'],
  erlang: ['.erl', '.hrl'],
  dart: ['.dart'],
  julia: ['.jl'],
  haskell: ['.hs', '.lhs'],
  nim: ['.nim', '.nims', '.nimble'],
  ocaml: ['.ml', '.mli'],
  reasonml: ['.re', '.rei'],
  elm: ['.elm'],
  zig: ['.zig'],
  solidity: ['.sol'],
  vyper: ['.vy'],
  rego: ['.rego'],
  verilog: ['.v', '.sv', '.vh'],
  vhdl: ['.vhd', '.vhdl'],
  terraform: ['.tf', '.tfvars', '.hcl'],
  protobuf: ['.proto'],
  graphql: ['.graphql', '.gql'],
  prisma: ['.prisma'],
  thrift: ['.thrift'],
  capnp: ['.capnp'],
  jsonnet: ['.jsonnet', '.libsonnet'],
  nix: ['.nix'],
  bicep: ['.bicep'],
  cmake: ['.cmake'],
  arkts: ['.ets'],
  astro: ['.astro'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  pug: ['.pug'],
  freemarker: ['.ftl', '.ftlh', '.ftlx'],
  handlebars: ['.hbs', '.mustache'],
  jinja: ['.jinja2', '.j2']
} as const;

export type Ocr18Language = keyof typeof LANGUAGE_EXTENSIONS;

export const OCR_18_LANGUAGES = Object.keys(LANGUAGE_EXTENSIONS) as readonly Ocr18Language[];

/** Extension (lower-case, leading dot) to the language it routes to. */
const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, Ocr18Language> = new Map(
  (Object.entries(LANGUAGE_EXTENSIONS) as Array<[Ocr18Language, readonly string[]]>).flatMap(
    ([language, extensions]) =>
      extensions.map((extension) => [extension, language] as [string, Ocr18Language])
  )
);

/** The lower-cased extension of `filePath` (leading dot), or `''` when it has none. */
function extensionOf(filePath: string): string {
  const normalized = normalizePath(filePath);
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

/**
 * The routed language `filePath` belongs to, or `null` when it is not a routed
 * format. Three deliberate decisions, all documented rather than assumed:
 *
 * - `.mts` / `.cts` are TypeScript to the PRD, but the pinned 1.13.1 allowlist
 *   omits them and `ocr review --preview` reports them `unsupported_ext`.
 *   Routing them would report "typescript: 0 findings" for files the CLI never
 *   read, so they surface as unsupported files instead.
 * - `.h` is genuinely ambiguous between C and C++. It stays under `cpp` because
 *   that is the surface this slice inherited: at `194eccf5`, `--language cpp`
 *   matched `.h`, and moving it would silently change a single-language result
 *   (the PRD's preserved-behaviour clause). Reassigning it is a deliberate
 *   breaking change and needs its own decision, not a "fix" in passing. One file
 *   maps to one language on purpose: a double assignment would count the same
 *   comment in two `byLanguage` buckets and make the outcome shapes dishonest.
 * - `.m` is claimed by both Objective-C and MATLAB upstream and cannot be told
 *   apart by extension; it routes to Objective-C, the far more common reading.
 */
export function languageForPath(filePath: string): Ocr18Language | null {
  return LANGUAGE_BY_EXTENSION.get(extensionOf(filePath)) ?? null;
}

export function isSupportedLanguage(value: string): value is Ocr18Language {
  return (OCR_18_LANGUAGES as readonly string[]).includes(value);
}

/** A language name, or an extension token (`.ts` / `ts`), resolved through the table. */
function resolveLanguageToken(token: string): Ocr18Language | null {
  const lower = token.toLowerCase();
  if (isSupportedLanguage(lower)) return lower;
  return LANGUAGE_BY_EXTENSION.get(lower.startsWith('.') ? lower : `.${lower}`) ?? null;
}

/**
 * Parse a `--languages` value: `auto`, or a comma-separated list of language
 * names / extensions (`ts,js,go` or `.ts,.js,go`). Extensions are resolved
 * through the same routing table, so a token cannot name a language the table
 * does not route.
 *
 * @throws Error with `code: 'LANGUAGE_UNSUPPORTED'` on an unknown or empty token.
 */
export function parseLanguageSelection(
  spec: string
):
  | { readonly auto: true; readonly languages: null }
  | { readonly auto: false; readonly languages: readonly Ocr18Language[] } {
  const tokens = spec
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const only = tokens[0];
  if (tokens.length === 1 && only !== undefined && only.toLowerCase() === 'auto') {
    return { auto: true, languages: null };
  }
  const languages: Ocr18Language[] = [];
  for (const token of tokens) {
    const language = resolveLanguageToken(token);
    if (language === null) {
      throw Object.assign(new Error(`unsupported language: ${token}`), {
        code: 'LANGUAGE_UNSUPPORTED'
      });
    }
    if (!languages.includes(language)) languages.push(language);
  }
  if (languages.length === 0) {
    throw Object.assign(new Error('no language given'), { code: 'LANGUAGE_UNSUPPORTED' });
  }
  return { auto: false, languages };
}
