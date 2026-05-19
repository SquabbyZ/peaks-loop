# Peaks SDD Skill Family Design

Date: 2026-05-14
Status: Draft for review

## 1. Purpose

Current `peaks-sdd` can complete small end-to-end business requests, but team collaboration exposes larger problems: role boundaries are unclear, handoff artifacts are not protocolized, context is not portable, and downstream changes are hard to synchronize across product, design, engineering, QA, and incident response.

This design evolves `peaks-sdd` from a single end-to-end skill into a vendor-neutral AI collaboration system built around role skills, shared artifacts, context capsules, synchronization, issue handling, and continuous skill harvesting.

The goal is real productivity, not process completeness for its own sake:

- Low learning cost: users describe work in natural language.
- AI recommends workflow mode and skill composition, but users decide.
- Intermediate artifacts reduce communication cost.
- Swarm execution reduces delivery and exploration time.
- Human-readable and model-readable artifacts remain synchronized.
- Outputs are model-vendor-neutral and reusable across tools.
- Skills augment people; they do not replace professional judgment.

## 2. Product Philosophy

### 2.1 Human-in-the-loop augmentation

Peaks is not designed to replace product managers, designers, engineers, QA, or release owners.

Skills may automate:

- drafting;
- analysis;
- coding;
- testing;
- synchronization;
- evidence collection;
- report generation;
- candidate exploration;
- impact analysis;
- archival.

Humans retain final authority over:

- product decisions;
- architecture decisions;
- UI/UX acceptance;
- QA acceptance;
- release risk acceptance;
- production incident severity;
- rollback/degradation approval.

Reports must distinguish:

- `AI Verified`: automatically checked with evidence;
- `Human Required`: must be reviewed by a person;
- `Human Confirmed`: explicitly confirmed by a person;
- `Risk Accepted`: known risk accepted by a person.

### 2.2 Floor-raising principle

Peaks should raise the minimum quality of collaboration, not guarantee the same maximum outcome for every user. Different users, industries, tools, models, MCP availability, and habits will produce different results.

The system should:

- help inexperienced users avoid missing critical steps;
- help experienced users reduce repetitive work;
- reduce avoidable communication loss across roles;
- make AI outputs better aligned with user input and business context.

### 2.3 Fit-for-context principle

Technology, product design, and testing methods are not inherently good or bad. They are more or less suitable for the current business, constraints, team maturity, delivery scenario, risk tolerance, and maintenance capacity.

Every option should be evaluated by:

- business fit;
- user experience;
- implementation cost;
- maintenance cost;
- team familiarity;
- maturity;
- rollback path;
- QA coverage feasibility;
- delivery urgency;
- long-term value.

### 2.4 Boundary expansion principle

Skills should help users break out of their current experience boundary without replacing their decisions.

For product, design, engineering, QA, and refactoring, role skills should surface:

1. the user's intuitive or familiar approach;
2. mature industry alternatives;
3. higher-quality but more expensive approaches;
4. forward-looking approaches marked `use with caution`;
5. approaches not recommended and why;
6. human decision points.

Cutting-edge methods must be labeled with maturity, risks, prerequisites, and when not to use them.

## 3. Skill Product Family

### 3.1 Role skills

The system should split into role-oriented skills. Each skill supports both independent use and orchestrated use.

| Skill | Primary responsibility |
| --- | --- |
| `peaks-product` | Product brainstorming, PRD, acceptance criteria, requirement changes, product context capsules |
| `peaks-design` / `peaks-ui` | UI/UX, interaction, visual direction, high-fidelity HTML prototypes, experience artifacts |
| `peaks-rd` | Architecture options, technical design, task breakdown, implementation, unit tests, review, security |
| `peaks-qa` | Test matrix, test cases, automation patches, regression scope, validation reports |
| `peaks-issue` / `peaks-incident` | QA issues, production incidents, reproduction artifacts, mitigation, repair, postmortems |
| `peaks-artifact` | Vendor-neutral artifact protocol, schema validation, diff, trace, impact analysis |
| `peaks-context` | Context capsule generation, compression, role slicing, staleness checks |
| `peaks-sync` | Feishu/Lark and repo synchronization, proposal, approval, conflict detection |
| `peaks-sdd` | Orchestrator: scenario recognition, mode recommendation, cross-skill orchestration, final match report |

