/**
 * Pairing one viewport's two captures by `data-peaks-object` and asserting the
 * three relations per pair: the shared-edge anchor, the parent's spacing-token
 * names, and the structural role. Only the first two are verdict inputs; the
 * role is reported separately. A missing, extra or duplicated identity is
 * named here, never folded into a score.
 */
import { roleOf } from './layout-cut.js';
import { tokenFor } from './layout-align.js';
import {
  FIDELITY_ANCHOR_TOLERANCE_PX,
  type FidelityFailure,
  type FidelityFailureClass
} from './fidelity-model.js';
import type { ElementBox, LayoutElement, LayoutGeometry } from './layout-geometry.js';
import type { SpacingToken } from './layout-tokens.js';

type Duplicate = { id: string; count: number };

/** One side of the pair: its unique object ids and any duplicated id. */
export type Side = {
  elements: readonly LayoutElement[];
  byId: ReadonlyMap<string, LayoutElement>;
  duplicates: readonly Duplicate[];
};

function countIds(geometry: LayoutGeometry): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of geometry.elements) {
    const id = element.peaks?.object;
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function sideOf(geometry: LayoutGeometry): Side {
  const counts = countIds(geometry);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const duplicated = new Set(duplicates.map((entry) => entry.id));
  const byId = new Map<string, LayoutElement>();
  for (const element of geometry.elements) {
    const id = element.peaks?.object;
    if (id === undefined || duplicated.has(id) || byId.has(id)) continue;
    byId.set(id, element);
  }
  return { elements: geometry.elements, byId, duplicates };
}

export type FailureInput = {
  viewport: string;
  failureClass: FidelityFailureClass;
  objectId: string;
  property: string;
  expected: string;
  actual: string;
};

export function namedFailure(input: FailureInput): FidelityFailure {
  return { ...input };
}

function duplicateFailures(viewport: string, side: Side, label: string): FidelityFailure[] {
  return side.duplicates.map((duplicate) =>
    namedFailure({
      viewport,
      failureClass: 'duplicate-object',
      objectId: duplicate.id,
      property: 'data-peaks-object',
      expected: 'one element',
      actual: `${String(duplicate.count)} elements in the ${label}`
    })
  );
}

/** Missing, extra and duplicated identities for one viewport. */
export function presenceFailures(
  viewport: string,
  prototype: Side,
  implementation: Side
): FidelityFailure[] {
  const failures = [
    ...duplicateFailures(viewport, prototype, 'prototype'),
    ...duplicateFailures(viewport, implementation, 'implementation')
  ];
  for (const id of prototype.byId.keys()) {
    if (implementation.byId.has(id)) continue;
    failures.push(
      namedFailure({
        viewport,
        failureClass: 'missing-object',
        objectId: id,
        property: 'data-peaks-object',
        expected: 'present',
        actual: 'absent'
      })
    );
  }
  for (const id of implementation.byId.keys()) {
    if (prototype.byId.has(id)) continue;
    failures.push(
      namedFailure({
        viewport,
        failureClass: 'extra-object',
        objectId: id,
        property: 'data-peaks-object',
        expected: 'absent (not declared by the prototype)',
        actual: 'present'
      })
    );
  }
  return failures;
}

function isStacked(left: ElementBox, right: ElementBox): boolean {
  return left.bottom <= right.top || right.bottom <= left.top;
}

function isSideBySide(left: ElementBox, right: ElementBox): boolean {
  return left.right <= right.left || right.right <= left.left;
}

/** `edge:objectId` for every other paired object this one shares an edge with. */
function anchorRelations(target: LayoutElement, peers: readonly LayoutElement[]): string[] {
  const relations: string[] = [];
  for (const peer of peers) {
    const peerId = peer.peaks?.object;
    if (peerId === undefined) continue;
    if (
      isStacked(target.box, peer.box) &&
      Math.abs(target.box.left - peer.box.left) <= FIDELITY_ANCHOR_TOLERANCE_PX
    ) {
      relations.push(`left:${peerId}`);
    }
    if (
      isSideBySide(target.box, peer.box) &&
      Math.abs(target.box.top - peer.box.top) <= FIDELITY_ANCHOR_TOLERANCE_PX
    ) {
      relations.push(`top:${peerId}`);
    }
  }
  return relations.sort((left, right) => left.localeCompare(right));
}

const ZERO_SIDES = { top: 0, right: 0, bottom: 0, left: 0 };

function spacingValues(element: LayoutElement): number[] {
  const margin = element.margin ?? ZERO_SIDES;
  return [
    element.padding.top,
    element.padding.right,
    element.padding.bottom,
    element.padding.left,
    margin.top,
    margin.right,
    margin.bottom,
    margin.left
  ];
}

/** Both sides may name no token (a match); one-sided null is a mismatch. */
function tokenNames(
  element: LayoutElement,
  elements: readonly LayoutElement[],
  tokens: readonly SpacingToken[]
): string[] {
  const parent = element.parent >= 0 ? elements[element.parent] : undefined;
  if (parent === undefined) return [];
  const names = new Set<string>();
  for (const px of spacingValues(parent)) {
    const token = tokenFor(tokens, px);
    if (token !== null) names.add(token.name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function shown(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

export type PairInput = {
  viewport: string;
  id: string;
  prototype: LayoutElement;
  implementation: LayoutElement;
  /** The paired peers only: the anchor relation is computed among them. */
  pairedPrototype: readonly LayoutElement[];
  pairedImplementation: readonly LayoutElement[];
  /** Every captured element: a parent lookup needs the whole document. */
  prototypeElements: readonly LayoutElement[];
  implementationElements: readonly LayoutElement[];
  tokens: readonly SpacingToken[];
};

export type PairOutcome = {
  anchor: boolean;
  token: boolean;
  role: boolean;
  failures: FidelityFailure[];
  roleMismatches: FidelityFailure[];
};

type RelationValues = {
  anchorExpected: string;
  anchorActual: string;
  tokenExpected: string;
  tokenActual: string;
  roleExpected: string;
  roleActual: string;
};

function relationValues(input: PairInput): RelationValues {
  return {
    anchorExpected: shown(anchorRelations(input.prototype, input.pairedPrototype)),
    anchorActual: shown(anchorRelations(input.implementation, input.pairedImplementation)),
    tokenExpected: shown(tokenNames(input.prototype, input.prototypeElements, input.tokens)),
    tokenActual: shown(
      tokenNames(input.implementation, input.implementationElements, input.tokens)
    ),
    roleExpected: roleOf(input.prototype.tag, input.prototype.ariaRole),
    roleActual: roleOf(input.implementation.tag, input.implementation.ariaRole)
  };
}

type MismatchDetail = {
  failureClass: FidelityFailureClass;
  property: string;
  expected: string;
  actual: string;
};

function mismatch(input: PairInput, detail: MismatchDetail): FidelityFailure {
  return namedFailure({
    viewport: input.viewport,
    failureClass: detail.failureClass,
    objectId: input.id,
    property: detail.property,
    expected: detail.expected,
    actual: detail.actual
  });
}

export function pairOutcome(input: PairInput): PairOutcome {
  const values = relationValues(input);
  const failures: FidelityFailure[] = [];
  const roleMismatches: FidelityFailure[] = [];
  if (values.anchorExpected !== values.anchorActual) {
    failures.push(
      mismatch(input, {
        failureClass: 'anchor-mismatch',
        property: 'anchor',
        expected: values.anchorExpected,
        actual: values.anchorActual
      })
    );
  }
  if (values.tokenExpected !== values.tokenActual) {
    failures.push(
      mismatch(input, {
        failureClass: 'token-mismatch',
        property: 'spacing-token',
        expected: values.tokenExpected,
        actual: values.tokenActual
      })
    );
  }
  if (values.roleExpected !== values.roleActual) {
    roleMismatches.push(
      mismatch(input, {
        failureClass: 'role-mismatch',
        property: 'role',
        expected: values.roleExpected,
        actual: values.roleActual
      })
    );
  }
  return {
    anchor: values.anchorExpected === values.anchorActual,
    token: values.tokenExpected === values.tokenActual,
    role: values.roleExpected === values.roleActual,
    failures,
    roleMismatches
  };
}
