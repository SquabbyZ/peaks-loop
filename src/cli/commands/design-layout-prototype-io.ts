/**
 * The prototype command's two boundaries: the component manifest it resolves
 * against, and the pages it writes. A rejected direction is written under its
 * own `rejected-<direction>.html` name beside a `rejected.json` naming why.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  readComponentCapabilities,
  type ComponentCapabilities
} from '../../services/design/component-capabilities.js';
import {
  generatePrototypes,
  type Prototype
} from '../../services/design/layout/layout-prototype.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  designRootOf,
  failWith,
  type DesignLayoutRebuildOptions,
  type Selection
} from './design-layout-shared.js';

export type CapabilitiesRead =
  | { ok: true; capabilities: ComponentCapabilities | null }
  | { ok: false; code: string; message: string };

/** An absent section reads as "nothing is filtered"; a malformed one is refused. */
export function prototypeCapabilities(options: {
  project: string;
  app?: string;
}): CapabilitiesRead {
  const verdict = readComponentCapabilities(designRootOf(options));
  if (verdict.ok) return verdict;
  return { ok: false, code: verdict.failure.code, message: verdict.failure.message };
}

export type WrittenFile = { name: string; path: string };

export type PrototypeGeneration =
  { ok: true; prototypes: Prototype[]; declared: boolean } | { ok: false };

/** Read the manifest and generate every direction, or print the refusal. */
export function generateFor(
  selection: Selection,
  options: DesignLayoutRebuildOptions,
  io: ProgramIO,
  command: string
): PrototypeGeneration {
  const response = prototypeCapabilities(options);
  if (!response.ok) {
    failWith(io, command, options.json, {
      code: response.code,
      message: response.message,
      data: { route: selection.route }
    });
    return { ok: false };
  }
  const generated = generatePrototypes(selection.entry, response.capabilities);
  if (!generated.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_PROTOTYPE_FAILED',
      message: generated.reason,
      data: { route: selection.route }
    });
    return { ok: false };
  }
  return {
    ok: true,
    prototypes: generated.prototypes,
    declared: response.capabilities !== null
  };
}

export type Written = { ok: true; files: WrittenFile[] } | { ok: false; reason: string };

export function prototypeFileName(prototype: Prototype): string {
  return prototype.rejection === null
    ? `${prototype.name}.html`
    : `rejected-${prototype.name}.html`;
}

function rejectionMap(prototypes: readonly Prototype[]): Record<string, string> {
  const rejected: Record<string, string> = {};
  for (const prototype of prototypes) {
    if (prototype.rejection !== null) rejected[prototype.name] = prototype.rejection;
  }
  return rejected;
}

/** Every prototype file is written concurrently; one failure names the write. */
export async function writePrototypes(
  dir: string,
  prototypes: readonly Prototype[]
): Promise<Written> {
  try {
    await mkdir(dir, { recursive: true });
    const files = await Promise.all(
      prototypes.map(async (prototype) => {
        const path = join(dir, prototypeFileName(prototype));
        await writeFile(path, prototype.html, 'utf8');
        return { name: prototype.name, path };
      })
    );
    await writeFile(
      join(dir, 'rejected.json'),
      `${JSON.stringify(rejectionMap(prototypes), null, 2)}\n`,
      'utf8'
    );
    return { ok: true, files };
  } catch (error) {
    return { ok: false, reason: `the prototypes could not be written (${getErrorMessage(error)})` };
  }
}