### 3.2 Independent and orchestrated modes

Each role skill must work in two modes.

Independent mode examples:

- a product manager uses `peaks-product` to generate a PRD package;
- a designer uses `peaks-design` to explore interaction options;
- an engineer uses `peaks-rd` to design and implement a technical change;
- QA uses `peaks-qa` to create test matrices and reports.

Orchestrated mode examples:

- `peaks-sdd` runs product → design → RD → QA for a new project;
- `peaks-sdd` routes a QA issue to RD for fix and back to QA for regression;
- `peaks-sdd` runs incident mode and coordinates RD, QA, and postmortem outputs.

### 3.3 Swarm inside every role skill

Each role skill should be able to use swarm execution when useful.

Examples:

- `peaks-product`: requirement clarifier, user story analyst, acceptance criteria reviewer, domain risk analyst;
- `peaks-design`: UX flow designer, visual direction agent, accessibility reviewer, prototype generator;
- `peaks-rd`: architect, frontend, backend, database, code reviewer, security reviewer;
- `peaks-qa`: risk analyst, test matrix generator, automation agent, regression analyst, performance reviewer;
- `peaks-issue`: reproduction agent, log analyst, impact analyst, mitigation planner, postmortem writer.

## 4. Workflow Modes

`peaks-sdd` should infer the scenario and recommend a mode. The final decision belongs to the user.

### 4.1 Scenarios

Supported target scenarios:

- `0-to-1`: new product/project;
- `1-to-N`: feature iteration in an existing project;
- bugfix;
- project refactor;
- QA strengthening;
- release validation;
- QA issue handling;
- production incident response;
- postmortem and learning;
- skill harvesting.

### 4.2 Execution modes

| Mode | Use when | Speed strategy |
| --- | --- | --- |
| Fast Mode | Small or urgent low-risk work | Trim ceremony |
| Standard Mode | Normal feature work | Keep key artifacts and gates |
| Team Mode | Multi-role collaboration | Full role handoffs |
| Strict Mode | High-risk/compliance/audit work | Strong gates and evidence |
| Parallel Candidate Mode | User cannot choose among options | Generate candidates/prototypes in parallel |
| Incident Mode | QA blocker or production incident | Reduce impact, diagnose, fix, verify, postmortem |

Important rule:

- Small requests get faster by trimming process.
- Large urgent requests get faster by swarm parallelism, not by blindly cutting quality.

### 4.3 Solo workflow compatibility

Peaks supports solo mode as a collapsed version of the team workflow. The same role skills, artifacts, context capsules, trace links, and validation gates are reused. The difference is approval topology, not artifact semantics.

In team mode:

- product confirms PRD;
- design confirms prototype and UX direction;
- RD confirms architecture and implementation risk;
- QA confirms validation and release evidence.

In solo mode, one user moves through the same role perspectives and confirms each checkpoint as the acting owner for that role.

Solo mode variants:

| Mode | Use when | Behavior |
| --- | --- | --- |
| Solo Fast | Small low-risk request | Minimal role checks and lightweight artifacts |
| Solo Standard | Normal solo feature work | Product/design/RD/QA perspectives are preserved with lighter confirmation |
| Solo Strict | Solo but high-risk work | Strong gates remain even though the same person confirms them |
| Solo Parallel Candidate | Solo user lacks enough experience to choose | Generate candidate options/prototypes in parallel for comparison |

Solo mode should preserve upgradeability: a project started by one person can later move into team mode because artifacts, context capsules, and trace links follow the same protocol.

## 5. Peaks Collaboration Protocol

Peaks needs an MCP-like protocol for team artifacts. The protocol must be model-vendor-neutral and must not depend on Claude/Anthropic-specific formats.

### 5.1 Artifact structure

Each major artifact should have two synchronized representations:

```text
artifact.<id>/
├── human.md
├── model.json
├── manifest.json
├── schema.json
├── trace.json
├── context/
└── evidence/
```

