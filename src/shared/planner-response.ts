/**
 * Shared response types for planner commands.
 * These types ensure consistent error/status reporting across
 * tech and RD swarm dry-run planner commands.
 */

export type WorkspaceUnavailableBehavior = 'preview' | 'blocked';

export type ArtifactWorkspaceUnavailableResponse = {
  available: false;
  behavior: WorkspaceUnavailableBehavior;
  reason: string;
  nextActions: readonly string[];
};

export type ArtifactWorkspaceAvailableResponse<T> = {
  available: true;
  data: T;
};

export type ArtifactWorkspaceResponse<T> =
  | ArtifactWorkspaceUnavailableResponse
  | ArtifactWorkspaceAvailableResponse<T>;

export const WORKSPACE_UNAVAILABLE_NEXT_ACTIONS = Object.freeze([
  'Configure a Peaks artifact workspace in your workspace config.',
  'See peaks artifacts workspace --help for setup instructions.',
]);

export function makeUnavailableResponse(
  behavior: WorkspaceUnavailableBehavior,
  reason: string
): ArtifactWorkspaceUnavailableResponse {
  return {
    available: false,
    behavior,
    reason,
    nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS],
  };
}

export function makeAvailableResponse<T>(data: T): ArtifactWorkspaceAvailableResponse<T> {
  return {
    available: true,
    data,
  };
}

export function isUnavailableResponse<T>(resp: ArtifactWorkspaceResponse<T>): resp is ArtifactWorkspaceUnavailableResponse {
  return resp.available === false;
}
