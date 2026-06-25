// Barrel re-export for the shared package: pure domain logic, shared types and
// mappings, the client<->backend session protocol, and the credit core.

export * from './types'
export * from './mappings'
export * from './protocol'
export * from './credits'
export * from './redact'

export * from './domain/topicDetector'
export * from './domain/scopeChecker'
export * from './domain/scopeColor'
export * from './domain/promptBuilder'
export * from './domain/sttFinalize'
export * from './domain/sttThreshold'
export * from './domain/session'
export * from './domain/profileMerge'
export * from './domain/profileValidation'
export * from './domain/llmResolve'
export * from './domain/sanitizeCode'
export * from './domain/geometry'
export * from './domain/captureToggle'
