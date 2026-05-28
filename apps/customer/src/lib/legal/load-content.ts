import { readFile } from 'fs/promises';
import { join } from 'path';

const CONTENT_DIR = join(process.cwd(), 'content', 'legal');

export async function loadLegalContent(
  locale: string,
  slug: string,
): Promise<string> {
  const lang = locale === 'zh' ? 'th' : locale;
  const filePath = join(CONTENT_DIR, lang, `${slug}.md`);
  return readFile(filePath, 'utf-8');
}
