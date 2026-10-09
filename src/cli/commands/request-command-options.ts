// Split out of `request-commands.ts`: the
// Commander option shapes the `peaks request` subcommands read.
import type {
  RequestArtifactRole,
  RequestArtifactState,
  RequestType
} from '../../services/artifacts/request-artifact-service.js';

export type RequestInitOptions = {
  role: string;
  id: string;
  project: string;
  sessionId?: string;
  apply?: boolean;
  type?: RequestType;
  // beats PEAKS_CALLER_ID env which beats PLATFORM_FALLBACKS.
  callerId?: string;
  json?: boolean;
};

export type RequestListOptions = {
  project: string;
  sessionId?: string;
  role?: RequestArtifactRole;
  summary?: boolean;
  json?: boolean;
};

export type RequestShowOptions = {
  role: RequestArtifactRole;
  project: string;
  sessionId?: string;
  json?: boolean;
  pretty?: boolean;
  compact?: boolean;
};

export type RequestTransitionOptions = {
  role: RequestArtifactRole;
  project: string;
  state: RequestArtifactState;
  sessionId?: string;
  reason?: string;
  allowIncomplete?: boolean;
  confirm?: boolean;
  forceConfirm?: boolean;
  json?: boolean;
};

export type RequestLintOptions = {
  role: RequestArtifactRole;
  project: string;
  sessionId?: string;
  json?: boolean;
};

export type RequestRepairStatusOptions = {
  project: string;
  sessionId?: string;
  maxCycles?: string;
  json?: boolean;
};
