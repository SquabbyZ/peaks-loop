#!/usr/bin/env node

// SessionEnd hook
// Cleans up ephemeral skill state so the next session starts fresh.

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateFile = path.join(projectDir, '.peaks', 'last-skill-state.json');

try { fs.unlinkSync(stateFile); } catch { /* ignore if not exists */ }
