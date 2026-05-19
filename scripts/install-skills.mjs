#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
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

function linksToSamePath(targetPath, sourcePath) {
  try {
    return realpathSync(targetPath) === realpathSync(sourcePath);
  } catch {
    return false;
  }
}

export function installBundledSkills(options = {}) {
  const packageRoot = resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const skillsRoot = join(packageRoot, 'skills');
  const targetRoot = resolve(options.targetRoot ?? process.env.PEAKS_CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills'));

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(skillsRoot)) {
    return { installed: [], skipped: [] };
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
      if (!current.isSymbolicLink() || !linksToSamePath(targetPath, sourcePath)) {
        skipped.push(skillName);
        continue;
      }
      installed.push(skillName);
      continue;
    }

    symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    installed.push(skillName);
  }

  return { installed, skipped };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = installBundledSkills();
    if (result.installed.length > 0) {
      process.stdout.write(`Peaks skills linked: ${result.installed.join(', ')}\n`);
    }
    if (result.skipped.length > 0) {
      process.stderr.write(`Peaks skills skipped because local files already exist: ${result.skipped.join(', ')}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Peaks skills were not linked: ${message}\n`);
    process.exitCode = 1;
  }
}
