import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  captureIo,
  disposeProjects,
  entryOf,
  FIXTURES,
  tempProject,
  textOf
} from './_layout-graph-fixtures.js';
import { registerDesignLayoutCommand } from '../../../src/cli/commands/design-layout-command.js';
import {
  graphRoot,
  routeSlug,
  writeEntry
} from '../../../src/services/design/layout/layout-graph-store.js';
import {
  densityOf,
  verifyRoundTrip
} from '../../../src/services/design/layout/layout-roundtrip.js';
import { rebuildHtml } from '../../../src/services/design/layout/layout-preview.js';

declareDimensions('tests/unit/design/layout-graph-preview.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

function renderedHtml(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
}

describe('(render) the direction preview', () => {
  it('when one entry is rebuilt twice, should produce identical bytes', () => {
    // given: the aligned entry
    // when: the preview is rebuilt twice
    // then: both results are the same string
    const first = rebuildHtml(entryOf('aligned'));
    const second = rebuildHtml(entryOf('aligned'));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.html).toBe(first.html);
  });

  it('when the preview is rebuilt, should place every node with an absolute offset', () => {
    // given: the mismatched entry
    // when: the preview is rebuilt
    // then: each element carries position:absolute and a box-sizing border box
    const rebuilt = rebuildHtml(entryOf('mismatched'));
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      expect(rebuilt.html).toContain('position:absolute');
      expect(rebuilt.html).toContain('box-sizing:border-box');
      expect(rebuilt.html).toContain('<body role="document"');
    }
  });
});

describe('(a11y) the direction-preview marking', () => {
  it('when the preview is opened, should carry an unmissable marker that does not cover the page top', () => {
    // given: a rebuilt preview
    // when: its head and stylesheet are read
    // then: the title, the meta tag and a fixed bottom banner all say it is a preview
    const rebuilt = rebuildHtml(entryOf('aligned'));
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      expect(rebuilt.html).toContain('<title>DIRECTION PREVIEW — NOT A REAL IMPLEMENTATION');
      expect(rebuilt.html).toContain('方向预览，不是真实实现');
      expect(rebuilt.html).toContain('content="direction-preview;not-an-implementation"');
      expect(rebuilt.html).toMatch(
        /body::before\{content:"[^"]*NOT A REAL IMPLEMENTATION[^"]*";position:fixed;bottom:0/
      );
      expect(rebuilt.html).toContain('border-top:');
      expect(rebuilt.html).toContain('background:');
    }
  });

  it('when the preview is rendered, should give the html element a box so the ancestor chain survives', () => {
    // given: a rebuilt preview
    // when: its stylesheet is read
    // then: the html element is forced to the viewport so the capture keeps it
    const rebuilt = rebuildHtml(entryOf('aligned'));
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect(rebuilt.html).toContain('html{min-width:100%;min-height:100%}');
  });
});

