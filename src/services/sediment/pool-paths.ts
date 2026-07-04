import { join } from "node:path";

export class SYSTEM_PATH_FORBIDDEN extends Error {
  constructor(p: string) { super(`SYSTEM_PATH_FORBIDDEN: refusing to write ${p}`); }
}

export interface Home { home: string; }

export const resolvePoolRoot = ({ home }: Home): string => join(home, ".peaks", "skills");
export const resolveSystemDir = ({ home }: Home): string => join(resolvePoolRoot({ home }), ".system");
export const resolveUserBeesDir = ({ home }: Home): string => join(resolvePoolRoot({ home }), "bees");
export const resolveUserBeeDir = ({ home }: Home, name: string): string => join(resolveUserBeesDir({ home }), name);
export const resolveSegmentsDir = ({ home }: Home): string => join(resolvePoolRoot({ home }), "segments");
export const resolveSegmentDir = ({ home }: Home, name: string): string => join(resolveSegmentsDir({ home }), name);
export const resolveStateDbPath = ({ home }: Home): string => join(resolvePoolRoot({ home }), "state.db");
export const resolveBlobsDir = ({ home }: Home): string => join(resolvePoolRoot({ home }), "blobs");

export function isSystemPath(p: string): boolean {
  return p.split(/[\\/]/).some((seg) => seg === ".system");
}

export function assertNotSystemPath(p: string): void {
  if (isSystemPath(p)) throw new SYSTEM_PATH_FORBIDDEN(p);
}
