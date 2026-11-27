// The component axis of a direction prototype: which block resolves to a
// declared component, what the page says about it, and when a direction is
// rejected. Dimensions:
//   - render:      the page markers and the byte-identical rerun;
//   - integration: the command's files, rejected.json and handoff candidates;
//   - behavior:    omitted — resolution is asserted through the rendered page
//                  and the command envelope, not as a separate return table;
//   - a11y:        omitted — no new human-facing sentence is added; the
//                  rejection reason is structured data in the envelope.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { captureIo, disposeProjects, entryOf, tempProject } from './_layout-graph-fixtures.js';
import { runDesignLayoutPrototype } from '../../../src/cli/commands/design-layout-prototype-command.js';
import type { ComponentCapabilities } from '../../../src/services/design/component-capabilities.js';
import {
  graphRoot,
  routeSlug,
  writeEntry
} from '../../../src/services/design/layout/layout-graph-store.js';
import {
  generatePrototypes,
  type Prototype
} from '../../../src/services/design/layout/layout-prototype.js';

declareDimensions(
  'tests/unit/design/layout-prototype-components.test.ts',
  ['render', 'integration'],
  [
    {
      dim: 'behavior',
      reason: 'resolution is asserted through the rendered page and the command envelope'
    },
    { dim: 'a11y', reason: 'the rejection reason is structured data; no new user-facing text' }
  ]
);

let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

const HEADING_CAPABILITIES: ComponentCapabilities = {
  Heading: { entrypoint: '@/components/ui/heading', props: { level: ['1', '2'] } }
};

const BUTTON_CAPABILITIES: ComponentCapabilities = {
  Button: {
    entrypoint: '@/components/ui/button',
    props: { variant: ['primary', 'secondary'] },
    roles: ['button']
  }
};

const EXPLICIT_HEADING_CAPABILITIES: ComponentCapabilities = {
  Heading: {
    entrypoint: '@/components/ui/heading',
    props: { level: ['1', '2'] },
    roles: ['  HEADING  ']
  }
};

const PARTIAL_HEADING_CAPABILITIES: ComponentCapabilities = {
  Heading: { entrypoint: '@/components/ui/heading', props: {}, roles: ['head'] }
};

const FALLBACK_HEADING_CAPABILITIES: ComponentCapabilities = {
  HeadingBlock: { entrypoint: '@/components/ui/heading', props: {} }
};

const ORDERED_HEADING_CAPABILITIES: ComponentCapabilities = {
  First: { entrypoint: '@/components/ui/heading', props: {}, roles: ['heading'] },
  Second: { entrypoint: '@/components/ui/heading', props: {}, roles: ['heading'] }
};

const ENTRYPOINTS = ['@/components/ui/heading', '@/components/ui/button'];

function generatedWith(capabilities: ComponentCapabilities): Prototype[] {
  const result = generatePrototypes(entryOf('aligned'), capabilities);
  if (!result.ok) throw new Error(result.reason);
  return result.prototypes;
}

function envelopeOf(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

/** A paved road a real project would carry: entrypoints plus the given components. */
function writeManifest(root: string, capabilities: ComponentCapabilities): void {
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({
      schemaVersion: 1,
      componentEntrypoints: ENTRYPOINTS,
      componentCapabilities: capabilities
    }),
    'utf8'
  );
}

function prototypePath(root: string, file: string): string {
  return join(graphRoot(root), routeSlug('/'), 'prototypes', file);
}

type PrototypeReport = {
  capabilities: string;
  prototypes: Array<{ name: string; path: string }>;
  kept: string[];
  capped: Array<{ name: string }>;
  rejected: Array<{ name: string; reason: string }>;
};

