export const RUNTIME_VERSION = '4.0.0';
export { ClaudeAdapter } from './vendor/claude-adapter';
export { VendorAdapterRegistry, defaultRegistry } from './vendor/registry';
export type { VendorAdapter } from './vendor/adapter';
export { ProcessSupervisor } from './process-supervisor';
export { LifecycleOwner } from './lifecycle';
export { PromptBuilder } from './prompt-builder';