// Safe redaction helpers for logging (Req 9.1, 9.2, 9.4; Design J).
//
// Rule: never log a raw Access_Token, Refresh_Token, or Provider_Secret value.
// Auth-event log lines should use `redact()` so a secret's PRESENCE can be noted
// (useful for debugging "did the client send a token?") without ever leaking the
// value itself. `redactToken()` keeps a tiny, non-reconstructable correlation
// hint for longer tokens when that is helpful.

/**
 * Fully mask a secret value for logging.
 *
 * Returns a fixed marker that reveals neither the value nor its length:
 * - absent/empty -> `'(absent)'`
 * - present      -> `'***'`
 *
 * Use for tokens, refresh tokens, and any provider secret in a log line.
 */
export function redact(value: string | undefined | null): string {
  if (!value) return '(absent)'
  return '***'
}

/**
 * Mask a token while keeping a short, non-reconstructable correlation hint (the
 * last 4 characters) — but only when the token is long enough that those 4
 * characters cannot reconstruct it. Shorter values are fully masked.
 *
 * Never returns the full token. Example: a long token -> `'tok…Ab12'`.
 */
export function redactToken(value: string | undefined | null): string {
  if (!value) return '(absent)'
  // For short values, even a 4-char suffix could be most of the secret, so mask
  // it entirely.
  if (value.length <= 8) return '***'
  return `tok…${value.slice(-4)}`
}
