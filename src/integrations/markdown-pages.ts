import type { AstroIntegration } from 'astro';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeHtmlMarkdown } from 'node-html-markdown';

// Writes an index.md beside every built index.html, so functions/_middleware.ts
// can answer `Accept: text/markdown` with a clean copy of the page instead of
// making an agent scrape the HTML. Only <main> and the footer are kept: the nav
// repeats on every page and says nothing an agent needs.

const nhm = new NodeHtmlMarkdown({ ignore: ['script', 'style', 'noscript', 'svg', 'button', 'template'] });

async function findPages(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '_astro') out.push(...(await findPages(path)));
    } else if (entry.name === 'index.html') {
      out.push(path);
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function yamlString(s: string): string {
  return JSON.stringify(s);
}

export function htmlToPageMarkdown(html: string, url: string, site: string): string {
  const title = decodeEntities(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  const description = decodeEntities(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '';
  const footer = html.match(/<footer\b[^>]*>([\s\S]*)<\/footer>/)?.[1] ?? '';

  // Root-relative links become absolute: an agent reading the markdown has no
  // page URL to resolve them against.
  const body = `${main}<hr>${footer}`.replace(/(href|src)="\/(?!\/)/g, `$1="${site}/`);

  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    description && `description: ${yamlString(description)}`,
    `url: ${url}`,
    '---',
  ].filter(Boolean).join('\n');

  const markdown = nhm.translate(body).replace(/[ \t]+$/gm, '').trim();
  return `${frontmatter}\n\n${markdown}\n`;
}

export default function markdownPages(): AstroIntegration {
  let site = '';
  return {
    name: 'bgc-markdown-pages',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = (config.site ?? '').replace(/\/$/, '');
      },
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const pages = await findPages(root);
        for (const file of pages) {
          const pathname = '/' + relative(root, file).replace(/index\.html$/, '').replace(/\\/g, '/');
          const html = await readFile(file, 'utf8');
          await writeFile(file.replace(/\.html$/, '.md'), htmlToPageMarkdown(html, site + pathname, site));
        }
        logger.info(`Wrote markdown copies of ${pages.length} pages`);
      },
    },
  };
}
