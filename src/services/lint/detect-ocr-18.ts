/**
 * 5-state OCR 1.8.x detect. Mirrors the ECC detect shape.
 */
import { spawnSync } from 'node:child_process';
import { OCR_18_PACKAGE } from './ocr-multilang-adapter.js';

export type Ocr18DetectState =
  | 'ready'
  | 'ocr18-missing'
  | 'binary-missing'
  | 'llm-config-missing'
  | 'detection-failed';

export type Ocr18DetectResult = {
  readonly state: Ocr18DetectState;
  readonly npxAvailable: boolean;
  readonly package: typeof OCR_18_PACKAGE;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
};

function probeNpx(): boolean {
  const probe = spawnSync('npx', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function probeOcr18(): boolean {
  const result = spawnSync('npx', ['--package', OCR_18_PACKAGE, '--', 'ocr', 'version'], { encoding: 'utf8' });
  return result.status === 0;
}

export function detectOcr18(): Ocr18DetectResult {
  if (!probeNpx()) {
    return {
      state: 'ocr18-missing',
      npxAvailable: false,
      package: OCR_18_PACKAGE,
      warnings: ['npx is not on PATH'],
      nextActions: ['Install Node.js ≥ 20 with npm to enable `npx --package`.']
    };
  }
  if (!probeOcr18()) {
    return {
      state: 'ocr18-missing',
      npxAvailable: true,
      package: OCR_18_PACKAGE,
      warnings: [`could not resolve ${OCR_18_PACKAGE}`],
      nextActions: ['Run `npm i @alibaba-group/open-code-review@1.8.9` to install the reviewer.']
    };
  }
  return {
    state: 'ready',
    npxAvailable: true,
    package: OCR_18_PACKAGE,
    warnings: [],
    nextActions: []
  };
}
