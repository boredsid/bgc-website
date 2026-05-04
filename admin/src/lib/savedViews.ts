export interface SavedView {
  name: string;
  params: Record<string, string>;
}

const KEY = (page: string) => `admin.savedViews.${page}`;

export function listViews(page: string): SavedView[] {
  try { return JSON.parse(localStorage.getItem(KEY(page)) || '[]'); } catch { return []; }
}

export function saveView(page: string, name: string, params: Record<string, string>) {
  const all = listViews(page).filter((v) => v.name !== name);
  all.push({ name, params });
  localStorage.setItem(KEY(page), JSON.stringify(all));
}

export function deleteView(page: string, name: string) {
  const all = listViews(page).filter((v) => v.name !== name);
  localStorage.setItem(KEY(page), JSON.stringify(all));
}

export function getView(page: string, name: string): SavedView | null {
  return listViews(page).find((v) => v.name === name) ?? null;
}
