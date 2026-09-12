import { beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import {
  ApiDiffInputError,
  diffApiDocument,
  extractMockPlanPaths,
  formatApiDiffText,
  loadApiDocument,
  normalizeType,
  pairingKey,
  parseHandoffEndpoints,
  parseRecordedInterfaces,
  toDisplayPath
} from '../../../../src/services/scan/api-diff-service.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/api-diff/', import.meta.url));
const JSON_DOC = join(FIXTURES, 'users-api.json');
const YAML_DOC = join(FIXTURES, 'orders-api.yaml');
const NOT_OPENAPI = join(FIXTURES, 'not-openapi.json');
const NO_OPERATIONS = join(FIXTURES, 'no-operations.json');

const RECORDED_USER_API = [
  'export interface GetUserResponse {',
  '  id: string;',
  '  displayName: string;',
  '  email: string;',
  '}',
  '',
  'export interface CreateUserRequest {',
  '  email: string;',
  '  nickname?: string;',
  '  legacy_opt_in?: boolean;',
  '}',
  ''
].join('\n');

const RECORDED_ORDER_API = [
  'export interface GetOrderResponse {',
  '  id: string;',
  '  total: number;',
  '  note: string;',
  '  tags: Array<string>;',
  '}',
  ''
].join('\n');

const MOCK_PLAN = [
  '# Mock plan — user domain',
  '',
  'Strategy: static fixtures (frontend-only mode).',
  '',
  '| file | rationale |',
  '|---|---|',
  '| `src/services/types/user-api.types.ts` | user request/response interfaces |',
  '| `src/services/types/order-api.types.ts` | order response interfaces |',
  ''
].join('\n');

const HANDOFF = [
  '# Handoff — rid=demo',
  '',
  '## 结论',
  '',
  'nothing here.',
  '',
  '## API Migration',
  '',
  '| mock file | endpoint | status |',
  '|---|---|---|',
  '| `src/services/types/user-api.types.ts` | GET /api/users/{id} | mocked |',
  '| `src/services/types/user-api.types.ts` | POST /api/users | mocked |',
  '| `src/services/types/user-api.types.ts` | DELETE /api/users/{id} | mocked |',
  '',
  '## Next',
  ''
].join('\n');

