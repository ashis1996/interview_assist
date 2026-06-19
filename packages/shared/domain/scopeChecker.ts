// Pure scope classification. Relocated verbatim from v1 src/main/domain.
//
// `classifyScope` decides how a detected question relates to the candidate's
// declared roles, returning exactly one Scope_Classification. It is a pure
// function: it reads its inputs, mutates nothing, performs no I/O, and returns
// a deterministic result for a given set of inputs (Req 14.2, 14.3).

import type { ScopeClassification, TopicDomain } from '../types'
import type { RoleAdjacencyMap, TopicRoleMap } from '../mappings'

/**
 * Classify a question's scope relative to the candidate's declared roles.
 *
 * Rules, applied in strict priority order:
 * 1. Empty `topics` → `out-of-scope`.
 * 2. Some detected topic maps to a role in `profileRoles` → `in-scope`.
 * 3. Else, some detected topic maps to a role adjacent to a profile role → `adjacent`.
 * 4. Else → `out-of-scope`.
 *
 * @param topics - The topic domains detected for the question.
 * @param profileRoles - The candidate's declared role identifiers.
 * @param adjacency - Role-adjacency mapping (role → adjacent roles).
 * @param topicToRole - Topic-to-role mapping (topic → mapped roles).
 * @returns Exactly one of `'in-scope' | 'adjacent' | 'out-of-scope'`.
 */
export function classifyScope(
  topics: TopicDomain[],
  profileRoles: string[],
  adjacency: RoleAdjacencyMap,
  topicToRole: TopicRoleMap
): ScopeClassification {
  if (topics.length === 0) {
    return 'out-of-scope'
  }

  const mappedRoles = new Set<string>()
  for (const topic of topics) {
    const roles = topicToRole[topic]
    if (roles) {
      for (const role of roles) {
        mappedRoles.add(role)
      }
    }
  }

  const profileRoleSet = new Set(profileRoles)
  for (const role of mappedRoles) {
    if (profileRoleSet.has(role)) {
      return 'in-scope'
    }
  }

  const adjacentRoles = new Set<string>()
  for (const profileRole of profileRoles) {
    const neighbors = adjacency[profileRole]
    if (neighbors) {
      for (const neighbor of neighbors) {
        adjacentRoles.add(neighbor)
      }
    }
  }
  for (const role of mappedRoles) {
    if (adjacentRoles.has(role)) {
      return 'adjacent'
    }
  }

  return 'out-of-scope'
}
