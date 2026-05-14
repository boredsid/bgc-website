import type { Game } from './types';

function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

export function dedupeGamesByTitle<T extends { title: string }>(games: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const g of games) {
    const k = titleKey(g.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}

export function countByTitle(games: Pick<Game, 'title'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of games) {
    const k = titleKey(g.title);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
