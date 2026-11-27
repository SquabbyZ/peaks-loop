/**
 * The page writer for direction prototypes: one complete, independently
 * openable document per block set, carrying the shared preview marker.
 */
import { escapeHtml, pageHead } from './layout-preview.js';
import type { PrototypeBlock, PrototypeSection } from './layout-prototype-model.js';

function blockMarkup(block: PrototypeBlock, outline: boolean): string {
  const border = outline ? 'border:1px solid currentColor;' : '';
  return [
    `<div data-block="${block.blockId}" role="${block.role}"`,
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
