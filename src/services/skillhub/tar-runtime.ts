import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Thrown when no usable tar binary can be located. */
export class TAR_NOT_FOUND extends Error {
  constructor(msg: string) {
    super(`TAR_NOT_FOUND: ${msg}`);
    this.name = "TAR_NOT_FOUND";
  }
}

/**
 * Resolve a tar binary path, in priority order:
 *   1. process.env.PEAKS_TAR_BIN  (explicit override; honored unconditionally)
 *   2. process.env.TAR            (POSIX convention, honored if set)
 *   3. On Windows: C:\Windows\System32\tar.exe (bsdtar — accepts
 *      Windows-style paths verbatim, unlike git-bash GNU tar)
 *   4. PATH lookup: "tar" (delegates to the platform default)
 *
 * Throws `TAR_NOT_FOUND` when none of the candidates exist (Windows
 * file-system check) or no override is set (POSIX). On POSIX we
 * always trust PATH; tar is in base images 99.9% of the time. On
 * Windows we explicitly stat each candidate so a missing
 * C:\Windows\System32\tar.exe falls through to PATH instead of
 * throwing an opaque spawn-ENOENT.
 */
function resolveTarBin(): string {
  const envOverride = process.env.PEAKS_TAR_BIN;
  if (envOverride && envOverride.length > 0) return envOverride;

  const envTar = process.env.TAR;
  if (envTar && envTar.length > 0) return envTar;

  if (process.platform === "win32") {
    const systemTar = "C:\\Windows\\System32\\tar.exe";
    if (existsSync(systemTar)) return systemTar;
    // Fall through to PATH lookup below — many dev setups install tar
    // under Git for Windows or WindowsApps rather than System32.
  }

  // PATH lookup. We can't stat `tar` directly (it's a name, not a path),
  // so we trust the resolution to execFileSync and surface a clean
  // TAR_NOT_FOUND error from the caller if it fails.
  return "tar";
}

/**
 * Run `tar <args...>` in a cross-platform way.
 *
 * Args MUST be `["-czf", outPath, "-C", stageDir, "."]` style (no
 * shell quoting needed because we use execFileSync, not execSync).
 *
 * After the Critical #3 fix:
 *   - Honors PEAKS_TAR_BIN / TAR env vars.
 *   - On Windows, tries C:\Windows\System32\tar.exe first; falls back
 *     to PATH lookup if it's missing.
 *   - Accumulates tar's stderr and re-throws it on non-zero exit so
 *     operators can see WHY tar failed (path typo, permission, corrupt
 *     stage dir, etc.) instead of swallowing it.
 *
 * Throws `TAR_NOT_FOUND` when the binary cannot be located.
 */
export function runTar(args: string[]): void {
  const cmd = resolveTarBin();
  try {
    execFileSync(cmd, args, {
      stdio: ["ignore", "ignore", "pipe"],
      // Surface stderr text rather than dumping a Buffer at the caller.
      // execFileSync with stdio: ["ignore","ignore","pipe"] captures the
      // stderr stream into the Error's `.stderr` Buffer when the child
      // exits non-zero.
    });
  } catch (e: unknown) {
    // Distinguish "binary not found" from "binary ran but failed".
    if (e && typeof e === "object" && "code" in e) {
      const code = (e as { code?: unknown }).code;
      if (code === "ENOENT") {
        throw new TAR_NOT_FOUND(
          `tar binary not found (cmd="${cmd}"). Set PEAKS_TAR_BIN to override, or install tar (Windows: bsdtar is bundled with Windows 10+).`
        );
      }
    }
    // Non-zero exit from tar itself — re-throw with stderr text.
    const stderr = (e as { stderr?: Buffer | string } | null | undefined)?.stderr;
    const stderrText =
      stderr instanceof Buffer
        ? stderr.toString("utf-8")
        : typeof stderr === "string"
        ? stderr
        : "";
    const baseMsg =
      e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
    const wrapped = new Error(
      `tar exited non-zero (cmd="${cmd}"): ${baseMsg}${
        stderrText ? `\ntar stderr:\n${stderrText.trimEnd()}` : ""
      }`
    );
    (wrapped as Error & { cause?: unknown }).cause = e;
    throw wrapped;
  }
}