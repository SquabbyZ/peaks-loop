/**
 * peaks-loop-crystallization area (consolidated into peaks-loop).
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
} from './crystallization-service.js';

export {
  ensureCrystallizationEventTable,
  insertCrystallizationEvent,
  getCrystallizationEvent,
  listCrystallizationEvents,
  newCrystallizationId,
  updateCrystallizationEventStatus,
} from './crystallization-store.js';

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
} from './crystallization-types.js';

export {
  BriefSectionError,
  renderRecommendationPayload,
  safeRenderRecommendationPayload,
  buildEvidenceBrief,
  type BriefTraceInput,
} from './evidence-brief-builder.js';