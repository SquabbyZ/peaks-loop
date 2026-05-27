#!/usr/bin/env node

// SessionStart hook (matcher: compact)
// After context compaction, re-injects Peaks skill status into Claude's context.
// Tracks state to show "skill no longer active" reminder exactly once.

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateFile = path.join(projectDir, '.peaks', 'last-skill-state.json');
const activeSkillFile = path.join(projectDir, '.peaks', '.active-skill.json');

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function deleteFile(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

const activeSkill = readJSON(activeSkillFile);
const prevState = readJSON(stateFile);

const skillName = activeSkill?.skill || null;
const prevSkillName = prevState?.lastKnownSkill || null;

if (!prevState) {
  // First compaction in this session (or state was cleaned up).
  // Initialize state and show current skill status if active.
  if (skillName) {
    writeJSON(stateFile, { lastKnownSkill: skillName, shownAt: new Date().toISOString() });
    const mode = activeSkill.mode ? ` | Mode: ${activeSkill.mode}` : '';
    const gate = activeSkill.gate ? ` | Gate: ${activeSkill.gate}` : '';
    process.stdout.write(`Peaks Skill: ${skillName}${mode}${gate}\n`);
  }
  // No skill active → no output, no state file created.
} else if (skillName && skillName === prevSkillName) {
  // Same skill still active. Update timestamp, re-show status.
  writeJSON(stateFile, { lastKnownSkill: skillName, shownAt: new Date().toISOString() });
  const mode = activeSkill.mode ? ` | Mode: ${activeSkill.mode}` : '';
  const gate = activeSkill.gate ? ` | Gate: ${activeSkill.gate}` : '';
  process.stdout.write(`Peaks Skill: ${skillName}${mode}${gate}\n`);
} else if (skillName && skillName !== prevSkillName) {
  // Different skill now active (previous was cleared, new one started).
  writeJSON(stateFile, { lastKnownSkill: skillName, shownAt: new Date().toISOString() });
  const mode = activeSkill.mode ? ` | Mode: ${activeSkill.mode}` : '';
  const gate = activeSkill.gate ? ` | Gate: ${activeSkill.gate}` : '';
  process.stdout.write(`Peaks Skill: ${skillName}${mode}${gate}\n`);
} else if (!skillName && prevSkillName) {
  // Skill was active before, now cleared. Show reminder once.
  process.stdout.write(`Note: ${prevSkillName} is no longer active in this session.\n`);
  deleteFile(stateFile);
}
// else: no previous state, no current skill → no output.