function write(root: string, relative: string, content: string): void {
  const file = join(root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

/** Seeds mock-plan.md + the two recorded interface files + the TXT handoff. */
function seedRecordedSources(ws: TmpWorkspace): void {
  write(ws.path, '.peaks/_runtime/2026-01-01-session-aaaa/rd/mock-plan.md', MOCK_PLAN);
  write(ws.path, '.peaks/_runtime/2026-01-01-session-aaaa/txt/handoff.md', HANDOFF);
  write(ws.path, 'src/services/types/user-api.types.ts', RECORDED_USER_API);
  write(ws.path, 'src/services/types/order-api.types.ts', RECORDED_ORDER_API);
  write(ws.path, 'src/services/user-service.ts', [
    '// adapts the backend snake_case payload',
    'export function readDisplayName(row: { display_name: string }): string {',
    '  return row.display_name;',
    '}',
    ''
  ].join('\n'));
}

describe('diffApiDocument', () => {
  const ws = withTmpWorkspacePerTest('peaks-api-diff-');
  beforeEach(() => {
    seedRecordedSources(ws());
  });

  it('when the document is OpenAPI 3.x JSON, should diff endpoints both ways against the recorded endpoint list', () => {
    // given: an OpenAPI 3.0.3 fixture and a handoff recording three endpoints
    // when: the document is diffed
    // then: the endpoint the handoff lacks is ADDED and the one the document lacks is REMOVED
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    expect(report.document.operationCount).toBe(3);
    expect(report.sources.recordedEndpoints).toBe(3);
    expect(report.exact.endpoints).toEqual([
      { confidence: 'exact', kind: 'added', method: 'get', path: '/api/legacy/users' },
      { confidence: 'exact', kind: 'removed', method: 'delete', path: '/api/users/{id}' }
    ]);
  });

  it('when a field type differs between the document and a recorded interface, should report CHANGED with before and after', () => {
    // given: the recorded GetUserResponse declares `email: string`, the document declares it nullable
    // when: the document is diffed
    // then: the field appears as a type change, recorded -> document
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    expect(report.exact.fields.find((entry) => entry.after.field === 'email' && entry.location === 'response.200'))
      .toEqual({
        confidence: 'exact',
        kind: 'changed',
        via: 'type-changed',
        method: 'get',
        path: '/api/users/{id}',
        location: 'response.200',
        before: { field: 'email', type: 'string' },
        after: { field: 'email', type: 'string | null' }
      });
  });

  it('when a field is renamed between the document and a recorded interface, should report CHANGED with the old name before the new one', () => {
    // given: the recorded interface has `displayName`, the document has `display_name`, both `string`
    // when: the document is diffed
    // then: the rename is one CHANGED entry carrying old -> new
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    expect(report.exact.fields.find((entry) => entry.via === 'renamed')).toEqual({
      confidence: 'exact',
      kind: 'changed',
      via: 'renamed',
      method: 'get',
      path: '/api/users/{id}',
      location: 'response.200',
      before: { field: 'displayName', type: 'string' },
      after: { field: 'display_name', type: 'string' }
    });
  });

  it('when a field exists on only one side, should report it as added or removed rather than staying silent', () => {
    // given: the document adds `timezone` to the request body and the recording adds `legacy_opt_in`
    // when: the document is diffed
    // then: both one-sided fields surface as exact changes
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    expect(report.exact.fields.find((entry) => entry.after.field === 'timezone')).toMatchObject({
      via: 'added-in-document',
      before: { field: 'timezone', type: '(absent)' },
      after: { field: 'timezone', type: 'string' }
    });
    expect(report.exact.fields.find((entry) => entry.before.field === 'legacy_opt_in')).toMatchObject({
      via: 'removed-from-document',
      after: { field: 'legacy_opt_in', type: '(absent)' }
    });
  });

  it('when the document is OpenAPI 3.1 YAML with a $ref schema, should resolve the reference and diff it', () => {
    // given: a YAML fixture whose response schema is `#/components/schemas/Order`
    // when: the document is diffed
    // then: the ref resolves, the 3.1 nullable union survives, and Array<T> matches T[]
    const report = diffApiDocument({ projectRoot: ws().path, docPath: YAML_DOC });

    expect(report.document.openapi).toBe('3.1.0');
    expect(report.document.title).toBe('Orders API');
    expect(report.exact.fields.find((entry) => entry.after.field === 'note')?.after.type).toBe('string | null');
    expect(report.exact.fields.some((entry) => entry.after.field === 'tags')).toBe(false);
  });

  it('when fields genuinely changed, should candidate-grep exactly the changed names and nothing else', () => {
    // given: the seeded project, whose diff changes some fields and leaves others untouched
    // when: the document is diffed
    // then: only changed/added/removed names are candidates, and unchanged fields are never grepped
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    const changed = new Set(['email', 'displayName', 'display_name', 'expand', 'timezone', 'legacy_opt_in']);
    const names = report.candidates.map((entry) => entry.name);

    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => changed.has(name))).toBe(true);
    expect(names).not.toContain('nickname');
    expect(names).not.toContain('id');
    expect(report.candidates.every((entry) => entry.confidence === 'candidate')).toBe(true);
    // the new spelling is grepped where the code will have to change…
    expect(report.candidates.find((entry) => entry.name === 'display_name')?.hits)
      .toContainEqual({ file: 'src/services/user-service.ts', line: 2 });
    // …and the recorded (old) spelling too, because the current code still says it
    expect(report.candidates.find((entry) => entry.name === 'displayName')?.hits)
      .toContainEqual({ file: 'src/services/types/user-api.types.ts', line: 3 });
  });

  it('when no recorded interface was parsed, should emit no candidates and say change-site lookup needs a recorded side', () => {
    // given: a project root with no .peaks tree and no recorded interfaces
    // when: the document is diffed against that empty root
    // then: the candidate section is empty and the reason is stated
    const bare = join(ws().path, 'bare');
    mkdirSync(bare, { recursive: true });

    const report = diffApiDocument({ projectRoot: bare, docPath: JSON_DOC });

    expect(report.candidates).toEqual([]);
    expect(report.notes).toContain('no candidate change-sites: change-site lookup needs a parsed recorded interface to know what changed.');
  });

  it('when the document lives inside the project, should not report the document as a candidate change-site', () => {
    // given: the OpenAPI document copied into the project root
    // when: the document is diffed against its own project
    // then: the document is the input, not a change site, so it never appears in the candidate hits
    const localDoc = join(ws().path, 'swagger.json');
    copyFileSync(JSON_DOC, localDoc);

    const report = diffApiDocument({ projectRoot: ws().path, docPath: localDoc });

    const hitFiles = report.candidates.flatMap((entry) => entry.hits.map((hit) => hit.file));
    expect(hitFiles).not.toContain('swagger.json');
    expect(report.candidates.map((entry) => entry.name)).toContain('display_name');
  });

  it('when the doc path is relative, should resolve it against CWD rather than re-rooting it under --project', () => {
    // given: a document one level below a project root that is not the CWD
    // when: the path is given relative to CWD while --project points into it
    // then: it resolves against CWD — nothing is doubled and the document is found
    const consumer = join(ws().path, 'consumer');
    mkdirSync(join(consumer, 'docs'), { recursive: true });
    copyFileSync(JSON_DOC, join(consumer, 'docs', 'users-api.json'));

    const report = diffApiDocument({ projectRoot: consumer, docPath: 'consumer/docs/users-api.json' });

    expect(report.document.operationCount).toBe(3);
    expect(report.document.file).toBe('docs/users-api.json');
  });

  it('when the doc path is absolute, should use it as given regardless of --project', () => {
    // given: an absolute document path and an unrelated project root
    // when: the document is diffed
    // then: the absolute path is used as-is
    const unrelated = join(ws().path, 'unrelated');
    mkdirSync(unrelated, { recursive: true });

    const report = diffApiDocument({ projectRoot: unrelated, docPath: JSON_DOC });

    expect(report.document.operationCount).toBe(3);
    expect(report.document.file).toBe(JSON_DOC.split(sep).join('/'));
  });

  it('when a recorded interface pairs with no operation, should name the convention, the operationIds and the unpaired interfaces', () => {
    // given: a recorded interface set whose names share no key with this document's operationIds
    // when: the YAML document (operationId `getOrder`) is diffed
    // then: the note is self-sufficient — convention, both sides, and the derived example
    write(ws().path, 'src/services/types/order-api.types.ts', '');
    const report = diffApiDocument({ projectRoot: ws().path, docPath: YAML_DOC });

    const note = report.notes.find((entry) => entry.includes('paired with a document operation'));
    expect(note).toBeDefined();
    expect(note).toContain('operationId `getOrder` would pair with an interface named `GetOrderResponse`');
    expect(note).toContain('Document operationIds: getOrder');
    expect(note).toContain('Unpaired interfaces: GetUserResponse, CreateUserRequest');
    expect(report.exact.fields).toEqual([]);
  });

  it('when a recorded source is absent, should name it in the notes instead of reporting nothing', () => {
    // given: a project root with no .peaks tree and no recorded interfaces
    // when: the document is diffed against that empty root
    // then: every missing source is named, the mandatory footer survives, and the parsed document is still reported
    const bare = join(ws().path, 'bare');
    mkdirSync(bare, { recursive: true });

    const report = diffApiDocument({ projectRoot: bare, docPath: JSON_DOC });

    expect(report.exact.endpoints).toEqual([]);
    expect(report.exact.fields).toEqual([]);
    expect(report.sources.mockPlan).toBeNull();
    expect(report.sources.handoff).toBeNull();
    expect(report.sources.interfaceFiles).toEqual([]);
    expect(report.notes.join(' ')).toContain('no recorded interfaces found');
    expect(report.notes.join(' ')).toContain('no mock-plan.md found');
    expect(report.notes.join(' ')).toContain('no TXT handoff');
    expect(report.notDetectable).toHaveLength(3);
    expect(report.document.operationCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// QA repair rid=api-diff-report — every case below asserts an ABSENCE, because
// each of these defects shipped with green tests that only asserted presence.
// ---------------------------------------------------------------------------

const THINGS_DOC = join(FIXTURES, 'things-api.json');
const THING_TYPES = 'src/services/types/thing-api.types.ts';
// An operation whose only body field is an OpenAPI `integer`.
const COUNT_DOC = join(FIXTURES, 'count-api.json');
// Nested `$ref`, `allOf` with sibling properties, and an enum.
const REFS_DOC = join(FIXTURES, 'refs-api.json');
// OpenAPI 3.1 array `type`, a property-less schema, and an absent `required`.
const EDGE_DOC = join(FIXTURES, 'edge-api.json');
const EDGE_TYPES = 'src/services/types/edge-api.types.ts';

describe('exactness repair', () => {
  const ws = withTmpWorkspacePerTest('peaks-api-diff-exact-');
  beforeEach(() => {
    seedRecordedSources(ws());
  });

  it('when a request interface pairs with an operation, should diff it against the requestBody only and never a response location', () => {
    // given: a POST with both a requestBody and a 200 response body, and only a ...Request interface recorded
    // when: the document is diffed
    // then: unchanged request fields produce no line at all, and nothing is reported at a response location
    write(ws().path, THING_TYPES, [
      'export interface CreateThingRequest {',
      '  email: string;',
      '  nickname: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/things')).toEqual([]);
    expect(report.exact.fields.some((entry) => entry.location.startsWith('response.'))).toBe(false);
    expect(report.exact.fields.some((entry) => entry.before.field === 'email' || entry.after.field === 'email'))
      .toBe(false);
  });

  it('when a request field is renamed, should report it at the request location where the Request interface belongs', () => {
    // given: the recorded request member is spelled `emailAddress`, the document says `email`
    // when: the document is diffed
    // then: the rename is reported at the requestBody location, proving role-matched pairing
    write(ws().path, THING_TYPES, [
      'export interface CreateThingRequest {',
      '  emailAddress: string;',
      '  nickname: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.find((entry) => entry.via === 'renamed')).toMatchObject({
      location: 'request',
      method: 'post',
      path: '/api/things',
      before: { field: 'emailAddress', type: 'string' },
      after: { field: 'email', type: 'string' }
    });
  });

  it('when a recorded interface extends a base type, should suppress every exact line for it and say why', () => {
    // given: GetThingResponse extends an unresolvable base that carries `id` and `createdAt`
    // when: the document is diffed
    // then: no field line is emitted for that operation, and the note names the interface and the reason
    write(ws().path, THING_TYPES, [
      'interface BaseEntity {',
      '  id: string;',
      '  createdAt: string;',
      '}',
      'export interface GetThingResponse extends BaseEntity {',
      '  name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('GetThingResponse');
    expect(note).toContain('extends a base type');
  });

  it('when a member type holds a brace inside a string literal, should count braces string-aware and keep reading the file', () => {
    // given: a string literal containing a brace, before a following member and a following interface
    // when: the extractor runs
    // then: brace counting ignores string contents, so neither member nor file is swallowed
    const source = [
      'export interface Template {',
      "  tpl: '{';",
      '  after: string;',
      '}',
      'export interface Later {',
      '  tail: number;',
      '}',
      ''
    ].join('\n');

    const parsed = parseRecordedInterfaces(source, 'tpl.ts');

    expect(parsed.map((entry) => entry.name)).toEqual(['Template', 'Later']);
    expect(Object.fromEntries(parsed[0]!.members)).toEqual({ tpl: "'{'", after: 'string' });
    expect(parsed[0]!.incompleteReason).toBeNull();
    expect(Object.fromEntries(parsed[1]!.members)).toEqual({ tail: 'number' });
  });

  it('when an interface body is written on one line, should mark it incomplete rather than calling every field added', () => {
    // given: a single-line `type X = { ... }` body the line-based extractor cannot read
    // when: the document is diffed
    // then: its exact lines are suppressed and the note says why
    write(ws().path, THING_TYPES, [
      'export type GetThingResponse = { id: string; name: string; createdAt: string; }',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.notes.join(' ')).toContain('GetThingResponse');
    expect(report.notes.join(' ')).toContain('single line');
  });

  it('when a recorded interface has a nested inline object, should suppress its exact lines and name the reason', () => {
    // given: GetThingResponse whose only member is an inline object with hidden inner fields
    // when: the document is diffed
    // then: nothing is claimed about that operation, and the note explains the invisible shape
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  data: {',
      '    inner: string;',
      '  };',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('GetThingResponse');
    expect(note).toContain('nested inline object');
  });

  it('when the handoff spells a path parameter with a colon, should treat it as the same endpoint', () => {
    // given: a handoff recording `GET /api/users/:id` where the document says `{id}`
    // when: the document is diffed
    // then: the endpoint is not reported as an exact ADDED + REMOVED pair
    write(ws().path, '.peaks/_runtime/2026-01-01-session-aaaa/txt/handoff.md', HANDOFF.replaceAll('{id}', ':id'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    const userEndpoints = report.exact.endpoints.filter((entry) => entry.path.includes('/api/users/'));
    expect(userEndpoints).toHaveLength(1);
    expect(userEndpoints[0]).toMatchObject({ kind: 'removed', method: 'delete' });
  });

  it('when a project root is a string prefix of a sibling directory, should not render the sibling as if it were inside', () => {
    // given: a root of `<ws>/x` and a file at `<ws>/x-archive/docs/api.json`
    // when: display paths are computed
    // then: the sibling is not mistaken for a child of the root
    const root = join(ws().path, 'x');
    const sibling = join(ws().path, 'x-archive', 'docs', 'api.json');

    expect(toDisplayPath(root, sibling)).toBe(sibling.split(sep).join('/'));
    expect(toDisplayPath(root, join(root, 'docs', 'api.json'))).toBe('docs/api.json');
  });

  it('when a changed name has more hits than the cap, should say the hit list is an example rather than the full set', () => {
    // given: a changed field name repeated on more lines than the per-name hit cap
    // when: the document is diffed
    // then: the hit list is capped AND a note says it is capped
    write(ws().path, 'src/many.ts', Array.from({ length: 8 }, (_value, index) => `export const k${index} = 'display_name';`).join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });

    const mention = report.candidates.find((entry) => entry.name === 'display_name');
    expect(mention?.hits).toHaveLength(5);
    expect(report.notes.some((note) => note.includes('candidate hits are capped per name'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QA round 2 — the INVERTED default. A line-based reader cannot tell "this line
// is not a member" from "I failed to read this member", so completeness must be
// PROVEN. Every case below is a class the previous "exact unless suppressed"
// model shipped as a false exact line or a silent hole.
// ---------------------------------------------------------------------------

describe('proven-completeness repair', () => {
  const ws = withTmpWorkspacePerTest('peaks-api-diff-proven-');
  beforeEach(() => {
    seedRecordedSources(ws());
  });

  it('when one line carries two members, should suppress the interface rather than swallow the second member', () => {
    // given: two members collapsed onto a single body line
    // when: the document is diffed
    // then: no garbage type is emitted, the vanished `name` produces no line, and a note explains why
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string; name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.exact.fields.some((entry) => entry.before.type.includes('name'))).toBe(false);
    expect(report.notes.join(' ')).toContain('more than one member');
  });

  it('when a comma separates two members on one line, should suppress the interface rather than keep a truncated type', () => {
    // given: a comma-separated pair of members on one body line
    // when: the document is diffed
    // then: nothing is claimed and the note names the line
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string, name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.notes.join(' ')).toContain('more than one member');
  });

  it('when a declaration has a nested generic, should record it as incomplete rather than dropping it in silence', () => {
    // given: `interface GetThingResponse<T extends Record<string, unknown>>`, which no declaration pattern spans
    // when: the document is diffed
    // then: a note names the interface — the failure is never silent
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse<T extends Record<string, unknown>> {',
      '  id: string;',
      '  name: number;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('GetThingResponse');
  });

  it('when a declaration puts its brace on the next line, should record it as incomplete rather than ignoring it', () => {
    // given: `export interface X` followed by `{` on the following line
    // when: the document is diffed
    // then: a note names the interface
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse',
      '{',
      '  id: string;',
      '  name: number;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.notes.join(' ')).toContain('GetThingResponse');
  });

  it('when an interface was parsed but produced no line, should not claim that no recorded interface was parsed', () => {
    // given: a complete, suppressed GetThingResponse — an interface that WAS parsed
    // when: the document is diffed
    // then: the candidate note points at the notes above rather than misdirecting the reader
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string; name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    const note = report.notes.find((entry) => entry.includes('candidate change-sites'));
    expect(note).toContain('see the notes above');
    expect(note).not.toContain('needs a parsed recorded interface');
  });

  it('when a file has unbalanced braces, should fail safe by suppressing the whole file and naming it', () => {
    // given: a normally-readable interface in a file whose structure collapsed
    // when: the document is diffed
    // then: nothing is claimed from that file and the note names it
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string;',
      '  name: number;',
      '}',
      'const pattern = /[{]/;',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('unbalanced braces');
    expect(note).toContain(THING_TYPES);
  });

  it('when a recorded optional matches a document optional, should not report a duplicate-union difference', () => {
    // given: a recorded `nickname?: string` against a document field typed `string | undefined`
    // when: the document is diffed
    // then: no line is emitted — `string | undefined | undefined` is the same type
    expect(normalizeType('string | undefined | undefined')).toBe('string | undefined');
    expect(normalizeType('string | undefined')).toBe(normalizeType('string | undefined | undefined'));
  });

  it('when a document field is a nested $ref, should keep the referenced name rather than reporting object', () => {
    // given: `owner: {$ref: User}` and `tags: {items: {$ref: User}}` against a recorded `User` / `User[]`
    // when: the document is diffed
    // then: neither field produces a line — the ref name is the faithful reading
    write(ws().path, 'src/services/types/refs-api.types.ts', [
      'export interface GetRefResponse {',
      '  id: string;',
      '  owner: User;',
      '  tags: User[];',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: REFS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/refs/{id}')).toEqual([]);
    expect(report.exact.fields.some((entry) => entry.after.type === 'object')).toBe(false);
  });

  it('when a nested $ref is a two-hop chain, should report the referencing name rather than dereferencing to object', () => {
    // given: `owner: {$ref: OwnerRef}` where OwnerRef itself points at User
    // when: the document is diffed
    // then: no line is emitted for the unchanged field
    write(ws().path, 'src/services/types/refs-api.types.ts', [
      'export interface GetHopResponse {',
      '  id: string;',
      '  owner: OwnerRef;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: REFS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/hop/{id}')).toEqual([]);
  });

  it('when a schema composes with allOf alongside its own properties, should suppress the location rather than report a sibling field removed', () => {
    // given: `allOf: [BaseUser]` with a sibling `properties: { name }`, recorded with both id and name
    // when: the document is diffed
    // then: the inherited `id` is never reported removed-from-document, and a note names the construct
    write(ws().path, 'src/services/types/refs-api.types.ts', [
      'export interface GetComposedResponse {',
      '  id: string;',
      '  name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: REFS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/composed/{id}')).toEqual([]);
    const note = report.notes.find((entry) => entry.includes('could not be fully read'));
    expect(note).toContain('GET /api/composed/{id} response.200');
    expect(note).toContain('allOf');
  });

  it('when the document and the recording spell an enum with different quote styles, should not report a change', () => {
    // given: the document renders `"active" | "suspended"` and the recording writes `'active' | 'suspended'`
    // when: the document is diffed
    // then: quote style is a rendering artifact, so no line is emitted
    write(ws().path, 'src/services/types/refs-api.types.ts', [
      'export interface GetEnumResponse {',
      "  status: 'active' | 'suspended';",
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: REFS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/enum/{id}')).toEqual([]);
    expect(normalizeType("'a' | 'b'")).toBe(normalizeType('"a" | "b"'));
  });

  it('when only some operations are recorded, should name the operations that matched nothing', () => {
    // given: a document with two operations where only one recorded interface exists
    // when: the document is diffed
    // then: the mix is not silent — the unpaired operation is named
    write(ws().path, THING_TYPES, [
      'export interface CreateThingRequest {',
      '  email: string;',
      '  nickname: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    const note = report.notes.find((entry) => entry.includes('matched no recorded interface'));
    expect(note).toBeDefined();
    expect(note).toContain('GET /api/things/{id}');
    expect(note).not.toContain('POST /api/things');
  });

  it('when the 3.1 array type form says integer, should map it to number rather than leaking the OpenAPI spelling', () => {
    // given: `type: ['integer','null']` and `type: ['integer']` against recorded `number` spellings
    // when: the document is diffed
    // then: no line is emitted for any of the three unchanged fields
    write(ws().path, EDGE_TYPES, [
      'export interface GetV31Response {',
      '  id: number | null;',
      '  count: number;',
      '  scores: (number | null)[];',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: EDGE_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/v31/{id}')).toEqual([]);
    expect(report.exact.fields.some((entry) => entry.before.type.includes('integer') || entry.after.type.includes('integer')))
      .toBe(false);
  });

  it('when a response schema lists no properties, should suppress the location rather than dropping it in silence', () => {
    // given: a `{type: 'string'}` response body the field reader cannot produce a field set from
    // when: the document is diffed
    // then: the location is named in a note and no line claims the recorded field was removed
    write(ws().path, EDGE_TYPES, [
      'export interface GetScalarResponse {',
      '  status: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: EDGE_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/scalar/{id}')).toEqual([]);
    const note = report.notes.find((entry) => entry.includes('could not be fully read'));
    expect(note).toContain('GET /api/scalar/{id} response.200');
    expect(note).toContain('no `properties`');
  });

  it('when a dropped response body leaves one readable status, should still refuse rather than diff against the wrong status', () => {
    // given: a scalar 200 alongside an object 404, and a Response interface that names no status
    // when: the document is diffed
    // then: the multi-status guard still fires — nothing is compared against the 404
    write(ws().path, EDGE_TYPES, [
      'export interface GetPartialResponse {',
      '  id: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: EDGE_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/partial/{id}')).toEqual([]);
    expect(report.exact.fields.some((entry) => entry.location === 'response.404')).toBe(false);
    expect(report.notes.join(' ')).toContain('names no status');
  });

  it('when a schema omits required, should treat every property as optional like a generated recording does', () => {
    // given: a body with no `required` key against a recorded `id?: string; name?: string`
    // when: the document is diffed
    // then: no line is emitted — omitting `required` means optional, per OpenAPI
    write(ws().path, EDGE_TYPES, [
      'export interface GetOptResponse {',
      '  id?: string;',
      '  name?: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: EDGE_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/opt/{id}')).toEqual([]);
  });

  it('when the document says integer, should match a recorded number rather than reporting a false type change', () => {
    // given: an OpenAPI `integer` field recorded as a TypeScript `number`
    // when: the document is diffed
    // then: no line is emitted — `integer` and `number` are the same type
    write(ws().path, 'src/services/types/count-api.types.ts', [
      'export interface GetCountResponse {',
      '  total: number;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: COUNT_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/count')).toEqual([]);
  });

  it('when a body line is a quoted key, should suppress the interface rather than drop the member in silence', () => {
    // given: a depth-1 key the MEMBER pattern cannot match
    // when: the document is diffed
    // then: no exact line is emitted and the note names the line
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      "  'display-name': string;",
      '  id: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('GetThingResponse');
    expect(note).toContain('cannot classify');
  });

  it('when a body is only an index signature, should suppress it rather than call every document field added', () => {
    // given: an index-signature-only body, which previously yielded zero members
    // when: the document is diffed
    // then: nothing is claimed about that operation
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  [key: string]: unknown;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.filter((entry) => entry.path === '/api/things/{id}')).toEqual([]);
    expect(report.notes.join(' ')).toContain('cannot classify');
  });

  it('when a union member spans two lines, should suppress the interface rather than keep a truncated type', () => {
    // given: a member whose continuation line is the unclassifiable one
    // when: the document is diffed
    // then: no exact line survives, so the truncated first line never becomes a type claim
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string;',
      '  status: "a"',
      '    | "b";',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.notes.join(' ')).toContain('cannot classify');
  });

  it('when an interface is an intersection alias, should record it as incomplete rather than never seeing it', () => {
    // given: `type X = Base & { ... }`, which no declaration pattern matches
    // when: the document is diffed
    // then: it is recorded, named in a note, and emits no exact line
    write(ws().path, THING_TYPES, [
      'interface BaseEntity {',
      '  id: string;',
      '}',
      'export type GetThingResponse = BaseEntity & {',
      '  name: string;',
      '};',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('not fully readable'));
    expect(note).toContain('GetThingResponse');
    expect(note).toContain('declaration could not be fully parsed');
  });

  it('when a type is an array of inline objects, should suppress it rather than emit a false type-changed', () => {
    // given: `Array<{ ... }>` nests an object without the type text starting with a brace
    // when: the document is diffed
    // then: the interface is incomplete and no line is emitted
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  data: Array<{ a: string }>;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    expect(report.notes.join(' ')).toContain('nested inline object');
  });

  it('when a response interface name carries no status and the operation has several, should refuse rather than diff against the wrong one', () => {
    // given: a complete GetThingResponse and an operation whose 200 and 404 both have JSON bodies
    // when: the document is diffed
    // then: nothing is emitted for it and the refusal names the interface
    write(ws().path, THING_TYPES, [
      'export interface GetThingResponse {',
      '  id: string;',
      '  name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('names no status'));
    expect(note).toContain('GetThingResponse');
    expect(note).toContain('200, 404');
  });

  it('when an interface name ends in Dto, should refuse the pairing rather than assume it describes the request', () => {
    // given: a response-shaped `GetThingDto`, whose suffix names neither side
    // when: the document is diffed
    // then: no exact line is emitted and the refusal explains the suffix
    write(ws().path, THING_TYPES, [
      'export interface GetThingDto {',
      '  id: string;',
      '  name: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('neither a request nor a response'));
    expect(note).toContain('GetThingDto');
    expect(note).toContain('Dto');
  });

  it('when a request interface pairs with a bodyless operation, should name the pairing that yielded no location', () => {
    // given: a GetThingRequest paired with a GET that declares no requestBody
    // when: the document is diffed
    // then: the silent hole is named rather than swallowed by the operation being skipped
    write(ws().path, THING_TYPES, [
      'export interface GetThingRequest {',
      '  id: string;',
      '}',
      ''
    ].join('\n'));

    const report = diffApiDocument({ projectRoot: ws().path, docPath: THINGS_DOC });

    expect(report.exact.fields.some((entry) => entry.path === '/api/things/{id}')).toBe(false);
    const note = report.notes.find((entry) => entry.includes('no matching location'));
    expect(note).toContain('GetThingRequest');
    expect(note).toContain('GET /api/things/{id}');
  });
});

describe('formatApiDiffText', () => {
  const ws = withTmpWorkspacePerTest('peaks-api-diff-text-');
  beforeEach(() => {
    seedRecordedSources(ws());
  });

  it('when the report is rendered as text, should label the exact and candidate sections differently and always print the footer', () => {
    // given: a populated diff report
    // when: the text rendering runs
    // then: both section labels and the mandatory not-detectable footer are present, in order
    const report = diffApiDocument({ projectRoot: ws().path, docPath: JSON_DOC });
    const text = formatApiDiffText(report);

    expect(text).toContain('Exact — document parsed vs recorded interfaces parsed');
    expect(text).toContain('Candidate mentions — name-grep, may OVER- and UNDER-report');
    expect(text).toContain('Not detectable by this command');
    expect(text).toContain('  CHANGED   GET /api/users/{id}   response.200.email   string -> string | null');
    expect(text).toContain('  ADDED     GET /api/legacy/users');
    expect(text).toContain('  REMOVED   DELETE /api/users/{id}');
    expect(text.indexOf('Exact —')).toBeLessThan(text.indexOf('Candidate mentions —'));
    expect(text.indexOf('Candidate mentions —')).toBeLessThan(text.indexOf('Not detectable by this command'));
  });

  it('when a section is empty, should say so out loud rather than printing nothing', () => {
    // given: a report with no exact changes and no candidates
    // when: the text rendering runs
    // then: both empty sections say so
    const empty = {
      document: { file: 'x.json', openapi: '3.0.3', title: null, operationCount: 1 },
      exact: { endpoints: [], fields: [] },
      candidates: [],
      sources: { mockPlan: null, interfaceFiles: [], handoff: null, recordedEndpoints: 0 },
      notes: [],
      notDetectable: ['a field whose type is unchanged but whose meaning changed']
    };
    const text = formatApiDiffText(empty);

    expect(text).toContain('(no exact differences)');
    expect(text).toContain('  (none)');
  });
});

describe('loadApiDocument', () => {
  it('when the file is not an OpenAPI 3.x document, should raise NOT_OPENAPI_3', () => {
    // given: a JSON file with no top-level `openapi` key
    // when: the document is loaded
    // then: a typed input error names the problem
    let caught: unknown;
    try {
      loadApiDocument(NOT_OPENAPI);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiDiffInputError);
    expect((caught as ApiDiffInputError).code).toBe('NOT_OPENAPI_3');
  });

  it('when the document declares OpenAPI 3.x but no operations, should refuse to emit an empty diff', () => {
    // given: an OpenAPI 3.0.3 file with `paths: {}`
    // when: the document is loaded
    // then: it is an error, not an empty success
    expect(() => loadApiDocument(NO_OPERATIONS)).toThrowError(/refusing to print an empty diff/);
  });
});

describe('parseRecordedInterfaces', () => {
  it('when an interface has nested, optional and Array-typed members, should extract the flat top-level members', () => {
    // given: a recorded interface with a nested object, an optional member and an Array<> type
    // when: the extractor runs
    // then: nested collapses to `object`, `?` becomes `| undefined`, comments are ignored
    const source = [
      'export interface Mixed {',
      '  id: string;',
      '  nickname?: string;',
      '  tags: Array<string>;',
      '  nested: {',
      '    inner: string;',
      '  };',
      '  // a comment: fake_member: string;',
      '}',
      ''
    ].join('\n');

    const parsed = parseRecordedInterfaces(source, 'mixed.ts')[0];

    expect(parsed?.name).toBe('Mixed');
    expect(Object.fromEntries(parsed?.members ?? [])).toEqual({
      id: 'string',
      nickname: 'string | undefined',
      tags: 'Array<string>',
      nested: 'object'
    });
    // The hidden inner shape makes the interface INCOMPLETE, which suppresses
    // its exact lines — a partial member set invents false one-sided fields.
    expect(parsed?.incompleteReason).toContain('nested inline object');
  });

  it('when an interface extends another, should not resolve the inherited members', () => {
    // given: an interface that extends a base declared in the same file
    // when: the extractor runs
    // then: only the declared member is visible — the documented under-report limit
    const source = [
      'interface Base { a: string; }',
      'export interface Child extends Base {',
      '  b: number;',
      '}',
      ''
    ].join('\n');

    const child = parseRecordedInterfaces(source, 'child.ts').find((entry) => entry.name === 'Child');

    expect([...(child?.members.keys() ?? [])]).toEqual(['b']);
    expect(child?.incompleteReason).toContain('extends a base type');
  });
});

describe('normalization helpers', () => {
  it('when two type spellings are equivalent, should normalize them to the same text', () => {
    // given: equivalent spellings of the same type
    // when: normalization runs
    // then: they collapse to one canonical text
    expect(normalizeType('Array<string>')).toBe('string[]');
    expect(normalizeType('string[]')).toBe('string[]');
    expect(normalizeType('string|null')).toBe('string | null');
    expect(normalizeType('  string  |  null ; ')).toBe('string | null');
    expect(normalizeType('Array<A | B>')).toBe('(A | B)[]');
    expect(normalizeType('(A|B)[]')).toBe('(A | B)[]');
  });

  it('when pairing a document operation with a recorded interface, should strip only a trailing response/request suffix', () => {
    // given: the two naming conventions this repo records
    // when: pairing keys are computed
    // then: only the documented suffix strip applies, and verb stripping does not
    expect(pairingKey('GetUserResponse')).toBe('getuser');
    expect(pairingKey('getUser')).toBe('getuser');
    expect(pairingKey('CreateUserRequest')).toBe('createuser');
    expect(pairingKey('GetOrderResponse')).toBe('getorder');
    expect(pairingKey('getUser')).not.toBe(pairingKey('UserResponse'));
  });

  it('when a mock plan records file paths, should extract them from backticks and plain text', () => {
    // given: a mock-plan body with backticked and bare paths
    // when: the paths are extracted
    // then: both survive and duplicates collapse
    const paths = extractMockPlanPaths('see `src/a-api.types.ts` and mock/b.ts for details');

    expect(paths).toEqual(['src/a-api.types.ts', 'mock/b.ts']);
  });

  it('when a TXT handoff carries an API Migration section, should extract only that section endpoint list', () => {
    // given: a handoff with an endpoint table and a trailing unrelated section
    // when: the endpoints are parsed
    // then: only the API Migration rows are returned
    const endpoints = parseHandoffEndpoints(HANDOFF);

    expect(endpoints).toEqual([
      { method: 'get', path: '/api/users/{id}' },
      { method: 'post', path: '/api/users' },
      { method: 'delete', path: '/api/users/{id}' }
    ]);
  });
});
