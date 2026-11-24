/**
 * Render `design/contract.md` — the nine-section design contract prose.
 *
 * The renderer fills the facts it can see: the app path, the scanned token
 * counts, and the derived primary colour. The primary is written twice on
 * purpose — as YAML front matter, which is the only place `designlang
 * verify-ui --brand` reads it from, and as prose that names the token it came
 * from. Every other section body is a starting point the user edits. A project
 * with no source token system says so explicitly rather than shipping an
 * empty-looking contract that reads like an observation.
 */

import { toRenderableColor } from './css-color.js';

/** The scanned token totals the contract reports. */
export type DesignContractTokenCounts = {
  color: number;
  space: number;
  font: number;
  radius: number;
};

/** The derived primary colour the contract records, with its provenance. */
export type DesignContractPrimary = {
  /** The token key as the token file spells it, e.g. `color-primary`. */
  readonly token: string;
  /** The token's literal value; quoted so the rendered colour is traceable. */
  readonly value: string;
};

export type DesignContractRenderInput = {
  /** The app root relative to the repository root; empty at the repository root. */
  readonly appRelPath: string;
  readonly tokenCounts: DesignContractTokenCounts;
  /** Absent or null when no colour token supplied a primary. */
  readonly primary?: DesignContractPrimary | null;
};

function appLabel(appRelPath: string): string {
  return appRelPath === '' ? 'the repository root' : `\`${appRelPath}\``;
}

function tokenSummary(counts: DesignContractTokenCounts): string[] {
  const total = counts.color + counts.space + counts.font + counts.radius;
  const lines = [
    `Source tokens: ${counts.color} color · ${counts.space} spacing · ${counts.font} typography · ${counts.radius} radius.`
  ];
  if (total === 0) {
    lines.push(
      '',
      '_No source token system was found; define the tokens here before relying on them._'
    );
  }
  return lines;
}

const SECTIONS: ReadonlyArray<{ heading: string; body: string[] }> = [
  {
    heading: 'Visual Theme & Atmosphere',
    body: ['Describe the mood in one or two sentences: dense or airy, warm or clinical.']
  },
  {
    heading: 'Color',
    body: [
      'Name the palette roles (surface, foreground, primary, destructive, muted) and the token that carries each.'
    ]
  },
  {
    heading: 'Typography',
    body: ['Record the font stack, the scale steps in use, and where each step is allowed.']
  },
  {
    heading: 'Spacing & Grid',
    body: ['Record the spacing scale and the layout grid; arbitrary spacing is a defect.']
  },
  {
    heading: 'Layout & Composition',
    body: ['Describe page shells, navigation regions, and the responsive breakpoints.']
  },
  {
    heading: 'Components',
    body: [
      'Name the component entrypoints pages may import from; direct UI-library imports are banned.'
    ]
  },
  {
    heading: 'Motion & Interaction',
    body: ['Record transitions, easing, and the states every interactive element must show.']
  },
  {
    heading: 'Voice & Brand',
    body: ['Record tone, capitalization, and the words the product does not use.']
  },
  {
    heading: 'Anti-patterns',
    body: [
      'List what must never ship: inline styles, raw colors, arbitrary Tailwind values, library bypasses.'
    ]
  }
];

/**
 * YAML front matter — the only shape `designlang verify-ui --brand` reads a
 * primary colour from. No colour means no front matter at all, never a
 * placeholder: the tool must keep refusing the file rather than compare
 * against an invented one.
 */
function primaryFrontMatter(primary: DesignContractPrimary | null | undefined): string[] {
  const renderable = primary == null ? null : toRenderableColor(primary.value);
  if (renderable === null) return [];
  return ['---', 'colors:', `  primary: "${renderable}"`, '---', ''];
}

/** The prose half: the rendered value, the token it came from, and its use. */
function primaryLines(primary: DesignContractPrimary | null | undefined): string[] {
  if (primary == null) {
    return ['_No colour token was found, so no primary colour is recorded._'];
  }
  const renderable = toRenderableColor(primary.value);
  if (renderable === null) {
    return [
      `Primary colour: \`${primary.value}\` (token \`${primary.token}\`).`,
      '_designlang verify-ui reads only hex or rgb colours, so the brand check stays blocked until this token carries one._'
    ];
  }
  const literal =
    primary.value.trim().toLowerCase() === renderable ? '' : `, literal \`${primary.value}\``;
  return [
    `Primary colour: \`${renderable}\` (token \`${primary.token}\`${literal}).`,
    `Usage: primary actions and the active navigation state; use token \`${primary.token}\`, never a raw colour literal.`
  ];
}

export function renderDesignContractMarkdown(input: DesignContractRenderInput): string {
  const lines = [
    ...primaryFrontMatter(input.primary),
    `# Design contract — ${appLabel(input.appRelPath)}`,
    '',
    '> Generated by `peaks design init`. The prose is yours to edit;',
    '> `peaks design init --force` backs the file up before rewriting it.',
    '',
    ...tokenSummary(input.tokenCounts),
    ''
  ];
  for (const section of SECTIONS) {
    const extra = section.heading === 'Color' ? primaryLines(input.primary) : [];
    lines.push(`## ${section.heading}`, ...section.body, ...extra, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
