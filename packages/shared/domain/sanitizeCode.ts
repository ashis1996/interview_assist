// Sanitize "typographic" Unicode look-alikes inside Markdown code so generated
// code is valid when pasted into a real interpreter / judge (e.g. LeetCode).
//
// LLMs intermittently emit pretty Unicode variants — en/em dashes for "-",
// a real arrow glyph for "->", smart quotes for ' and ", an ellipsis char for
// "...", and non-breaking/zero-width spaces. These read fine but cause
// "SyntaxError: invalid syntax" when the code is run. We rewrite them back to
// ASCII, but ONLY inside fenced code blocks and inline code spans, so prose
// typography in explanations is left untouched.

/** Replace common non-ASCII look-alikes with their ASCII equivalents. */
function toAscii(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'") // ' ' ‚ ‛ ′ -> '
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"') // " " „ ‟ ″ -> "
    .replace(/\u2192/g, '->') // → -> ->
    .replace(/[\u2013\u2014\u2212\uFF0D\u2010\u2011]/g, '-') // – — − － ‐ ‑ -> -
    .replace(/\u2026/g, '...') // … -> ...
    .replace(/[\u00A0\u202F\u2007\u2009\u200A]/g, ' ') // various spaces -> space
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // zero-width / BOM -> removed
}

/**
 * Sanitize only the code portions of a Markdown answer: fenced code blocks
 * (```...```) and inline code spans (`...`). Prose is preserved as-is.
 */
export function sanitizeCodeInMarkdown(markdown: string): string {
  if (!markdown) return markdown
  // Fenced code blocks first (greedy-safe, non-greedy per block).
  let out = markdown.replace(/```[\s\S]*?```/g, (block) => toAscii(block))
  // Then inline code spans (single-line, backtick-delimited).
  out = out.replace(/`[^`\n]+`/g, (span) => toAscii(span))
  return out
}

/** Exposed for unit tests. */
export const sanitizeInternals = { toAscii }
