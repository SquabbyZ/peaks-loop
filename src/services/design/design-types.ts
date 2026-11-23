/**
 * The design contract root — where one frontend app keeps its `design/` files.
 *
 * `design/` lives at the frontend APP root, never the repository root: a Go
 * backend with a `web/` app writes `web/design/`, and a monorepo writes one
 * contract per app. `appRelPath` is the POSIX-joined path from the repository
 * root to that app root, and is the empty string when the app root IS the
 * repository root.
 */
export type ContractRoot = {
  appRoot: string;
  designRoot: string;
  appRelPath: string;
};

/** Why a contract root could not be resolved. */
export type ContractRootErrorCode =
  'DESIGN_NOT_FRONTEND' | 'DESIGN_APP_AMBIGUOUS' | 'DESIGN_APP_NOT_FOUND';

export type ContractRootResult =
  | { ok: true; root: ContractRoot }
  | {
      ok: false;
      code: ContractRootErrorCode;
      message: string;
      /** The frontend app roots that were found, when the caller must choose. */
      candidates?: string[];
    };
