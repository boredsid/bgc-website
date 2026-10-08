// Markdown for agents. A request carrying `Accept: text/markdown` gets the
// page as markdown; everyone else gets the HTML exactly as before.
//
// /calendar and /library are rendered live from Supabase (src/lib/agent-markdown.ts).
// Every other page is served from the index.md written beside its index.html at
// build time (src/integrations/markdown-pages.ts), which is also the fallback
// when the live read fails. public/_routes.json keeps static assets from
// invoking this function at all.

import { calendarMarkdown, libraryMarkdown } from '../src/lib/agent-markdown';

interface Env {
  ASSETS: { fetch(input: Request | string): Promise<Response> };
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface Context {
  request: Request;
  env: Env;
  next(): Promise<Response>;
}

// Matches public/robots.txt.
const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no';

const LIVE: Record<string, (db: { url: string; anonKey: string }) => Promise<string>> = {
  '/calendar': (db) => calendarMarkdown(db),
  '/library': libraryMarkdown,
};

function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  return accept.split(',').some((part) => {
    const [type, ...params] = part.trim().split(';').map((s) => s.trim());
    if (type.toLowerCase() !== 'text/markdown') return false;
    const q = params.find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

function withVary(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.append('Vary', 'Accept');
  return out;
}

async function liveMarkdown(path: string, env: Env): Promise<string | null> {
  const render = LIVE[path];
  if (!render || !env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    return await render({ url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY });
  } catch {
    return null;
  }
}

async function builtMarkdown(path: string, request: Request, env: Env): Promise<string | null> {
  const url = new URL(request.url);
  url.pathname = path === '/' ? '/index.md' : `${path}/index.md`;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url));
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return res.text();
}

export const onRequest = async ({ request, env, next }: Context): Promise<Response> => {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !wantsMarkdown(request.headers.get('accept'))) {
    // Every page response varies on Accept, redirects included: /calendar
    // answers HTML with a 308 to /calendar/ but markdown with a 200.
    return withVary(await next());
  }

  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const live = await liveMarkdown(path, env);
  const markdown = live ?? (await builtMarkdown(path, request, env));
  if (markdown === null) return withVary(await next());

  return new Response(request.method === 'HEAD' ? null : markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept',
      'Content-Signal': CONTENT_SIGNAL,
      // An estimate (~4 characters per token), not a real tokenizer count.
      'x-markdown-tokens': String(Math.ceil(markdown.length / 4)),
      'Cache-Control': live ? 'public, max-age=300' : 'public, max-age=0, must-revalidate',
    },
  });
};
