import type { CapabilitySource } from './recommendation-types.js';

/**
 * Tail slice of `seedCapabilitySources` — the `sourceGroup: 'mcp-server'`
 * entries — hoisted VERBATIM out of `capability-seed-sources.ts` for the
 * 300-line cap (C-family wave 4, leaf c4w1-artifacts). No element was
 * rewritten; the parent composes `[<head>, ...this]` so the exported array
 * stays element-for-element identical in the original order.
 */
export const capabilitySeedMcpServerSources: CapabilitySource[] = [
  {
    sourceId: 'everything-claude-code',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'everything-claude-code',
    url: 'https://github.com/affaan-m/everything-claude-code',
    trustSignals: {
      sourceReputation: 'hackathon-winning Claude Code resource collection',
      notes: ['Treat as a source bundle; deep indexing is required before broad automatic use.']
    },
    discoveryStatus: 'indexed',
    items: [
      'everything-claude-code.code-review-agent',
      'everything-claude-code.code-review-guidance',
      'everything-claude-code.language-standards',
      'everything-claude-code.security-review-agent',
      'everything-claude-code.security-review-guidance'
    ]
  },
  {
    sourceId: 'andrej-karpathy-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'andrej-karpathy-skills',
    url: 'https://github.com/multica-ai/andrej-karpathy-skills',
    discoveryStatus: 'unscanned',
    items: ['andrej-karpathy-skills.guidance']
  },
  {
    sourceId: 'mattpocock-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'mattpocock/skills',
    url: 'https://github.com/mattpocock/skills',
    trustSignals: {
      notes: [
        'Catalog/reference only; do not vendor, install, or execute upstream skills from the capability map.',
        'Inspect upstream skill content before applying any method and never persist sensitive upstream examples.'
      ]
    },
    discoveryStatus: 'indexed',
    items: [
      'mattpocock-skills.product-prd-methods',
      'mattpocock-skills.engineering-diagnosis',
      'mattpocock-skills.tdd-method',
      'mattpocock-skills.qa-triage',
      'mattpocock-skills.handoff-context',
      'mattpocock-skills.git-guardrails'
    ]
  },
  {
    sourceId: 'impeccable',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'impeccable',
    url: 'https://github.com/pbakaus/impeccable',
    discoveryStatus: 'unscanned',
    items: ['impeccable.quality-guidance']
  },
  {
    sourceId: 'vercel-agent-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'Vercel Agent Skills',
    url: 'https://github.com/vercel-labs/agent-skills',
    discoveryStatus: 'unscanned',
    items: ['vercel-agent-skills.skill-pack']
  },
  {
    sourceId: 'agent-browser',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'Agent Browser',
    url: 'https://github.com/vercel-labs/agent-browser',
    discoveryStatus: 'indexed',
    items: ['agent-browser.browser-agent']
  },
  {
    sourceId: 'claude-mem',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'claude-mem',
    url: 'https://github.com/thedotmack/claude-mem',
    discoveryStatus: 'indexed',
    items: ['claude-mem.memory-persistence']
  },
  {
    sourceId: 'darwin-skill',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'darwin-skill',
    url: 'https://github.com/alchaincyf/darwin-skill',
    discoveryStatus: 'unscanned',
    items: ['darwin-skill.external-skill']
  },
  {
    sourceId: 'claude-code-best-practice',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'Claude Code Best Practice',
    url: 'https://github.com/shanraisshan/claude-code-best-practice',
    discoveryStatus: 'indexed',
    items: ['claude-code-best-practice.workflow-guidance']
  },
  {
    sourceId: 'openspec',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'OpenSpec',
    url: 'https://github.com/Fission-AI/OpenSpec',
    discoveryStatus: 'indexed',
    items: ['openspec.spec-workflow']
  },
  {
    sourceId: 'gitnexus',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'GitNexus',
    url: 'https://github.com/abhigyanpatwari/GitNexus',
    discoveryStatus: 'unscanned',
    items: ['gitnexus.repo-intelligence']
  },
  {
    sourceId: 'taste-skill',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'taste-skill',
    url: 'https://github.com/Leonxlnx/taste-skill',
    discoveryStatus: 'unscanned',
    items: ['taste-skill.design-critique']
  },
  {
    sourceId: 'ui-ux-pro-max-skill',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'ui-ux-pro-max-skill',
    url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    discoveryStatus: 'unscanned',
    items: ['ui-ux-pro-max-skill.design-guidance']
  },
  {
    sourceId: 'ruflo-mcp-server',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'Ruflo',
    url: 'https://github.com/ruvnet/ruflo',
    discoveryStatus: 'unscanned',
    items: ['ruflo-mcp-server.workflow-reference']
  },
  {
    sourceId: 'superpowers',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'Superpowers',
    url: 'https://github.com/obra/superpowers',
    discoveryStatus: 'indexed',
    items: ['superpowers.workflow-methodology']
  },
  {
    sourceId: 'penpot',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'Penpot',
    url: 'https://github.com/penpot/penpot',
    discoveryStatus: 'indexed',
    items: ['penpot.design-source']
  },
  {
    sourceId: 'gstack',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'gstack',
    url: 'https://github.com/garrytan/gstack',
    discoveryStatus: 'indexed',
    items: ['gstack.product-stack-guidance']
  },
  {
    sourceId: 'awesome-design-md',
    sourceType: 'repo',
    sourceGroup: 'mcp-server',
    title: 'awesome-design-md',
    url: 'https://github.com/VoltAgent/awesome-design-md',
    discoveryStatus: 'indexed',
    items: ['awesome-design-md.design-reference']
  },
  {
    sourceId: 'anthropic-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'Anthropic Skills',
    url: 'https://github.com/anthropics/skills',
    discoveryStatus: 'unscanned',
    items: ['anthropic-skills.skill-pack']
  },
  {
    sourceId: 'vercel-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'Vercel Skills',
    url: 'https://github.com/vercel-labs/skills',
    discoveryStatus: 'unscanned',
    items: ['vercel-skills.skill-pack']
  },
  {
    sourceId: 'reactbits',
    sourceType: 'website',
    sourceGroup: 'mcp-server',
    title: 'React Bits',
    url: 'https://reactbits.dev/',
    discoveryStatus: 'indexed',
    items: ['reactbits.ui-reference']
  },
  {
    sourceId: 'azure-skills',
    sourceType: 'skills-package',
    sourceGroup: 'mcp-server',
    title: 'Azure Skills',
    url: 'https://github.com/microsoft/azure-skills',
    trustSignals: {
      notes: ['Cloud operations require explicit user confirmation and credential boundaries.']
    },
    discoveryStatus: 'unscanned',
    items: ['azure-skills.cloud-skill-pack']
  }
];
