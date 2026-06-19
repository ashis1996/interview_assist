// PKCE helpers for the Google OAuth (authorization-code + PKCE) flow (Req 1.2).
//
// Pure, dependency-light helpers built on Node's crypto. The OAuth flow is
// conducted in the SYSTEM BROWSER (never an embedded webview); these helpers
// generate the verifier/challenge and the loopback redirect URL.

import { createHash, randomBytes } from 'node:crypto'

/** base64url-encode a buffer (no padding). */
function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a high-entropy PKCE `code_verifier` (43-128 chars per RFC 7636). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(48))
}

/** Derive the S256 `code_challenge` from a verifier. */
export function deriveCodeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

/** Generate an opaque CSRF `state` parameter. */
export function generateState(): string {
  return base64Url(randomBytes(16))
}

/** A complete PKCE parameter set for one authorization request. */
export interface PkcePair {
  codeVerifier: string
  codeChallenge: string
  state: string
}

export function createPkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier()
  return {
    codeVerifier,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    state: generateState(),
  }
}

/** The loopback redirect URI used to receive the OAuth code (Req 1.2). */
export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/oauth/callback`
}
