// Minimal ambient types for pdf-parse (the package ships no type declarations).
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string
    numpages: number
    info: unknown
  }
  function pdf(dataBuffer: Buffer): Promise<PdfParseResult>
  export default pdf
}
declare module 'pdf-parse'
