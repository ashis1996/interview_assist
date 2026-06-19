// Static role-adjacency and topic-role mapping data used by the Scope_Checker.
//
// Relocated verbatim from v1 `src/shared/mappings.ts`. The canonical role
// identifiers are the TopicDomain string values, so role categories, topic-role
// targets, and adjacency keys share one vocabulary.

import { TOPIC_DOMAINS, type TopicDomain } from './types'

/** Maps a role identifier to the roles considered adjacent to it. */
export type RoleAdjacencyMap = Record<string, string[]>

/** Maps each topic domain to the roles that topic maps to. */
export type TopicRoleMap = Record<TopicDomain, string[]>

/**
 * Default role-adjacency mapping over the canonical IT role identifiers.
 *
 * Adjacency is intended to be symmetric: if A lists B, B lists A. Each role's
 * own identifier is omitted from its adjacency list (a role is trivially "in
 * scope" with itself, which the Scope_Checker handles separately).
 */
export const DEFAULT_ROLE_ADJACENCY: RoleAdjacencyMap = {
  'software-development': ['qa-testing', 'architecture', 'databases', 'devops'],
  databases: ['software-development', 'data-engineering', 'system-design'],
  'system-design': ['architecture', 'databases', 'cloud', 'software-development'],
  devops: ['cloud', 'linux', 'monitoring', 'software-development'],
  cloud: ['devops', 'system-design', 'security', 'linux'],
  linux: ['devops', 'monitoring', 'security'],
  monitoring: ['devops', 'linux', 'cloud'],
  'qa-testing': ['software-development', 'management'],
  architecture: ['system-design', 'software-development', 'cloud'],
  management: ['qa-testing', 'architecture'],
  'data-engineering': ['databases', 'cloud', 'software-development'],
  security: ['cloud', 'linux', 'devops'],
}

/**
 * Default topic-to-role mapping. Every TopicDomain maps to at least the role
 * sharing its identifier, plus closely related roles where natural.
 */
export const DEFAULT_TOPIC_ROLE_MAP: TopicRoleMap = {
  'software-development': ['software-development'],
  databases: ['databases', 'data-engineering'],
  'system-design': ['system-design', 'architecture'],
  devops: ['devops'],
  cloud: ['cloud', 'devops'],
  linux: ['linux', 'devops'],
  monitoring: ['monitoring', 'devops'],
  'qa-testing': ['qa-testing'],
  architecture: ['architecture', 'system-design'],
  management: ['management'],
  'data-engineering': ['data-engineering', 'databases'],
  security: ['security'],
}

// Compile-time guarantee that the topic-role map covers every TopicDomain.
const _topicRoleCoverageCheck: Record<TopicDomain, string[]> = DEFAULT_TOPIC_ROLE_MAP
void _topicRoleCoverageCheck
void TOPIC_DOMAINS
