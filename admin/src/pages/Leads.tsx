// admin/src/pages/Leads.tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchAdmin, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  event_id: string;
  last_step: 'phone_entered' | 'name_entered' | 'details_entered';
  source: Record<string, unknown> | null;
  converted_at: string | null;
  junk_at: string | null;
  created_at: string;
  events: { name: string; date: string } | null;
}

interface EventOption { id: string; name: string }

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function whatsappUrl(phone: string, eventName: string | null): string {
  const text = eventName
    ? `Hi! Saw you started signing up for ${eventName} at BGC — anything I can help with?`
    : `Hi! Saw you started signing up at BGC — anything I can help with?`;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);

  const [eventId, setEventId] = useState<string>('all');
  const [hasName, setHasName] = useState<'any' | 'yes' | 'no'>('any');
  const [includeConverted, setIncludeConverted] = useState(false);
  const [includeJunk, setIncludeJunk] = useState(false);
  const [sinceDays, setSinceDays] = useState<string>('30');

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (eventId !== 'all') p.set('event_id', eventId);
    if (hasName !== 'any') p.set('has_name', hasName);
    if (includeConverted) p.set('include_converted', '1');
    if (includeJunk) p.set('include_junk', '1');
    if (sinceDays) {
      const d = parseInt(sinceDays, 10);
      if (!Number.isNaN(d)) {
        const since = new Date(Date.now() - d * 86400_000).toISOString();
        p.set('since', since);
      }
    }
    return p.toString();
  }, [eventId, hasName, includeConverted, includeJunk, sinceDays]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdmin<{ leads: Lead[] }>(`/api/admin/leads?${queryString}`);
      setLeads(data.leads);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [queryString]);

  useEffect(() => {
    fetchAdmin<{ events: Array<{ id: string; name: string }> }>('/api/admin/events')
      .then((d) => setEvents(d.events))
      .catch(() => undefined);
  }, []);

  async function markJunk(id: string) {
    try {
      await fetchAdmin(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ junk: true }) });
      setLeads((cur) => cur.filter((l) => l.id !== id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }

  function copyPhone(p: string) {
    navigator.clipboard?.writeText(p).then(() => toast.success('Copied'));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-heading font-semibold">Leads</h1>
        <a
          className="ml-auto text-sm underline"
          href={`${import.meta.env.VITE_API_BASE ?? ''}/api/admin/leads/export?${queryString}`}
        >Export CSV</a>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label>Event</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Has name</Label>
          <Select value={hasName} onValueChange={(v) => setHasName(v as 'any' | 'yes' | 'no')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Last N days</Label>
          <Input className="w-24" inputMode="numeric" value={sinceDays} onChange={(e) => setSinceDays(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="conv" checked={includeConverted} onCheckedChange={setIncludeConverted} />
          <Label htmlFor="conv">Show converted</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="junk" checked={includeJunk} onCheckedChange={setIncludeJunk} />
          <Label htmlFor="junk">Show junk</Label>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && leads.length === 0 && (
        <div className="text-sm text-muted-foreground">No leads match these filters.</div>
      )}

      {!loading && leads.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Age</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Name</th>
                <th className="p-2">Event</th>
                <th className="p-2">Step</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{relativeTime(l.created_at)}</td>
                  <td className="p-2">
                    <button onClick={() => copyPhone(l.phone)} className="underline" title="Click to copy">
                      {l.phone}
                    </button>
                  </td>
                  <td className="p-2">{l.name ?? '—'}</td>
                  <td className="p-2">{l.events?.name ?? '—'}</td>
                  <td className="p-2"><Badge variant="secondary">{l.last_step.replace('_entered', '')}</Badge></td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <a
                      href={whatsappUrl(l.phone, l.events?.name ?? null)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block px-2 py-1 mr-2 rounded bg-primary text-primary-foreground text-xs"
                    >WhatsApp</a>
                    <Button variant="ghost" size="sm" onClick={() => markJunk(l.id)}>Junk</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
