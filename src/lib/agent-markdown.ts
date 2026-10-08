// Live markdown for the two pages whose content is really database rows:
// /calendar and /library. functions/_middleware.ts serves these to agents that
// send `Accept: text/markdown`, so they see today's events rather than the
// snapshot baked into the HTML at the last deploy. Every other page's markdown
// is converted from its built HTML (src/integrations/markdown-pages.ts).

import { formatEventWhen } from './event-date';
import { dedupeGamesByTitle } from './games';
import type { Event, Game } from './types';

const SITE = 'https://boardgamecompany.in';
const MCP_NOTE =
  `Agents can look up events and register people through the BGC MCP server at ` +
  `https://api.boardgamecompany.in/mcp (setup: ${SITE}/mcp).`;

interface Supabase {
  url: string;
  anonKey: string;
}

async function select<T>(db: Supabase, query: string): Promise<T[]> {
  const res = await fetch(`${db.url}/rest/v1/${query}`, {
    headers: { apikey: db.anonKey, Authorization: `Bearer ${db.anonKey}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

function frontmatter(title: string, description: string, path: string): string {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `url: ${SITE}${path}`,
    '---',
  ].join('\n');
}

// Table cells can't hold pipes or line breaks.
function cell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

type CalendarEvent = Pick<
  Event,
  | 'id' | 'name' | 'description' | 'date' | 'end_date' | 'is_all_day' | 'venue_name' | 'venue_area'
  | 'price' | 'price_includes' | 'guild_path_exclusive' | 'replay_pass_free'
  | 'externally_managed' | 'external_registration_url'
>;

function eventMarkdown(e: CalendarEvent): string {
  const lines = [`### ${e.name}`, '', `- **When:** ${formatEventWhen(e)} (IST)`, `- **Where:** ${e.venue_name}, ${e.venue_area}`];
  if (e.externally_managed) {
    lines.push(`- **Register:** ${e.external_registration_url ?? 'on the partner’s site (link not published yet)'}`);
  } else {
    lines.push(`- **Price:** ₹${e.price} per seat${e.price_includes ? ` — ${e.price_includes}` : ''}`);
    lines.push(`- **Register:** ${SITE}/register?event=${e.id}`);
  }
  if (e.guild_path_exclusive) lines.push(`- Open to active Guild Path members only (${SITE}/guild-path)`);
  if (e.replay_pass_free) lines.push('- Free for REPLAY pass holders');
  if (e.description) lines.push('', e.description.trim());
  return lines.join('\n');
}

export async function calendarMarkdown(db: Supabase, now = new Date()): Promise<string> {
  const events = await select<CalendarEvent>(
    db,
    'events?select=id,name,description,date,end_date,is_all_day,venue_name,venue_area,price,price_includes,' +
      'guild_path_exclusive,replay_pass_free,externally_managed,external_registration_url' +
      // ends_at, not date: a multi-day event stays listed until its last day.
      `&is_published=eq.true&ends_at=gte.${encodeURIComponent(now.toISOString())}&order=date.asc`,
  );

  const months = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const month = new Date(e.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'long' });
    months.set(month, [...(months.get(month) ?? []), e]);
  }

  const sections = events.length
    ? [...months].map(([month, list]) => `## ${month}\n\n${list.map(eventMarkdown).join('\n\n')}`)
    : ['No upcoming sessions are listed yet. Follow https://instagram.com/boardgamecompany for announcements.'];

  return [
    frontmatter('Calendar — Board Game Company', 'Upcoming BGC sessions — board game nights, TTRPGs, and tournaments in Bangalore', '/calendar'),
    '# Upcoming sessions',
    `Board game nights, TTRPGs and tournaments in Bangalore. All times are in IST. Live as of ${now.toISOString()}.`,
    ...sections,
    `---\n\n${MCP_NOTE}`,
  ].join('\n\n') + '\n';
}

type LibraryGame = Pick<Game, 'title' | 'player_count' | 'play_time' | 'complexity' | 'avg_rating'>;

export async function libraryMarkdown(db: Supabase): Promise<string> {
  const games = dedupeGamesByTitle(
    await select<LibraryGame>(db, 'games?select=title,player_count,play_time,complexity,avg_rating&order=title.asc'),
  );

  const rows = games.map((g) =>
    `| ${cell(g.title)} | ${cell(g.player_count)} | ${g.play_time ? `${cell(g.play_time)} min` : ''} | ${cell(g.complexity)} | ${g.avg_rating != null ? Number(g.avg_rating).toFixed(1) : ''} |`,
  );

  return [
    frontmatter('Library — Board Game Company', `${games.length} board games at BGC Bangalore`, '/library'),
    '# Our Library',
    `Every game we own (${games.length}), ready to play at the next session.`,
    ['| Game | Players | Play time | Complexity | Rating |', '| --- | --- | --- | --- | --- |', ...rows].join('\n'),
    `---\n\nUpcoming sessions: ${SITE}/calendar`,
  ].join('\n\n') + '\n';
}