- `human.md`: reviewable by people, suitable for Feishu/Lark, supports natural-language modification.
- `model.json`: structured representation for skills, agents, CI, and other models.
- `manifest.json`: id, version, status, owner, source, hash, remote pointers.
- `schema.json`: JSON Schema for validation.
- `trace.json`: relationships between requirements, decisions, designs, code, tests, issues, and releases.
- `context/`: context capsules and role-specific slices.
- `evidence/`: screenshots, recordings, logs, test results, review records.

### 5.2 Dual-layer schema

Use a dual-layer protocol:

- fixed core fields for interoperability;
- flexible extension fields for domain-specific needs.

Example core fields:

```json
{
  "protocolVersion": "peaks-collaboration/v1",
  "artifactId": "prd.member-management.v1",
  "artifactType": "prd",
  "ownerSkill": "peaks-product",
  "scenario": "1-to-N-feature",
  "status": "draft",
  "summary": "...",
  "intent": {
    "userInput": "...",
    "goals": [],
    "nonGoals": [],
    "constraints": []
  },
  "contracts": {
    "consumableBy": ["peaks-rd", "peaks-qa", "peaks-sdd"],
    "requires": [],
    "provides": []
  },
  "traceability": {
    "sourceInputs": [],
    "derivedArtifacts": [],
    "decisions": [],
    "openQuestions": []
  },
  "acceptance": {
    "criteria": [],
    "risks": []
  },
  "extensions": {}
}
```

### 5.3 Human/model bidirectional sync

When a user asks to modify the human-readable artifact, the system must:

1. modify `human.md` or the Feishu/Lark document;
2. update `model.json` consistently;
3. run schema validation;
4. run human/model consistency checks;
5. calculate downstream impact;
6. generate a diff summary;
7. ask for human confirmation when the artifact is approved or review-facing.

## 6. Context Capsule Protocol

Artifacts alone are not enough. Teams also need portable, precise context.

### 6.1 Why context capsules exist

A downstream role may need to invoke an upstream skill. Example: RD uses `peaks-product` to revise an unclear PRD section. RD does not have the original product VibeCoding context, but dumping the full product conversation is noisy and unsafe.

Context capsules preserve the minimum useful background.

### 6.2 Generation model

Use both:

- real-time capture during role workflows;
- end-of-phase compression and calibration.

### 6.3 Capsule contents

A context capsule should include:

- original request;
- business goal;
- success definition;
- confirmed decisions;
- assumptions;
- discarded options;
- unresolved ambiguities;
- role-specific views;
- staleness and invalidation conditions.

Example:

```json
{
  "capsuleVersion": "peaks-context/v1",
  "sourceSkill": "peaks-product",
  "artifactId": "prd.member-management.v1",
  "audience": ["peaks-rd", "peaks-qa", "peaks-product"],
  "purpose": "Enable downstream roles to understand and safely revise the PRD.",
  "confirmedDecisions": [],
  "assumptions": [],
  "discardedOptions": [],
  "ambiguities": [],
  "roleViews": {
    "rd": { "mustKnow": [], "niceToKnow": [] },
    "qa": { "mustKnow": [], "riskFocus": [] }
  },
  "staleness": { "lastUpdatedAt": "", "invalidatedBy": [] }
}
```

### 6.4 Context slicing

Context must be sliced by task and role.

Examples:

- RD revising product logic needs goals, decisions, assumptions, discarded options, and technical constraints.
- QA generating test cases needs acceptance criteria, states, risks, interaction flows, and edge cases.
- Design reviewing a C-side page needs product goals, user emotion, brand direction, and target behavior.

Do not blindly pass full conversations between roles.

## 7. Feishu/Lark and Repo Synchronization

### 7.1 Source-of-truth model

Use source of truth by artifact type.

Feishu/Lark is primary for:

- product brainstorming;
- PRD;
- design notes;
- high-fidelity prototype review;
- requirement review notes;
- product change proposals;
- human confirmation records.

Repo is primary for:

- engineering execution snapshots;
- task breakdowns;
- code;
- unit tests;
- automated tests;
- review/security/CI evidence.

Both locations are used for QA artifacts:

- Feishu/Lark for human review of test plans, matrices, and acceptance reports;
- repo for automation, coverage, runtime smoke, and CI-consumable evidence.

### 7.2 Sync metadata

Repo snapshots should store remote pointers, not pretend to be the only source of truth.

Example `remote.json`:

