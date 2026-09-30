import type { CapabilitySource } from './recommendation-types.js';

import { capabilitySeedMcpServerSources } from './capability-seed-sources-mcp-server.js';
export const seedCapabilitySources: CapabilitySource[] = [
  {
    sourceId: 'ruflo-access-repo',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'Ruflo',
    url: 'https://github.com/ruvnet/ruflo',
    trustSignals: {
      notes: [
        'Workflow orchestration reference; do not execute or install from the capability map.'
      ]
    },
    discoveryStatus: 'unscanned',
    items: ['ruflo-access-repo.workflow-reference']
  },
  {
    sourceId: 'context7',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'Context7',
    url: 'https://github.com/upstash/context7',
    trustSignals: { sourceReputation: 'commonly used docs lookup MCP capability' },
    discoveryStatus: 'indexed',
    items: ['context7.docs-lookup']
  },
  {
    sourceId: 'codegraph',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'codegraph',
    url: 'https://github.com/colbymchenry/codegraph',
    trustSignals: {
      notes: [
        'Use through peaks codegraph only; do not run upstream install flows from the capability map.',
        'Local project indexing can create .codegraph artifacts; do not commit generated databases unless explicitly requested.'
      ]
    },
    discoveryStatus: 'indexed',
    items: [
      'codegraph.project-indexing',
      'codegraph.semantic-query',
      'codegraph.impact-analysis',
      'codegraph.context-pack'
    ]
  },
  {
    sourceId: 'playwright-mcp',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'Playwright MCP',
    url: 'https://github.com/microsoft/playwright-mcp',
    trustSignals: { sourceReputation: 'Microsoft browser automation MCP server' },
    discoveryStatus: 'indexed',
    items: ['playwright-mcp.browser-validation']
  },
  {
    sourceId: 'chrome-devtools-mcp',
    sourceType: 'website',
    sourceGroup: 'access-repo',
    title: 'Chrome DevTools MCP',
    url: 'https://www.pulsemcp.com/servers/chrome-devtools',
    trustSignals: { notes: ['Browser inspection and performance debugging capability.'] },
    discoveryStatus: 'indexed',
    items: ['chrome-devtools-mcp.browser-debug']
  },
  {
    sourceId: 'context-mode',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'Context Mode',
    url: 'https://github.com/mksglu/context-mode',
    trustSignals: { notes: ['Context and memory management reference.'] },
    discoveryStatus: 'indexed',
    items: ['context-mode.context-management']
  },
  {
    sourceId: 'modelcontextprotocol-servers',
    sourceType: 'mcp-collection',
    sourceGroup: 'access-repo',
    title: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    trustSignals: { sourceReputation: 'official MCP server collection' },
    discoveryStatus: 'unscanned',
    items: ['modelcontextprotocol-servers.collection']
  },
  {
    sourceId: 'searchcode-mcp',
    sourceType: 'website',
    sourceGroup: 'access-repo',
    title: 'SearchCode MCP',
    url: 'https://www.pulsemcp.com/servers/searchcode',
    trustSignals: {
      notes: [
        'External code search capability; avoid sending secrets or private snippets without approval.'
      ]
    },
    discoveryStatus: 'indexed',
    items: ['searchcode-mcp.code-search']
  },
  {
    sourceId: 'mysql-mcp-server',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'MySQL MCP Server',
    url: 'https://github.com/designcomputer/mysql_mcp_server',
    trustSignals: {
      notes: ['Database access requires explicit credentials and write-query confirmation.']
    },
    discoveryStatus: 'indexed',
    items: ['mysql-mcp.database-inspection']
  },
  {
    sourceId: 'figma-context-mcp',
    sourceType: 'repo',
    sourceGroup: 'access-repo',
    title: 'Figma Context MCP',
    url: 'https://github.com/glips/figma-context-mcp',
    trustSignals: {
      notes: ['Design context extraction requires explicit user-authorized design access.']
    },
    discoveryStatus: 'indexed',
    items: ['figma-context-mcp.design-context']
  },

  // Tail slice (the sourceGroup 'mcp-server' entries, original order preserved)
  // hoisted VERBATIM to ./capability-seed-sources-mcp-server.js for the 300-line
  // cap — compose here so seedCapabilitySources stays element-for-element equal.
  ...capabilitySeedMcpServerSources
];