describe('(behavior) the round trip', () => {
  it('when an aligned route is rebuilt, should bring back every node and anchor', () => {
    // given: the aligned entry
    // when: the preview is measured again
    // then: the round trip reports every node and anchor unchanged
    const result = verifyRoundTrip(entryOf('aligned'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result).toEqual({ ok: true, nodes: 5, anchors: 1 });
  });

  it('when a mismatched route is rebuilt, should bring back the not-aligned anchor and both tokens', () => {
    // given: the mismatched entry
    // when: the preview is measured again
    // then: the round trip holds for its shared edge
    const result = verifyRoundTrip(entryOf('mismatched'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.anchors).toBe(1);
  });

  it('when an object carries an atomic child, should survive the round trip', () => {
    // given: a paragraph object with an image child
    // when: the preview is rebuilt and measured
    // then: the round trip holds and both nodes return
    const result = verifyRoundTrip(entryOf('object-child'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nodes).toBe(4);
  });

  it('when an object folded a painted card, should survive the round trip', () => {
    // given: a page whose card is one painted object folding its title and body
    // when: the preview is rebuilt and measured
    // then: the card's id and text come back even though it has no direct text
    const result = verifyRoundTrip(entryOf('card'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nodes).toBe(2);
  });

  it('when an inline element was folded into a heading, should survive the round trip', () => {
    // given: a heading whose text is split by an inline element
    // when: the preview is rebuilt and measured
    // then: the heading's subtree text and id come back
    const result = verifyRoundTrip(entryOf('inline'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nodes).toBe(3);
  });

  it('when a stored node text is changed after numbering, should fail the round trip', () => {
    // given: the aligned entry with one node's text replaced but its id kept
    // when: the round trip runs
    // then: the mismatch is reported rather than accepted
    const entry = entryOf('aligned');
    const target = entry.nodes[2];
    expect(target).toBeDefined();
    if (target !== undefined) entry.nodes[2] = { ...target, text: 'somewhere else entirely' };
    const result = verifyRoundTrip(entry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches.join(' ')).toContain('node');
  });

  it('when the entry has no body node, should refuse to rebuild it', () => {
    // given: an entry whose body node was removed
    // when: the preview is rebuilt
    // then: the refusal names the missing root
    const entry = entryOf('aligned');
    const rebuilt = rebuildHtml({
      ...entry,
      nodes: entry.nodes.filter((node) => node.tag !== 'body')
    });
    expect(rebuilt.ok).toBe(false);
    if (!rebuilt.ok) expect(rebuilt.reason).toContain('body');
  });
});

describe('(integration) token density', () => {
  it('when the graph is compared with the rendered HTML, should be smaller for both fixture routes', () => {
    // given: each fixture entry and the HTML it was measured from
    // when: both are counted with the repository token estimate
    // then: the graph is the smaller reading surface
    for (const name of ['aligned', 'mismatched']) {
      const entry = entryOf(name);
      expect(verifyRoundTrip(entry).ok).toBe(true);
      const density = densityOf(textOf(entry), renderedHtml(name));
      expect(density.asciiTokens).toBeLessThan(density.htmlTokens);
      expect(density.denser).toBe(true);
    }
  });
});

type Comparison = { verdict: string; reason?: string; from?: string; to?: string };

let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

function comparisonOf(envelope: Record<string, unknown>): Comparison {
  return (envelope.data as { comparison: Comparison }).comparison;
}

/** A project holding one entry at default@390x844 for the route `/`. */
function storedProject(): string {
  const root = tempProject();
  writeEntry(root, entryOf('aligned'));
  return root;
}

async function runLayout(
  root: string,
  args: readonly string[]
): Promise<{ envelope: Record<string, unknown>; text: string }> {
  const capture = captureIo();
  const program = new Command();
  const design = program.command('design');
  registerDesignLayoutCommand(design, capture.io);
  await program.parseAsync(['design', 'layout', ...args, '--project', root, '--json'], {
    from: 'user'
  });
  return { envelope: JSON.parse(capture.out()) as Record<string, unknown>, text: capture.out() };
}

describe('(behavior) the cross-key comparison verdict', () => {
  it('when the state differs, should name the state axis and both keys', async () => {
    // given: a stored default entry and an empty coordinate at the same viewport
    // when: read is asked to compare the two
    // then: the answer is not-comparable and names the state axis and both keys
    const { envelope, text } = await runLayout(storedProject(), [
      'read',
      '--route',
      '/',
      '--compare',
      'empty@390x844'
    ]);
    const comparison = comparisonOf(envelope);
    expect(comparison.verdict).toBe('not-comparable');
    expect(comparison.reason).toContain('state differ');
    expect(comparison.from).toContain('default@390x844');
    expect(comparison.to).toContain('empty@390x844');
    expect(text).not.toMatch(/aligned/);
  });

  it('when the viewport differs, should name the viewport axis and accept the same key', async () => {
    // given: a stored default entry at 390x844 and two comparison targets
    // when: read compares a 1280x800 target and then its own coordinate
    // then: the first is not-comparable on the viewport axis and the second is comparable
    const root = storedProject();
    const moved = await runLayout(root, ['read', '--route', '/', '--compare', 'default@1280x800']);
    expect(comparisonOf(moved.envelope).reason).toContain('viewport differ');
    const same = await runLayout(root, ['read', '--route', '/', '--compare', 'default@390x844']);
    expect(comparisonOf(same.envelope).verdict).toBe('comparable');
  });
});

describe('(integration) the comparison entry on rebuild and mix', () => {
  it('when rebuild compares a different state, should answer not-comparable and write no preview', async () => {
    // given: a stored entry and a comparison target in another state
    // when: rebuild runs with that comparison
    // then: it answers not-comparable and the preview directory does not exist
    const root = storedProject();
    const { envelope } = await runLayout(root, [
      'rebuild',
      '--route',
      '/',
      '--compare',
      'empty@390x844'
    ]);
    expect(comparisonOf(envelope).verdict).toBe('not-comparable');
    expect(existsSync(join(graphRoot(root), routeSlug('/'), 'preview'))).toBe(false);
  });

  it('when mix compares another viewport, should answer not-comparable without needing a move', async () => {
    // given: a stored entry and a comparison target at another viewport
    // when: mix runs with a syntactically valid move list
    // then: the comparison answers before any block work, so no mixed page is written
    const { envelope } = await runLayout(storedProject(), [
      'mix',
      '--route',
      '/',
      '--base',
      'stack',
      '--move',
      'a=b',
      '--compare',
      'default@1280x800'
    ]);
    expect(comparisonOf(envelope).verdict).toBe('not-comparable');
  });
});

describe('(a11y) the comparison text', () => {
  it('when a cross-key comparison is answered, should never print an aligned verdict', async () => {
    // given: the same comparison target for each command
    // when: read, rebuild and mix are each asked for it
    // then: every answer says not-comparable and none of them mentions aligned
    for (const command of ['read', 'rebuild', 'mix'] as const) {
      const args =
        command === 'mix'
          ? [command, '--route', '/', '--base', 'stack', '--move', 'a=b']
          : [command, '--route', '/'];
      const { envelope, text } = await runLayout(storedProject(), [
        ...args,
        '--compare',
        'empty@390x844'
      ]);
      expect(comparisonOf(envelope).verdict).toBe('not-comparable');
      expect(text).not.toMatch(/aligned/);
    }
  });

  it('when the coordinate is unreadable, should refuse with the expected shape', async () => {
    // given: a comparison target without a viewport
    // when: read runs
    // then: the refusal names the accepted shape and exits with the refused code
    const { envelope } = await runLayout(storedProject(), [
      'read',
      '--route',
      '/',
      '--compare',
      'default'
    ]);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('DESIGN_LAYOUT_COMPARE_INVALID');
    expect(String(envelope.message)).toContain('state@WxH');
    expect(process.exitCode).toBe(2);
  });
});
