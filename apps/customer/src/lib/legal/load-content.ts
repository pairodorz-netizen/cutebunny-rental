import { readFile } from 'fs/promises';
import { join } from 'path';

const CONTENT_DIR = join(process.cwd(), 'content', 'legal');

function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

export async function loadLegalContent(
  locale: string,
  slug: string,
): Promise<string> {
  const lang = locale === 'zh' ? 'th' : locale;
  const filePath = join(CONTENT_DIR, lang, `${slug}.md`);
  const raw = await readFile(filePath, 'utf-8');
  return stripHtmlComments(raw);
}