```json
{
  "provider": "feishu",
  "spaceId": "...",
  "folderId": "...",
  "documentId": "...",
  "version": "...",
  "lastSyncedAt": "...",
  "contentHash": "..."
}
```

### 7.3 Proposal and approval flow

When RD finds product content unclear:

1. RD creates a Product Clarification Issue.
2. `peaks-sync` reads Feishu/Lark PRD, model artifact, context capsule, and technical constraints.
3. `peaks-product` generates a change proposal.
4. Feishu/Lark shows the diff for product review.
5. Product confirms or rejects.
6. Confirmed changes update human document, model artifact, context capsule, and repo snapshot.
7. Change impact propagates to RD and QA.

A lightweight desktop or local web sync console can be added later for viewing diffs, approvals, conflicts, and sync status. The first phase should prioritize protocol and connector capability over a heavy app.

## 8. Experience Artifact Protocol

Product and design artifacts should be experiential, not only textual.

### 8.1 Structure

```text
experience/
├── prototype.html
├── layout.model.json
├── interaction-flows.json
├── page-states.json
├── component-map.json
├── copy-and-microcopy.md
├── qa-scenarios.seed.json
└── implementation-hints.md
```

### 8.2 Value by role

Product:

- discovers edge cases while using the prototype;
- evaluates interaction and copy;
- sees whether the experience matches business intent.

Design/UI:

- evaluates visual hierarchy, attraction, emotional quality, accessibility, and interaction quality.

Frontend:

- consumes layout and interaction artifacts for more precise implementation.

Backend:

- understands states, permissions, API expectations, validations, and transitions.

QA:

- generates test matrices and cases from states, interactions, and acceptance criteria;
- reviews generated test cases with faster business understanding.

### 8.3 B-side and C-side design weighting

B-side products usually optimize:

- usable;
- efficient;
- clear;
- low-error;
- high information density.

C-side products often require functionality, usability, visual attraction, emotional quality, and user experience at comparable importance.

`peaks-sdd` should decide whether to run lightweight or strong design flow based on product type and risk.

## 9. Change Propagation Protocol

Product changes must propagate to both RD and QA.

After a product change is confirmed, the system should generate:

- RD impact package;
- QA impact package;
- updated artifacts;
- affected downstream artifact list;
- manual review checklist.

QA impact should include:

- test matrix updates;
- cases to modify;
- cases to add;
- cases to retire;
- automation scripts affected;
- acceptance checks affected;
- tester-facing change explanation.

Example:

```json
{
  "artifactType": "change-impact",
  "changeId": "chg.member-expiry-policy.v2",
  "sourceArtifact": "prd.member-management.v1",
  "changedRequirements": [],
  "changedAcceptanceCriteria": [],
  "impactedDomains": ["membership", "permission", "notification"],
  "qaImpact": {
    "testMatrixUpdates": [],
    "casesToModify": [],
    "casesToAdd": [],
    "casesToRetire": [],
    "automationScriptsAffected": []
  }
}
```

## 10. Issue and Incident Protocol

QA issues and production incidents should share a common issue artifact protocol. Production incidents are higher-severity, higher-urgency instances of the same problem-handling chain.

### 10.1 QA issue artifact

```text
issue.<id>/
├── human.md
├── model.json
├── reproduce.md
├── expected-actual.md
├── requirement-links.md
├── environment.json
├── evidence/
│   ├── screenshot.png
│   ├── recording.webm
│   ├── console.log
│   ├── network.har
│   └── server.log
└── regression.md
```

### 10.2 RD consumption flow

`peaks-rd` should consume issue artifacts to:

1. read reproduction steps and evidence;
2. reproduce the issue or replay evidence;
3. link the issue to requirements, design, technical tasks, and code;
4. narrow likely problem areas;
5. implement a minimal fix;
6. generate fix artifact;
7. hand back to QA for regression.

### 10.3 Production incident flow

Incident mode prioritizes:

1. reduce impact;
2. protect data;
3. diagnose root cause;
4. mitigate, degrade, rollback, or hotfix;
5. verify recovery;
6. generate postmortem;
7. update product/RD/QA artifacts;
8. harvest reusable skills or checks.

Incident output should include:

