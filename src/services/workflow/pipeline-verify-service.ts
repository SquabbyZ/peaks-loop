import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { isRequestType } from '../artifacts/artifact-prerequisites.js';

export type PipelineGate = {
  name: string;
  description: string;
  passed: boolean;
  detail: string;
};

export type PipelineVerification = {
  rid: string;
  sessionId: string;
  requestType: RequestType;
  complete: boolean;
  rdPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  qaPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  violations: string[];
  nextActions: string[];
};

async function readFileContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function extractState(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = /^-\s*state:\s*(.+?)\s*$/.exec(rawLine.trim());
    if (match?.[1]) return match[1];
  }
  return 'unknown';
}

async function findRequestFile(projectRoot: string, sessionId: string, role: string, rid: string): Promise<{ path: string; content: string } | null> {
  const dir = join(projectRoot, '.peaks', sessionId, role, 'requests');
  if (!existsSync(dir)) return null;

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === `${rid}.md` || (/^\d+-/.test(entry.name) && entry.name.endsWith(`-${rid}.md`))) {
      const path = join(dir, entry.name);
      const content = await readFileContent(path);
      if (content) return { path, content };
    }
  }
  return null;
}

function rdGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    { name: 'rd-request-exists', description: 'RD request artifact created', passed: false, detail: '' }
  ];

  if (requestType === 'feature' || requestType === 'refactor') {
    gates.push({ name: 'tech-doc', description: 'Technical design doc', passed: false, detail: '' });
  }
  if (requestType === 'bugfix') {
    gates.push({ name: 'bug-analysis', description: 'Bug root-cause analysis', passed: false, detail: '' });
  }
  if (requestType !== 'docs' && requestType !== 'chore' && requestType !== 'config') {
    gates.push({ name: 'code-review', description: 'Code review evidence', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix' || requestType === 'config') {
    gates.push({ name: 'security-review', description: 'Security review evidence', passed: false, detail: '' });
  }

  return gates;
}

function qaGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    { name: 'qa-request-exists', description: 'QA request artifact created', passed: false, detail: '' }
  ];

  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix') {
    gates.push({ name: 'test-cases', description: 'QA test cases', passed: false, detail: '' });
    gates.push({ name: 'test-report', description: 'QA test report with execution results', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix' || requestType === 'config') {
    gates.push({ name: 'security-findings', description: 'QA security findings', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor') {
    gates.push({ name: 'performance-findings', description: 'QA performance findings', passed: false, detail: '' });
  }

  return gates;
}

const RD_QA_HANDOFF_STATES = new Set(['qa-handoff', 'handed-off', 'implemented']);
const QA_COMPLETE_STATES = new Set(['verdict-issued']);

export async function verifyPipeline(options: {
  projectRoot: string;
  rid: string;
  sessionId: string;
  requestType?: string;
}): Promise<PipelineVerification> {
  const requestType = isRequestType(options.requestType ?? '') ? options.requestType as RequestType : 'feature';
  const violations: string[] = [];
  const nextActions: string[] = [];

  const rdGates = rdGatesForType(requestType);
  const qaGates = qaGatesForType(requestType);

  // Check RD phase
  const rdFile = await findRequestFile(options.projectRoot, options.sessionId, 'rd', options.rid);
  let rdInvoked = false;
  let rdState = 'missing';

  if (rdFile) {
    rdInvoked = true;
    rdState = extractState(rdFile.content);
    rdGates[0]!.passed = true;
    rdGates[0]!.detail = `found at ${rdFile.path}`;
  } else {
    violations.push('RD phase skipped: peaks-rd was never invoked for this request (no RD request artifact found)');
    nextActions.push('Invoke Skill(skill="peaks-rd") with the request-id, then run unit tests + code review + security review');
    rdGates[0]!.detail = 'not found';
  }

  // Check RD evidence files
  const RD_EVIDENCE_FILE: Record<string, string> = {
    'tech-doc': 'tech-doc.md',
    'bug-analysis': 'bug-analysis.md',
    'code-review': 'code-review.md',
    'security-review': 'security-review.md'
  };
  for (const gate of rdGates.slice(1)) {
    const fileName = RD_EVIDENCE_FILE[gate.name]!;

    const evidencePath = join(options.projectRoot, '.peaks', options.sessionId, 'rd', fileName);
    if (existsSync(evidencePath)) {
      gate.passed = true;
      gate.detail = evidencePath;
    } else {
      gate.detail = `missing: ${evidencePath}`;
      violations.push(`RD evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/${options.sessionId}/rd/${fileName}`);
    }
  }

  // Check if RD reached qa-handoff
  if (rdInvoked && !RD_QA_HANDOFF_STATES.has(rdState)) {
    violations.push(`RD not ready for QA: state is "${rdState}" — must reach "qa-handoff" (unit tests, karpathy standards, code review, security review complete)`);
    nextActions.push(`Complete RD gates → peaks request transition ${options.rid} --role rd --state qa-handoff`);
  }

  // Check QA phase
  const qaFile = await findRequestFile(options.projectRoot, options.sessionId, 'qa', options.rid);
  let qaInvoked = false;
  let qaState = 'missing';

  if (qaFile) {
    qaInvoked = true;
    qaState = extractState(qaFile.content);
    qaGates[0]!.passed = true;
    qaGates[0]!.detail = `found at ${qaFile.path}`;
  } else {
    violations.push('QA phase skipped: peaks-qa was never invoked for this request (no QA request artifact found)');
    nextActions.push('Invoke Skill(skill="peaks-qa") with the request-id for functional/performance/security testing');
    qaGates[0]!.detail = 'not found';
  }

  // Check QA evidence files
  const QA_EVIDENCE_FILE: Record<string, string> = {
    'test-cases': `test-cases/${options.rid}.md`,
    'test-report': `test-reports/${options.rid}.md`,
    'security-findings': 'security-findings.md',
    'performance-findings': 'performance-findings.md'
  };
  for (const gate of qaGates.slice(1)) {
    const fileName = QA_EVIDENCE_FILE[gate.name]!;

    const evidencePath = join(options.projectRoot, '.peaks', options.sessionId, 'qa', fileName);
    if (existsSync(evidencePath)) {
      gate.passed = true;
      gate.detail = evidencePath;
    } else {
      gate.detail = `missing: ${evidencePath}`;
      violations.push(`QA evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/${options.sessionId}/qa/${fileName}`);
    }
  }

  // Check if QA reached verdict-issued
  if (qaInvoked && !QA_COMPLETE_STATES.has(qaState)) {
    violations.push(`QA not complete: state is "${qaState}" — must reach "verdict-issued" (functional + performance + security checks done)`);
    nextActions.push(`Complete QA gates → peaks request transition ${options.rid} --role qa --state verdict-issued`);
  }

  // RD invoked without QA
  if (rdInvoked && !qaInvoked) {
    violations.push('CRITICAL: peaks-rd was invoked but peaks-qa was NOT — QA functional/performance/security testing is mandatory after all RD work');
    nextActions.push('MUST invoke Skill(skill="peaks-qa") before declaring workflow complete');
  }

  const allRdGatesPassed = rdGates.every((g) => g.passed);
  const allQaGatesPassed = qaGates.every((g) => g.passed);
  const complete = rdInvoked && qaInvoked && allRdGatesPassed && allQaGatesPassed
    && RD_QA_HANDOFF_STATES.has(rdState) && QA_COMPLETE_STATES.has(qaState);

  return {
    rid: options.rid,
    sessionId: options.sessionId,
    requestType,
    complete,
    rdPhase: { invoked: rdInvoked, state: rdState, gates: rdGates },
    qaPhase: { invoked: qaInvoked, state: qaState, gates: qaGates },
    violations,
    nextActions
  };
}