describe('(render) component markers', () => {
  it('when every role resolves, should mark every block with an object and the component it uses', () => {
    // given: an entry whose only role is heading and a manifest that declares Heading
    // when: the five directions are generated
    // then: every page carries an identity marker for every block and the component with its props
    const prototypes = generatedWith(HEADING_CAPABILITIES);
    expect(prototypes).toHaveLength(5);
    for (const prototype of prototypes) {
      expect(prototype.rejection).toBeNull();
      expect(prototype.html).toContain('data-peaks-object="');
      expect(prototype.html).toContain('data-peaks-component="Heading"');
      expect(prototype.html).toContain('data-peaks-prop-level="1"');
      expect(prototype.blocks.every((block) => block.component?.name === 'Heading')).toBe(true);
    }
  });

  it('when the same entry and manifest render twice, should produce byte-identical pages', () => {
    // given: one entry and one declared manifest
    // when: the five directions are generated twice
    // then: every page and every rejection is byte-identical between the runs
    const first = generatedWith(HEADING_CAPABILITIES);
    const second = generatedWith(HEADING_CAPABILITIES);
    expect(first.map((prototype) => prototype.html)).toEqual(
      second.map((prototype) => prototype.html)
    );
    expect(first.map((prototype) => prototype.rejection)).toEqual(
      second.map((prototype) => prototype.rejection)
    );
  });

  it('when a component declares roles, should match the role with case and padding ignored', () => {
    // given: a heading block and a component whose roles list spells heading with noise
    // when: the five directions are generated twice
    // then: every block resolves that component and both runs are byte-identical
    const first = generatedWith(EXPLICIT_HEADING_CAPABILITIES);
    const second = generatedWith(EXPLICIT_HEADING_CAPABILITIES);
    for (const prototype of first) {
      expect(prototype.rejection).toBeNull();
      expect(prototype.blocks.every((block) => block.component?.name === 'Heading')).toBe(true);
    }
    expect(first.map((prototype) => prototype.html)).toEqual(
      second.map((prototype) => prototype.html)
    );
  });

  it('when a declared role is only a substring of the block role, should not match it', () => {
    // given: a component that declares "head", a substring of the role "heading"
    // when: the five directions are generated
    // then: membership is exact, so no block resolves and every direction is rejected
    const prototypes = generatedWith(PARTIAL_HEADING_CAPABILITIES);
    for (const prototype of prototypes) {
      expect(prototype.rejection).not.toBeNull();
      expect(prototype.blocks.every((block) => block.component === null)).toBe(true);
    }
  });

  it('when a component declares no roles, should still match the role by name containment', () => {
    // given: a component named HeadingBlock with no roles declaration
    // when: the five directions are generated
    // then: the legacy fallback still resolves every heading block
    const prototypes = generatedWith(FALLBACK_HEADING_CAPABILITIES);
    for (const prototype of prototypes) {
      expect(prototype.rejection).toBeNull();
      expect(prototype.blocks.every((block) => block.component?.name === 'HeadingBlock')).toBe(
        true
      );
    }
  });

  it('when two components declare the role, should resolve the first one declared', () => {
    // given: two components that both declare heading, First before Second
    // when: the five directions are generated
    // then: every block resolves First, so declaration order decides
    const prototypes = generatedWith(ORDERED_HEADING_CAPABILITIES);
    for (const prototype of prototypes) {
      expect(prototype.blocks.every((block) => block.component?.name === 'First')).toBe(true);
    }
  });
});

describe('(integration) rejection and handoff', () => {
  it('when a used component is removed, should reject every related direction and keep it out of handoff', async () => {
    // given: a project whose manifest declares only Button while the entry's blocks are headings
    // when: the prototype command runs
    // then: every direction is written as rejected, rejected.json names why and nothing competes for the cap
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    writeManifest(root, BUTTON_CAPABILITIES);
    const capture = captureIo();
    await runDesignLayoutPrototype({ project: root, route: '/', json: true }, capture.io);
    const data = envelopeOf(capture.out()).data as PrototypeReport;
    expect(data.capabilities).toBe('declared');
    expect(data.rejected.map((entry) => entry.name)).toEqual([
      'stack',
      'outline',
      'roomy',
      'compact',
      'flat'
    ]);
    expect(data.rejected[0]?.reason).toContain('heading');
    expect(data.kept).toEqual([]);
    expect(data.capped).toEqual([]);
    expect(existsSync(prototypePath(root, 'stack.html'))).toBe(false);
    expect(existsSync(prototypePath(root, 'rejected-stack.html'))).toBe(true);
    const rejected = JSON.parse(
      readFileSync(prototypePath(root, 'rejected.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(rejected)).toEqual(['stack', 'outline', 'roomy', 'compact', 'flat']);
    expect(rejected.stack).toContain('heading');
  });

  it('when no manifest is declared, should filter nothing and keep the identity markers', async () => {
    // given: a project with no componentCapabilities section
    // when: the prototype command runs
    // then: nothing is rejected, the report says none, and every page still marks its objects
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const capture = captureIo();
    await runDesignLayoutPrototype({ project: root, route: '/', json: true }, capture.io);
    const data = envelopeOf(capture.out()).data as PrototypeReport;
    expect(data.capabilities).toBe('none');
    expect(data.rejected).toEqual([]);
    expect(data.kept).toEqual(['stack', 'outline']);
    expect(data.capped.map((entry) => entry.name)).toEqual(['roomy', 'compact', 'flat']);
    for (const prototype of data.prototypes) {
      const html = readFileSync(prototype.path, 'utf8');
      expect(html).toContain('data-peaks-object="');
      expect(html).not.toContain('data-peaks-component=');
    }
  });
});
