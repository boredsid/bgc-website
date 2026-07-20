import { useEffect, useRef, useState } from 'react';
import { fetchAdmin, ApiError, showApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface CorporateEvent {
  id: string;
  company_name: string;
  title: string | null;
  event_date: string;
  headcount: number | null;
  description: string | null;
  logo_url: string | null;
  testimonial: string | null;
  is_published: boolean;
  created_at: string;
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

function today(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function isUpcoming(e: CorporateEvent): boolean {
  return e.event_date >= today();
}

export default function Corporate() {
  const [events, setEvents] = useState<CorporateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(today());
  const [headcount, setHeadcount] = useState('');
  const [description, setDescription] = useState('');
  const [testimonial, setTestimonial] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [published, setPublished] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdmin<{ corporate_events: CorporateEvent[] }>('/api/admin/corporate-events');
      setEvents(data.corporate_events);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setEditingId(null);
    setCompanyName('');
    setTitle('');
    setEventDate(today());
    setHeadcount('');
    setDescription('');
    setTestimonial('');
    setLogoUrl(null);
    setPublished(true);
    if (fileRef.current) fileRef.current.value = '';
  }

  function startCreate() {
    resetForm();
    setFormOpen(true);
  }

  function startEdit(e: CorporateEvent) {
    setEditingId(e.id);
    setCompanyName(e.company_name);
    setTitle(e.title || '');
    setEventDate(e.event_date);
    setHeadcount(e.headcount ? String(e.headcount) : '');
    setDescription(e.description || '');
    setTestimonial(e.testimonial || '');
    setLogoUrl(e.logo_url);
    setPublished(e.is_published);
    if (fileRef.current) fileRef.current.value = '';
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function uploadLogo(file: File) {
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error('Logo must be a PNG, JPG, WebP or SVG image');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2 MB');
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const data = await fetchAdmin<{ url: string }>('/api/admin/corporate-events/logo', {
        method: 'POST',
        body: JSON.stringify({ content_type: file.type, data_base64: btoa(binary) }),
      });
      setLogoUrl(data.url);
      toast.success('Logo uploaded');
    } catch (e) {
      showApiError(e);
    } finally {
      setUploading(false);
    }
  }

  const canSave = companyName.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(eventDate);

  async function save() {
    if (!canSave) {
      toast.error('Company name and date are required');
      return;
    }
    const count = headcount.trim() ? parseInt(headcount, 10) : null;
    if (count !== null && (!Number.isInteger(count) || count < 1)) {
      toast.error('People count must be a whole number of 1 or more');
      return;
    }
    setSaving(true);
    const payload = {
      company_name: companyName.trim(),
      title: title.trim() || null,
      event_date: eventDate,
      headcount: count,
      description: description.trim() || null,
      testimonial: testimonial.trim() || null,
      logo_url: logoUrl,
      is_published: published,
    };
    try {
      if (editingId) {
        await fetchAdmin(`/api/admin/corporate-events/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success(`${payload.company_name} updated`);
      } else {
        await fetchAdmin('/api/admin/corporate-events', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`${payload.company_name} added`);
      }
      resetForm();
      setFormOpen(false);
      load();
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: CorporateEvent) {
    if (!confirm(`Delete the ${e.company_name} event? It will disappear from the website.`)) return;
    try {
      await fetchAdmin(`/api/admin/corporate-events/${e.id}`, { method: 'DELETE' });
      toast.success('Corporate event deleted');
      load();
    } catch (err) {
      showApiError(err);
    }
  }

  async function togglePublished(e: CorporateEvent) {
    try {
      await fetchAdmin(`/api/admin/corporate-events/${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_published: !e.is_published }),
      });
      toast.success(e.is_published ? 'Hidden from website' : 'Now showing on website');
      load();
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-heading font-semibold">Corporate</h1>
        <p className="text-sm text-muted-foreground">Company events shown on the public Corporate page.</p>
        <Button className="ml-auto" onClick={() => (formOpen ? setFormOpen(false) : startCreate())}>
          {formOpen ? 'Close' : 'Add corporate event'}
        </Button>
      </div>

      {formOpen && (
        <div className="rounded border p-4 space-y-3 bg-muted/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Company name (required)</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme India"
              />
            </div>
            <div>
              <Label>Event name (optional)</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Game Night Offsite"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Event date</Label>
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div>
              <Label>People (optional)</Label>
              <Input
                type="number"
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                inputMode="numeric"
                min="1"
                placeholder="e.g. 40"
              />
            </div>
          </div>

          <div>
            <Label>Company logo (optional)</Label>
            <div className="flex items-center gap-3">
              {logoUrl && (
                <img src={logoUrl} alt="Logo preview" className="h-10 w-10 object-contain rounded border bg-white p-1" />
              )}
              <Input
                ref={fileRef}
                type="file"
                accept={LOGO_TYPES.join(',')}
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadLogo(f);
                }}
              />
              {logoUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                  setLogoUrl(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}>
                  Remove
                </Button>
              )}
            </div>
            {uploading && <div className="text-sm text-muted-foreground mt-1">Uploading…</div>}
          </div>

          <div>
            <Label>Short description (optional, shown on the website)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. An evening of social deduction and strategy games for the Bangalore team."
              maxLength={500}
            />
          </div>

          <div>
            <Label>Client quote (optional, shown on the website)</Label>
            <Textarea
              value={testimonial}
              onChange={(e) => setTestimonial(e.target.value)}
              placeholder="e.g. Best team event we've done all year!"
              maxLength={500}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="published" checked={published} onCheckedChange={setPublished} />
            <Label htmlFor="published">Show on website</Label>
          </div>

          <Button onClick={save} disabled={saving || uploading || !canSave}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add event'}
          </Button>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && events.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No corporate events yet. Add past events to build the company wall on the website.
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Logo</th>
                <th className="p-2">Company</th>
                <th className="p-2">Event</th>
                <th className="p-2">Date</th>
                <th className="p-2">People</th>
                <th className="p-2">Website</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2">
                    {e.logo_url ? (
                      <img src={e.logo_url} alt="" className="h-8 w-8 object-contain rounded bg-white border p-0.5" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 font-medium whitespace-nowrap">{e.company_name}</td>
                  <td className="p-2 max-w-xs truncate" title={e.title || ''}>{e.title || '—'}</td>
                  <td className="p-2 whitespace-nowrap">
                    {e.event_date}
                    {isUpcoming(e) && <Badge className="ml-2" variant="secondary">upcoming</Badge>}
                  </td>
                  <td className="p-2">{e.headcount ?? '—'}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => togglePublished(e)}
                      title="Tap to toggle"
                      className="cursor-pointer"
                    >
                      <Badge variant={e.is_published ? 'default' : 'outline'}>
                        {e.is_published ? 'shown' : 'hidden'}
                      </Badge>
                    </button>
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(e)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(e)}>Delete</Button>
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
