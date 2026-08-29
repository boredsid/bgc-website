import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { PhoneCell } from '@/components/PhoneCell';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import { parsePhone } from '@/lib/validation';
import { toast } from 'sonner';
import type { CommunityHost } from '@/lib/types';

interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null; is_community_host?: boolean };
  membership?: { isMember: boolean; tier: string | null };
}

function tierLabel(host: CommunityHost): string {
  if (!host.membership_tier) return 'No membership';
  const name = host.membership_tier.charAt(0).toUpperCase() + host.membership_tier.slice(1);
  return host.membership_never_expires ? `${name} · never expires` : name;
}

export default function CommunityHosts() {
  const [hosts, setHosts] = useState<CommunityHost[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [addOpen, setAddOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [lookup, setLookup] = useState<PhoneLookup | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAdmin<{ hosts: CommunityHost[] }>('/api/admin/community-hosts')
      .then((r) => setHosts(r.hosts))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRevalidate(refresh);

  function resetForm() {
    setPhone('');
    setName('');
    setEmail('');
    setNotes('');
    setLookup(null);
  }

  // Phone-first: one lookup fills in whatever we already know about them, so
  // adding a regular attendee as a host is a single tap after typing a number.
  async function onPhoneBlur() {
    const digits = parsePhone(phone);
    if (digits.length !== 10) return;
    try {
      const r = await fetchAdmin<PhoneLookup>('/api/admin/lookup-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: digits }),
      });
      setLookup(r);
      if (r.user.found) {
        if (r.user.name && !name) setName(r.user.name);
        if (r.user.email && !email) setEmail(r.user.email);
      }
    } catch (e) {
      showApiError(e);
    }
  }

  async function addHost() {
    const digits = parsePhone(phone);
    if (digits.length !== 10) {
      toast.error('Phone must be 10 digits.');
      return;
    }
    if (!name.trim()) {
      toast.error('Please enter a name.');
      return;
    }
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/community-hosts', {
        method: 'POST',
        body: JSON.stringify({
          phone: digits,
          name: name.trim(),
          email: email.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      toast.success(`${name.trim()} added as a community host`);
      setAddOpen(false);
      resetForm();
      refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<CommunityHost>[] = [
    {
      key: 'name', header: 'Name', render: (h) => h.name || '—',
      sortable: true, sortValue: (h) => (h.name ?? '').toLowerCase(),
    },
    { key: 'phone', header: 'Phone', render: (h) => <PhoneCell phone={h.phone} /> },
    {
      key: 'sessions', header: 'Sessions hosted', render: (h) => h.sessions_hosted,
      sortable: true, sortValue: (h) => h.sessions_hosted,
    },
    {
      key: 'membership', header: 'Membership', render: (h) => tierLabel(h),
      sortable: true, sortValue: (h) => h.membership_tier ?? '',
    },
    {
      key: 'since', header: 'Host since',
      render: (h) => (h.community_host_since ? new Date(h.community_host_since).toLocaleDateString() : '—'),
      sortable: true, sortValue: (h) => h.community_host_since ?? '',
    },
    {
      key: 'add', header: '',
      render: (h) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/registrations/host?host=${h.id}`);
          }}
        >
          Add to event
        </Button>
      ),
    },
  ];

  const fields: CardField<CommunityHost>[] = [
    { key: 'name', render: (h) => h.name || h.phone, primary: true },
    { key: 'phone', render: (h) => <PhoneCell phone={h.phone} /> },
    {
      key: 'meta',
      render: (h) => `${h.sessions_hosted} session${h.sessions_hosted === 1 ? '' : 's'} hosted · ${tierLabel(h)}`,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Community hosts</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add host
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Hosts run BGC sessions for the community. Each one gets a free Initiate Guild Path
        membership that never expires, and can be added to any event as a free seat.
      </p>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden">
            <MobileCardList
              rows={hosts}
              fields={fields}
              rowKey={(h) => h.id}
              onRowClick={(h) => navigate(`/users/${h.id}`)}
              emptyMessage="No community hosts yet. Add your first one."
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              rows={hosts}
              columns={columns}
              rowKey={(h) => h.id}
              onRowClick={(h) => navigate(`/users/${h.id}`)}
              emptyMessage="No community hosts yet. Add your first one."
            />
          </div>
        </>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) resetForm(); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a community host</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={onPhoneBlur}
                placeholder="10-digit number"
                inputMode="numeric"
              />
            </div>
            {lookup?.user.found && (
              <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
                Found an existing user — their details are filled in below.
                {lookup.user.is_community_host && ' They are already a community host.'}
              </div>
            )}
            {lookup && !lookup.user.found && (
              <div className="text-xs rounded-md bg-muted text-muted-foreground p-2">
                New to BGC — we'll create their record when you add them.
              </div>
            )}
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder="What do they usually host?"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              They'll get a free Initiate membership that never expires. If they already
              hold a paid membership, that one stays in force.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={addHost} disabled={saving}>
              {saving ? 'Adding…' : 'Add host'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
