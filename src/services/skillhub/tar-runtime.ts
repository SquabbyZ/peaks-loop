import { execFileSync } from "node:child_process";

/**
 * Run `tar <args...>` in a cross-platform way.
 *
 * On Windows, git-bash's GNU tar interprets a leading `C:` in the
 * argument list as a remote-host prefix and refuses to connect, so
 * we resolve to `C:\Windows\System32\tar.exe` (bsdtar) which accepts
 * Windows-style paths verbatim. On POSIX we just exec `tar`.
 *
 * Args MUST be `["-czf", outPath, "-C", stageDir, "."]` style (no
 * shell quoting needed because we use execFileSync, not execSync).
 */
export function runTar(args: string[]): void {
  const cmd = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
}
