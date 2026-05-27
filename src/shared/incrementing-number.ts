/**
 * Utilities for generating incrementing numbered filenames.
 * Used by session-based artifact storage to create files like 001-feature.md.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Get the next available number in a directory.
 * Scans existing .md files and finds the highest numeric prefix.
 * Returns 1 if directory is empty or doesn't exist.
 *
 * @param dirPath - Directory to scan for numbered files
 * @returns Next available number (1, 2, 3, ...)
 */
export function getNextNumber(dirPath: string): number {
  if (!existsSync(dirPath)) return 1;

  const files = readdirSync(dirPath).filter(f => f.endsWith('.md'));
  if (files.length === 0) return 1;

  const numbers = files
    .map(f => {
      const match = /^(\d+)-/.exec(f);
      return match && match[1] ? parseInt(match[1], 10) : NaN;
    })
    .filter(n => !isNaN(n));

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

/**
 * Build a numbered filename from a number and description.
 * Format: 001-description-slug.md
 *
 * @param number - The file number (will be zero-padded to 3 digits)
 * @param description - Human-readable description (converted to kebab-case slug)
 * @returns Formatted filename like "001-feature-name.md"
 */
export function buildNumberedFilename(number: number, description: string): string {
  const padded = String(number).padStart(3, '0');
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50); // Limit slug length
  return `${padded}-${slug}.md`;
}

/**
 * Get the next numbered file path in a directory.
 * Combines getNextNumber() and buildNumberedFilename().
 *
 * @param dirPath - Directory to scan
 * @param description - Description for the filename
 * @returns Full path to the new numbered file
 */
export function getNextNumberedFilePath(dirPath: string, description: string): string {
  const number = getNextNumber(dirPath);
  const filename = buildNumberedFilename(number, description);
  return join(dirPath, filename);
}
