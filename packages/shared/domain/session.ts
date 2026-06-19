// Pure session serialization and Markdown export. Relocated verbatim from v1.
//
// Side-effect free: no file I/O, no mutation of inputs. Persistence lives in the
// backend repositories. Keeping the transforms pure makes the round-trip and
// export-completeness invariants (Properties) easy to verify.

import type { SessionFile } from '../types'

/**
 * Serialize a session to a deterministic, human-readable JSON string (Req 17.5).
 *
 * @param s - The session to serialize.
 * @returns A pretty-printed JSON representation of the session.
 */
export function serializeSession(s: SessionFile): string {
  return JSON.stringify(s, null, 2)
}

/**
 * Parse a JSON string previously produced by {@link serializeSession} back into
 * a {@link SessionFile}. Round-trip preserves the profile snapshot and entries.
 *
 * @param json - A JSON string representing a serialized session.
 * @returns The reconstructed session object.
 */
export function deserializeSession(json: string): SessionFile {
  return JSON.parse(json) as SessionFile
}

/**
 * Render a session as a Markdown document suitable for export (Req 7.5).
 * The output contains the question and answer text of every entry, verbatim.
 *
 * @param s - The session to export.
 * @returns A Markdown document string.
 */
export function exportSessionMarkdown(s: SessionFile): string {
  const p = s.profileSnapshot
  const lines: string[] = []

  lines.push('# Interview Session')
  lines.push('')
  lines.push(`Started at: ${s.startedAt}`)
  lines.push('')

  lines.push('## Profile')
  lines.push('')
  lines.push(`- Name: ${p.name}`)
  lines.push(`- Target role: ${p.targetRole}`)
  lines.push(`- Experience: ${p.experienceYears} years`)
  lines.push(`- Seniority: ${p.seniority}`)
  lines.push(`- Company type: ${p.companyType}`)
  lines.push(`- Roles: ${p.roleCategories.join(', ')}`)
  lines.push(`- Skills: ${p.skills.join(', ')}`)
  lines.push('')

  lines.push('## Q&A')
  lines.push('')
  s.entries.forEach((entry, index) => {
    lines.push(`### Entry ${index + 1}`)
    lines.push('')
    lines.push(`- Time: ${entry.timestamp}`)
    lines.push(`- Topics: ${entry.topics.join(', ')}`)
    lines.push(`- Scope: ${entry.scope}`)
    lines.push('')
    lines.push('**Question:**')
    lines.push('')
    lines.push(entry.question)
    lines.push('')
    lines.push('**Answer:**')
    lines.push('')
    lines.push(entry.answer)
    lines.push('')
  })

  return lines.join('\n')
}
