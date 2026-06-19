// Resume text extraction (main process). Converts an uploaded resume file's
// bytes into plain text for the onboarding `background` context. Supports PDF
// (pdf-parse), DOCX (mammoth), and plain text/markdown. Runs in the Node main
// process so the parser libraries have filesystem/Buffer access.

import mammoth from 'mammoth'

/** Extract plain text from resume bytes, dispatching on the file extension. */
export async function parseResumeBytes(fileName: string, bytes: ArrayBuffer): Promise<string> {
  const lower = fileName.toLowerCase()
  const buf = Buffer.from(bytes)

  if (lower.endsWith('.pdf')) {
    // Import the library entry directly to avoid pdf-parse's index.js debug
    // self-test (which reads a sample file and can throw).
    const mod = await import('pdf-parse/lib/pdf-parse.js')
    const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>
    const out = await pdfParse(buf)
    return out.text.trim()
  }

  if (lower.endsWith('.docx')) {
    const out = await mammoth.extractRawText({ buffer: buf })
    return out.value.trim()
  }

  // .txt / .md / anything else: best-effort UTF-8 decode.
  return buf.toString('utf8').trim()
}
