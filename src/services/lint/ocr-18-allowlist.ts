/**
 * Vendored snapshot of the extension allowlist compiled into the PINNED OCR
 * runtime, plus the explicit list of allowlisted formats this project does not
 * route to a language.
 *
 * Source: `alibaba/open-code-review`, `internal/config/allowlist/supported_file_types.json`
 * at tag `v1.13.1` (the version `OCR_18_PACKAGE` pins) — 115 entries. This is a
 * SNAPSHOT, not a live binding: the binary embeds its own copy at build time, so
 * a pin bump must update this file together with `OCR_18_PACKAGE`. The partition
 * test in `tests/unit/services/lint/ocr-multilang-adapter.test.ts` reddens when
 * the routing table and `OCR_18_EXCLUDED_EXTENSIONS` stop covering it exactly,
 * which is how an upstream addition surfaces instead of being silently ignored.
 *
 * Empirical control (2026-10-20, ocr 1.13.1 on win32-x64): a scratch repository
 * holding one file per extension was run through `ocr review --preview`. Every
 * extension below was listed under "Will review"; `.mts`, `.cts` and `.glsl`
 * were listed under "Excluded from review (unsupported_ext)". `.glsl` is in the
 * HEAD allowlist but not in v1.13.1, which is why the tag — not HEAD — is the
 * source here.
 */
export const OCR_18_ALLOWLIST_V1_13_1: readonly string[] = [
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  '.py',
  '.pyi',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hxx',
  '.cs',
  '.vb',
  '.fs',
  '.fsi',
  '.fsx',
  '.go',
  '.rs',
  '.rb',
  '.rake',
  '.gemspec',
  '.php',
  '.phtml',
  '.swift',
  '.m',
  '.mm',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.sql',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.ftl',
  '.ftlh',
  '.ftlx',
  '.hbs',
  '.mustache',
  '.jinja2',
  '.j2',
  '.pug',
  '.astro',
  '.vue',
  '.ipynb',
  '.svelte',
  '.xml',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.ini',
  '.env',
  '.gradle',
  '.cmake',
  '.r',
  '.lua',
  '.pl',
  '.pm',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.ets',
  '.json5',
  '.dart',
  '.tf',
  '.graphql',
  '.gql',
  '.prisma',
  '.jl',
  '.hcl',
  '.tfvars',
  '.bicep',
  '.proto',
  '.nix',
  '.hs',
  '.lhs',
  '.nim',
  '.nims',
  '.nimble',
  '.elm',
  '.properties',
  '.po',
  '.pot',
  '.jsonnet',
  '.libsonnet',
  '.zig',
  '.thrift',
  '.capnp',
  '.ml',
  '.mli',
  '.re',
  '.rei',
  '.v',
  '.sv',
  '.vh',
  '.vhd',
  '.vhdl',
  '.sol',
  '.vy',
  '.rego'
];

/**
 * Allowlisted formats this project deliberately does NOT route to a language.
 *
 * The PRD routes source languages only: markup, stylesheets, data/config and
 * notebook containers carry no source semantics to review per language. They
 * are still reviewed by the CLI — they are simply not attributed to a language,
 * so they never appear as a routed language with a misleading zero.
 */
export const OCR_18_EXCLUDED_EXTENSIONS: Readonly<Record<string, string>> = {
  '.css': 'stylesheet, not source',
  '.scss': 'stylesheet, not source',
  '.sass': 'stylesheet, not source',
  '.less': 'stylesheet, not source',
  '.html': 'markup, not source',
  '.htm': 'markup, not source',
  '.xml': 'markup/data, not source',
  '.yaml': 'data/config, not source',
  '.yml': 'data/config, not source',
  '.json': 'data/config, not source',
  '.json5': 'data/config, not source',
  '.toml': 'data/config, not source',
  '.ini': 'data/config, not source',
  '.env': 'data/config, not source',
  '.properties': 'data/config, not source',
  '.po': 'translation catalogue, not source',
  '.pot': 'translation catalogue, not source',
  '.ipynb': 'notebook container, not source'
};
