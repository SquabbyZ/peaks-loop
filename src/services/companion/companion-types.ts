/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1) — types shared by the
 * `peaks companion ...` service family. The values are intentionally
 * narrow (weixin-only) but the channel *type* is an enum so future
 * channels (feishu / slack / ...) plug in without re-shaping the
 * service surface. The PRD marks those future channels as out of
 * scope for this slice; the runtime *rejects* them with EX_USAGE.
 */

export type CompanionChannel = 'weixin';

/** Channels supported by the cc-connect weixin integration in this slice. */
export const COMPANION_CHANNELS: readonly CompanionChannel[] = ['weixin'] as const;

export const DEFAULT_COMPANION_CHANNEL: CompanionChannel = 'weixin';

/** EX_USAGE (sysexits.h) — surfaced when an unsupported channel is requested. */
export const CHANNEL_UNSUPPORTED_EXIT_CODE = 64;

export type CompanionProbe = {
  /** Resolved absolute path to the cc-connect binary, or null when not on PATH. */
  binaryPath: string | null;
  /** Version string from `cc-connect --version` (post-trim), or null when probe failed. */
  version: string | null;
  /** True when the probe successfully spawned the binary and parsed a version line. */
  ok: boolean;
  /** Underlying error message when ok=false. */
  error: string | null;
};

export type CompanionBinaryCacheRecord = {
  binaryPath: string;
  version: string;
  resolvedAt: string;
  /** Source of the resolution (e.g. "PATH", "PATH_CACHE", "BREW", "MANUAL"). */
  source: string;
};

export type CompanionPairingState =
  | 'unknown'
  | 'not-scanned'
  | 'scanned-waiting-confirm'
  | 'logged-in'
  | 'expired'
  | 'error';

export const COMPANION_PAIRING_LABELS: Readonly<Record<CompanionPairingState, string>> = {
  unknown: 'Unknown',
  'not-scanned': 'QR not scanned yet',
  'scanned-waiting-confirm': 'Scanned, waiting for WeChat confirmation',
  'logged-in': 'Logged in',
  expired: 'Login expired',
  error: 'Error'
};
