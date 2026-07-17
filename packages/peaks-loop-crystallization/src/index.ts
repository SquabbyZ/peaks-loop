/**
 * peaks-loop-crystallization public surface.
 *
 * Loop domain (loop-release / loop-bee-relation) lives in the main
 * peaks-loop package. They are injected via CrystallizationOptions
 * at call-site in src/cli/commands/asset-commands.ts, so this
 * subpackage stays standalone and does NOT depend on the main
 * peaks-loop package (avoiding workspace:* circular trap).
 */

export {
  CrystallizationService,
  CrystallizationIntegrityError,
  type CrystallizationOptions,
  type CrystallizationTaskState,
} from './services/crystallization/crystallization-service.js';

export {
  ensureCrystallizationEventTable,
  insertCrystallizationEvent,
  getCrystallizationEvent,
  listCrystallizationEvents,
  newCrystallizationId,
  updateCrystallizationEventStatus,
} from './services/crystallization/crystallization-store.js';

export {
  CRYSTALLIZATION_TRIGGERS,
  parseEvidenceBrief,
  EvidenceBriefSchema,
  CrystallizationEventSchema,
  parseCrystallizationEvent,
  safeParseEvidenceBrief,
  safeParseCrystallizationEvent,
  hasAllFourBriefSections,
  type CrystallizationTrigger,
  type CrystallizationEvent,
  type CrystallizationEventInput,
  type CrystallizationEventStatus,
  type EvidenceBrief,
} from './services/crystallization/crystallization-types.js';

export {
  BriefSectionError,
  renderRecommendationPayload,
  safeRenderRecommendationPayload,
  buildEvidenceBrief,
} from './services/crystallization/evidence-brief-builder.js';