- incident summary;
- impact range;
- timeline;
- suspected and confirmed root cause;
- mitigation plan;
- fix plan;
- verification evidence;
- postmortem;
- follow-up tasks;
- regression additions;
- skill candidates.

## 11. Parallel Candidate Mode

When users lack enough experience to choose among options, Peaks can generate multiple candidates in parallel so users can compare real effects.

Examples:

- product: multiple PRD or workflow directions;
- design: multiple high-fidelity HTML prototypes;
- RD: multiple technical POCs;
- QA: multiple testing strategies or matrices;
- refactor: multiple modernization strategies.

This mode is useful when:

- options differ significantly;
- user cannot evaluate from text alone;
- real effect matters;
- restart cost is low with AI/swarm.

It is not suitable for:

- high-risk hotfixes;
- irreversible database migrations;
- security-sensitive production changes;
- large refactors without rollback plans.

## 12. Project Refactor Workflow

Refactoring should be a first-class scenario.

The skill should not immediately edit code. It should first:

1. read current code and known artifacts;
2. identify business boundaries and pain points;
3. identify technical constraints;
4. produce several refactor options;
5. label maturity, risk, cost, and rollback path;
6. ask humans to choose;
7. create a refactor execution plan;
8. generate QA regression protection before implementation.

Refactor recommendations should prioritize fit for the current business and team, not abstract technical fashion.

## 13. Skill Harvesting

After a role skill delivers intermediate artifacts, it should identify reusable operations and ask whether to persist them as skills.

Examples:

- membership-system PRD generator;
- RBAC testing matrix generator;
- status-machine technical design pattern;
- B-side table-page prototype pattern;
- production status-migration incident checklist.

If the user approves:

1. create a skill candidate artifact;
2. run skill creation;
3. run Darwin-style skill optimization;
4. generate test prompts;
5. install locally;
6. optionally share with teammates.

This creates a continuous organizational learning loop.

## 14. OpenSpec Compatibility

The current brainstorm is compatible with OpenSpec, but it must be represented at the right level.

### 14.1 What fits OpenSpec well

OpenSpec is suitable for:

- adding the new skill-family capabilities to an existing project;
- changing `peaks-sdd` behavior;
- defining new artifact types;
- introducing role skill boundaries;
- adding feature requirements for sync, context, issue, and experience artifacts;
- tracking implementation tasks.

A future OpenSpec change could include:

```text
openspec/changes/peaks-sdd-skill-family/
├── proposal.md
├── design.md
├── tasks.md
└── specs/
    ├── peaks-sdd.md
    ├── peaks-artifact.md
    ├── peaks-context.md
    ├── peaks-sync.md
    ├── peaks-product.md
    ├── peaks-design.md
    ├── peaks-rd.md
    ├── peaks-qa.md
    └── peaks-issue.md
```

### 14.2 What is not yet OpenSpec-ready

This brainstorm is too broad to implement as a single OpenSpec change without decomposition. It should be split into staged changes.

Recommended OpenSpec decomposition:

1. protocol kernel: artifact + context + trace schemas;
2. role skill boundaries: product/design/RD/QA split;
3. Feishu/repo sync connector;
4. experience artifact and high-fidelity prototype workflow;
5. change propagation to RD/QA;
6. issue artifact and QA-to-RD fix loop;
7. incident/postmortem workflow;
8. skill harvesting loop;
9. orchestrator modes and scenario routing.

### 14.3 Required OpenSpec checkpoints

For each staged change:

- proposal must clarify goal, scope, and value;
- specs must define testable behavior and artifact contracts;
- design must describe architecture, risks, dependencies, and migration;
- tasks must be executable and reviewable;
- archive must update current behavior specs after implementation.

## 15. Harness SDD Compatibility

The current direction is compatible with the existing peaks-sdd harness requirements, and it generalizes several of them.

### 15.1 Existing harness requirements already aligned

Current peaks-sdd gates require:

- interactive brainstorming records;
- PRD;
- PRD confirmation;
- OpenAPI/no-API artifact;
- design spec;
- visual design artifact;
- design confirmation;
- system design;
- system design confirmation;
- test plan;
- swarm task graph;
- waves;
- briefs;
- handoffs;
- execution agents;
- module reports;
- code review;
- security review;
- unit test report;
- coverage summary;
- functional/business/performance/runtime smoke reports;
- QA rounds;
- acceptance report;
- final report.

