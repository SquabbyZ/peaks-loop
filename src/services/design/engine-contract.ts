/**
 * The render engine contract — `design/engine.json`.
 *
 * `render.url` is deliberately `null` by default: a fixed address is written
 * only after the user explicitly confirms one. `startPolicy` records consent:
 * `never` means peaks only probes a URL it is given, while `on-request` allows
 * an explicit `--start` to launch the recorded command. `peaks design init
 * --start <command>` records `on-request`; a hand-edited `never` is refused.
 *
 * `validateEngineContract` is the judge behind the tolerant reader: engine.json
 * is user-editable, so a wrong type must become a blocked CONTRACT, not a crash.
 */

export type StartPolicy = 'never' | 'on-request';

export type EngineContractFile = {
  schemaVersion: 1;
  contractVersion: string | null;
  engine: {
    name: 'designlang';
    supportedMajor: number;
  };
  render: {
    startCommand: string | null;
    cwd: string;
    port: number;
    path: string;
    pages: string[];
    startPolicy: StartPolicy;
    url: string | null;
  };
  archetypes: string[];
};

export type EngineContractInput = {
  cwd: string;
  startCommand: string | null;
  port: number;
  pages: readonly string[];
  archetypes: readonly string[];
};

const MAX_PORT = 65_535;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPort(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PORT;
}

function isString(value: unknown): boolean {
  return typeof value === 'string';
}

function isNullableString(value: unknown): boolean {
  return value === null || isString(value);
}

function isStartPolicy(value: unknown): boolean {
  return value === 'never' || value === 'on-request';
}

type RenderRule = {
  key: keyof EngineContractFile['render'];
  valid: (value: unknown) => boolean;
  message: string;
};

/** One row per render field: the predicate and the sentence a violation reports. */
const RENDER_RULES: readonly RenderRule[] = [
  {
    key: 'startCommand',
    valid: isNullableString,
    message: 'render.startCommand must be a string or null'
  },
  { key: 'url', valid: isNullableString, message: 'render.url must be a string or null' },
  { key: 'cwd', valid: isString, message: 'render.cwd must be a string' },
  { key: 'path', valid: isString, message: 'render.path must be a string' },
  { key: 'port', valid: isPort, message: 'render.port must be an integer between 0 and 65535' },
  { key: 'pages', valid: isStringArray, message: 'render.pages must be an array of strings' },
  {
    key: 'startPolicy',
    valid: isStartPolicy,
    message: 'render.startPolicy must be "never" or "on-request"'
  }
];

function renderProblems(render: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const rule of RENDER_RULES) {
    const value = render[rule.key];
    if (value !== undefined && !rule.valid(value)) problems.push(rule.message);
  }
  return problems;
}

function engineProblems(engine: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (engine.name !== undefined && engine.name !== 'designlang') {
    problems.push('engine.name must be "designlang"');
  }
  if (engine.supportedMajor !== undefined) {
    const major = engine.supportedMajor;
    if (typeof major !== 'number' || !Number.isInteger(major) || major < 1) {
      problems.push('engine.supportedMajor must be a positive integer');
    }
  }
  return problems;
}

function headerProblems(raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    problems.push('schemaVersion must be 1');
  }
  if (raw.contractVersion !== undefined && !isNullableString(raw.contractVersion)) {
    problems.push('contractVersion must be a string or null');
  }
  return problems;
}

/** A named object section: absent is fine, present-but-wrong-type is one message. */
function sectionProblems(
  value: unknown,
  name: string,
  inspect: (record: Record<string, unknown>) => string[]
): string[] {
  if (value === undefined) return [];
  return isRecord(value) ? inspect(value) : [`${name} must be an object`];
}

/** Every type problem in an `engine.json` body; an empty list means it may be read. */
export function validateEngineContract(raw: unknown): string[] {
  if (!isRecord(raw)) return ['the file must contain a JSON object'];
  return [
    ...headerProblems(raw),
    ...sectionProblems(raw.engine, 'engine', engineProblems),
    ...sectionProblems(raw.render, 'render', renderProblems),
    ...(raw.archetypes !== undefined && !isStringArray(raw.archetypes)
      ? ['archetypes must be an array of strings']
      : [])
  ];
}

export function buildEngineContract(input: EngineContractInput): EngineContractFile {
  const hasCommand = input.startCommand !== null && input.startCommand.trim() !== '';
  return {
    schemaVersion: 1,
    contractVersion: null,
    engine: { name: 'designlang', supportedMajor: 13 },
    render: {
      startCommand: input.startCommand,
      cwd: input.cwd,
      port: input.port,
      path: '/',
      pages: [...input.pages],
      startPolicy: hasCommand ? 'on-request' : 'never',
      url: null
    },
    archetypes: [...input.archetypes]
  };
}
