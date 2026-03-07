import { PDFParse } from 'pdf-parse';

function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) return '';
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return normalizePdfText(parsed.text || '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}
