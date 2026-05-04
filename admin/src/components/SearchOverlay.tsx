import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Phone, ShieldCheck, Calendar } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { fetchAdmin } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface SearchResults {
  registrations: Array<{ id: string; name: string; phone: string; event_id: string; event_name: string | null; payment_status: 'pending' | 'confirmed' | 'cancelled' }>;
  guild_members: Array<{ id: string; user_id: string; name: string | null; phone: string; tier: string; status: string; expires_at: string }>;
  users: Array<{ id: string; name: string | null; phone: string; email: string | null; last_registered_at: string }>;
}

const EMPTY: SearchResults = { registrations: [], guild_members: [], users: [] };
const RECENTS_KEY = 'admin.searchRecents';
const RECENTS_MAX = 8;

function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}

function pushRecent(q: string) {
  if (!q.trim()) return;
  const prev = readRecents().filter((x) => x !== q);
  prev.unshift(q);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(prev.slice(0, RECENTS_MAX)));
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setRecents(readRecents()); setQ(''); setResults(EMPTY); } }, [open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults(EMPTY); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await fetchAdmin<SearchResults>(`/api/admin/search?q=${encodeURIComponent(q)}`);
        setResults(data);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(path: string) {
    pushRecent(q);
    setRecents(readRecents());
    onClose();
    navigate(path);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" showCloseButton={false} className="h-full max-h-screen p-0 flex flex-col">
        <SheetTitle className="sr-only">Search</SheetTitle>
        <div className="flex items-center gap-2 p-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find someone…"
            className="border-none focus-visible:ring-0"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-md hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {!q && recents.length > 0 && (
            <section>
              <div className="text-xs uppercase text-muted-foreground mb-2">Recent</div>
              <ul className="space-y-1">
                {recents.map((r) => (
                  <li key={r}>
                    <button onClick={() => setQ(r)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm">{r}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {loading && <div className="text-sm text-muted-foreground">Searching…</div>}
          {!loading && q && (
            <>
              <Section title="Registrations" count={results.registrations.length}>
                {results.registrations.map((r) => (
                  <ResultRow key={r.id} icon={<Calendar className="h-4 w-4" />} onClick={() => go(`/registrations/${r.id}`)}>
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.event_name || '—'} · {r.phone}</div>
                    <StatusBadge status={r.payment_status} />
                  </ResultRow>
                ))}
              </Section>
              <Section title="Guild members" count={results.guild_members.length}>
                {results.guild_members.map((g) => (
                  <ResultRow key={g.id} icon={<ShieldCheck className="h-4 w-4" />} onClick={() => go(`/guild/${g.id}`)}>
                    <div className="font-medium truncate">{g.name || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{g.tier} · expires {g.expires_at} · {g.phone}</div>
                  </ResultRow>
                ))}
              </Section>
              <Section title="Users" count={results.users.length}>
                {results.users.map((u) => (
                  <ResultRow key={u.id} icon={<Phone className="h-4 w-4" />} onClick={() => go(`/registrations?phone=${encodeURIComponent(u.phone)}`)}>
                    <div className="font-medium truncate">{u.name || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
                  </ResultRow>
                ))}
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-xs uppercase text-muted-foreground mb-1">{title} ({count})</div>
      {count === 0 ? <div className="text-sm text-muted-foreground">No matches</div> : <ul className="space-y-1">{children}</ul>}
    </section>
  );
}

function ResultRow({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left min-h-11">
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">{children}</div>
      </button>
    </li>
  );
}
