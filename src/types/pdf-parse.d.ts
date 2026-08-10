declare module "pdf-parse" {
  export interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  export default function pdfParse(
    buffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  export interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  export default function pdfParse(
    buffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
}
