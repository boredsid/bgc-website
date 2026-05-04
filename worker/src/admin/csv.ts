function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  headers: ReadonlyArray<keyof T & string>,
  rows: ReadonlyArray<T>,
): string {
  const out: string[] = [];
  out.push(headers.map((h) => escape(h)).join(','));
  for (const r of rows) {
    out.push(headers.map((h) => escape(r[h])).join(','));
  }
  return out.join('\n') + '\n';
}
