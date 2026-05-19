#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isBrokenSymlink(stats, targetPath) {
  return stats.isSymbolicLink() && !existsSync(targetPath);
}

function getManagedTarget(targetPath) {
  const markerPath = `${targetPath}.peaks-managed`;
  if (!existsSync(markerPath)) {
    return null;
  }
  return readFileSync(markerPath, 'utf8').trim();
}

function markManagedPeaksLink(targetPath, sourcePath) {
  const markerPath = `${targetPath}.peaks-managed`;
  writeFileSync(markerPath, `${sourcePath}\n`, 'utf8');
}

function isManagedPeaksOutputStyle(managedTarget, outputStyleName) {
  if (managedTarget === null) return false;
  return managedTarget.replaceAll('\\', '/').endsWith(`/output-styles/${outputStyleName}`);
}

function createInstallResult() {
  return { installed: [], skipped: [] };
}

export function installBundledSkills(options = {}) {
  const packageRoot = resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const skillsRoot = join(packageRoot, 'skills');
  const targetRoot = resolve(options.targetRoot ?? process.env.PEAKS_CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills'));

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(skillsRoot)) {
    return createInstallResult();
  }

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });

  for (const skillName of readdirSync(skillsRoot)) {
    const sourcePath = join(skillsRoot, skillName);
    const skillFile = join(sourcePath, 'SKILL.md');
    const targetPath = join(targetRoot, skillName);

    if (!lstatSync(sourcePath).isDirectory() || !existsSync(skillFile)) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      if (current.isSymbolicLink() && readlinkSync(targetPath) === sourcePath) {
        installed.push(skillName);
        continue;
      }
      if (isBrokenSymlink(current, targetPath) && managedTarget === readlinkSync(targetPath)) {
        unlinkSync(targetPath);
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(skillName);
        continue;
      }
    }

    symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    markManagedPeaksLink(targetPath, sourcePath);
    installed.push(skillName);
  }

  return { installed, skipped };
}

export function installBundledOutputStyles(options = {}) {
  const packageRoot = resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const outputStylesRoot = join(packageRoot, 'output-styles');
  const targetRoot = resolve(options.targetRoot ?? process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR ?? join(homedir(), '.claude', 'output-styles'));

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(outputStylesRoot)) {
    return createInstallResult();
  }

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });

  for (const outputStyleName of readdirSync(outputStylesRoot)) {
    const sourcePath = join(outputStylesRoot, outputStyleName);
    const targetPath = join(targetRoot, outputStyleName);

    if (!lstatSync(sourcePath).isFile() || !outputStyleName.endsWith('.md')) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      if (isManagedPeaksOutputStyle(managedTarget, outputStyleName)) {
        unlinkSync(targetPath);
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(outputStyleName);
        continue;
      }
    }

    copyFileSync(sourcePath, targetPath);
    markManagedPeaksLink(targetPath, sourcePath);
    installed.push(outputStyleName);
  }

  return { installed, skipped };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const skillsResult = installBundledSkills();
    const outputStylesResult = installBundledOutputStyles();
    if (skillsResult.installed.length > 0) {
      process.stdout.write(`Peaks skills linked: ${skillsResult.installed.join(', ')}\n`);
    }
    if (skillsResult.skipped.length > 0) {
      process.stderr.write(`Peaks skills skipped because local files already exist: ${skillsResult.skipped.join(', ')}\n`);
    }
    if (outputStylesResult.installed.length > 0) {
      process.stdout.write(`Peaks output styles installed: ${outputStylesResult.installed.join(', ')}\n`);
    }
    if (outputStylesResult.skipped.length > 0) {
      process.stderr.write(`Peaks output styles skipped because local files already exist: ${outputStylesResult.skipped.join(', ')}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Peaks skills and output styles were not installed: ${message}\n`);
    process.exitCode = 1;
  }
}
