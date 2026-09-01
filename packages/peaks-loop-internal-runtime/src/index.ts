// API contract: RUNTIME_VERSION tracks peaks-loop root version (4.0.x).
// This is what consumers (sub-agents dispatched by peaks-code) check at
// runtime to verify protocol compatibility.
export const RUNTIME_VERSION = '4.0.25';

// npm version: independent 0.0.x SemVer. Runtime is its own package
// (peaks-loop-internal-runtime@NPM_VERSION) on the registry; bumps
// per peaks release notes when its public surface actually changes
// (not per root version bump).
export const RUNTIME_NPM_VERSION = '0.0.10';
export { ClaudeAdapter } from './vendor/claude-adapter.js';
export { CodexAdapter } from './vendor/codex-adapter.js';
export { CopilotAdapter } from './vendor/copilot-adapter.js';
export { VendorAdapterRegistry, defaultRegistry } from './vendor/registry.js';
export type { VendorAdapter } from './vendor/adapter.js';
export { ProcessSupervisor } from './process-supervisor.js';
export { LifecycleOwner } from './lifecycle.js';
export { PromptBuilder } from './prompt-builder.js';
export { StatusProtocol } from './status-protocol.js';
export type { HeartbeatEntry, AutoCompactEvent } from './status-protocol.js';
export { AutoCompactAdapter } from './auto-compact-adapter.js';
export { ResourceBudgetGuard } from './guards/resource-budget.js';
export { dispatchDetached } from './dispatch.js';
export type { DispatchInput, DispatchResult } from './dispatch.js';