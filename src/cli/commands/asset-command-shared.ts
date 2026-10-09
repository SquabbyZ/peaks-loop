// src/cli/commands/asset-command-shared.ts
//
// The flag parsers, project/db bootstrap and service wiring the three
// `peaks asset` verbs share. Split out of `asset-commands.ts` so each verb can
// live in its own module without repeating the same twelve-line construction.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import {
  CrystallizationService,
  CRYSTALLIZATION_TRIGGERS,
  type CrystallizationTrigger
} from '../../services/crystallization/index.js';
import { LoopReleaseSchema } from '../../services/loop/loop-release-types.js';
import { insertLoopRelease } from '../../services/loop/loop-release-store.js';
import { insertLoopBeeRelation } from '../../services/loop/loop-bee-relation-store.js';
import { LoopBeeRelationSchema } from '../../services/loop/loop-bee-relation-types.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

export function collectRepeatable(value: string, previous: string[]): string[] {
  if (Array.isArray(previous)) return [...previous, value];
  return [value];
}

export const DISPOSE_MODES = ['trace_only', 'retain', 'destroy'] as const;
export type DisposeMode = (typeof DISPOSE_MODES)[number];

export function parseTriggerFlag(raw: string): CrystallizationTrigger | null {
  return (CRYSTALLIZATION_TRIGGERS as readonly string[]).includes(raw)
    ? (raw as CrystallizationTrigger)
    : null;
}

/** `--project`, else the nearest project root above cwd, else cwd. */
export function resolveAssetProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

/** Ensure `<projectRoot>/.peaks/` exists and open its `state.db`. */
export function openAssetDb(projectRoot: string): ReturnType<typeof openStateDb> {
  if (!existsSync(join(projectRoot, '.peaks'))) {
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  }
  return openStateDb(join(projectRoot, '.peaks', 'state.db'));
}

/** The CrystallizationService wiring every asset verb repeats, built once. */
export function createCrystallizationService(
  db: ReturnType<typeof openStateDb>
): CrystallizationService {
  return new CrystallizationService(db, {
    loopReleaseSchema: LoopReleaseSchema,
    loopBeeRelationSchema: LoopBeeRelationSchema as unknown as ConstructorParameters<
      typeof CrystallizationService
    >[1]['loopBeeRelationSchema'],
    insertLoopRelease: insertLoopRelease as unknown as ConstructorParameters<
      typeof CrystallizationService
    >[1]['insertLoopRelease'],
    insertLoopBeeRelation: insertLoopBeeRelation as unknown as ConstructorParameters<
      typeof CrystallizationService
    >[1]['insertLoopBeeRelation']
  });
}