The proposed design keeps these ideas but expands them into a broader protocol.

### 15.2 Required harness evolution

The harness should evolve from checking fixed files only to checking typed artifacts and contracts.

New gates should eventually validate:

- human/model sync status;
- schema validity;
- remote Feishu/Lark sync status;
- context capsule freshness;
- trace graph completeness;
- product/design/RD/QA/issue artifact links;
- change-impact propagation;
- QA asset update evidence;
- issue reproduction evidence;
- human confirmation records;
- skill harvesting proposals.

### 15.3 Important compatibility rule

The new protocol should not remove current gates immediately. It should layer on top of current `.peaks/changes/<change-id>/` outputs, then migrate fixed file checks into protocol-aware checks.

Near-term compatibility mapping:

| Current harness artifact | Future protocol artifact |
| --- | --- |
| `product/prd.md` | `artifact.prd/human.md` |
| `product/prd-confirmation.md` | confirmation record in manifest + human.md |
| `design/design-spec.md` | `artifact.design-spec/human.md` |
| `design/approved-preview.html` | `experience/prototype.html` |
| `architecture/system-design.md` | `artifact.tech-design/human.md` |
| `qa/test-plan.md` | `artifact.test-plan/human.md` |
| `swarm/task-graph.json` | trace graph + swarm execution artifact |
| `swarm/briefs/*.md` | role execution briefs |
| `swarm/handoffs/*.md` | handoff records in trace graph |
| `review/code-review.md` | review artifact |
| `security/security-report.md` | security artifact |
| `qa/*report.md` | QA evidence artifacts |
| `final-report.md` | final delivery summary + match report |

## 16. MVP Recommendation

This design is intentionally broad. MVP should avoid building everything at once.

Recommended MVP sequence:

1. Peaks Collaboration Protocol kernel:
   - artifact folder layout;
   - `human.md` + `model.json`;
   - manifest;
   - schema validation;
   - trace links.
2. Context capsule:
   - product capsule;
   - RD/QA slices;
   - staleness metadata.
3. Role split:
   - `peaks-product`;
   - `peaks-design` lightweight;
   - `peaks-rd`;
   - `peaks-qa`.
4. Experience artifact:
   - high-fidelity HTML prototype;
   - layout and interaction model;
   - QA scenario seed.
5. Change propagation:
   - product change → RD/QA impact packages.
6. Issue artifact:
   - QA issue → RD reproduction/fix → QA regression.
7. Feishu/Lark sync:
   - remote pointer;
   - pull/push snapshots;
   - proposal/diff flow.
8. Skill harvesting:
   - detect candidates;
   - ask user;
   - generate skill candidate.
9. Incident/postmortem:
   - reuse issue protocol;
   - add mitigation and postmortem artifacts.

## 17. Open Questions

1. Should `peaks-artifact`, `peaks-context`, and `peaks-sync` be user-invocable skills, internal libraries, or both?
2. Should Feishu/Lark integration be implemented through MCP, CLI connector, desktop app, or staged across all three?
3. What is the first artifact schema to stabilize: PRD, experience, issue, or change-impact?
4. How strict should human/model sync validation be before human confirmation?
5. Should `peaks-design` be named `peaks-design` or `peaks-ui`?
6. How much of the current `.peaks/changes/<change-id>/` layout should remain as compatibility surface?
7. Should OpenSpec manage the full skill-family design as a parent change with staged child changes?

## 18. Acceptance Criteria for This Design

This design is acceptable if it:

- preserves low learning cost for users;
- supports both single-person automation and team collaboration;
- defines independent and orchestrated skill modes;
- uses vendor-neutral artifacts;
- separates human-readable and model-readable outputs;
- supports precise context transfer rather than full conversation dumps;
- supports Feishu/Lark and repo source-of-truth separation;
- includes design/UI as a first-class role;
- propagates product changes to RD and QA;
- supports QA issue artifacts and production incident reuse;
- keeps humans responsible for final decisions;
- raises quality floor without promising equal expert outcomes;
- can be decomposed into OpenSpec-compatible staged changes;
- can evolve current harness SDD gates rather than bypass them.
