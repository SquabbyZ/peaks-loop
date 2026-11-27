/**
 * The page writer for direction prototypes: one complete, independently
 * openable document per block set, carrying the shared preview marker.
 */
import { escapeHtml, pageHead } from './layout-preview.js';
import type {
  PrototypeBlock,
  PrototypeSection,
  ResolvedComponent
} from './layout-prototype-model.js';

/** Component names and prop values come from JSON, so an attribute is escaped too. */
function attribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** A prop name is an attribute NAME, where entities are not decoded; keep it a token. */
function attributeTail(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** A resolved component contributes its name and the props this prototype uses. */
function componentMarkup(component: ResolvedComponent): string {
  const name = ` data-peaks-component="${attribute(component.name)}"`;
  const props = Object.entries(component.props)
    .map(([prop, value]) => ` data-peaks-prop-${attributeTail(prop)}="${attribute(value)}"`)
    .join('');
  return `${name}${props}`;
}

function blockMarkup(block: PrototypeBlock, outline: boolean): string {
  const border = outline ? 'border:1px solid currentColor;' : '';
  return [
    `<div data-block="${block.blockId}" role="${block.role}"`,
    ` data-peaks-object="${attribute(block.blockId)}"`,
    block.component === null ? '' : componentMarkup(block.component),
    ` style="display:block;position:relative;width:100%;${border}">`,
    escapeHtml(block.text),
    '</div>'
  ].join('');
}

/** One complete preview page over a block set; the same inputs yield the same bytes. */
export function renderPrototypePage(
  name: string,
  blocks: readonly PrototypeBlock[],
  section: PrototypeSection,
  outline: boolean
): string {
  const inner = blocks.map((block) => blockMarkup(block, outline)).join('\n');
  const wrapper = section.flat
    ? inner
    : [
        '<main role="main">',
        `<section role="region" data-section="${section.id}" style="display:block;padding-left:${section.value}">`,
        inner,
        '</section>',
        '</main>'
      ].join('\n');
  return [
    pageHead(),
    `<body role="document" data-prototype="${name}" style="margin:0">`,
    wrapper,
    '</body>',
    '</html>',
    ''
  ].join('\n');
}
