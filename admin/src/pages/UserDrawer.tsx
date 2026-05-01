import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { User, GuildMember } from '@/lib/types';

export default function UserDrawer() {
  const navigate = useNavigate();
  const { id: guildMemberId } = useParams();
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!guildMemberId) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${guildMemberId}`)
      .then(({ member }) => fetchAdmin<{ user: User }>(`/api/admin/users/${member.user_id}`))
      .then((r) => setUser(r.user))
      .catch(showApiError);
  }, [guildMemberId]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: user.name || '', phone: user.phone, email: user.email }),
      });
      toast.success('User updated');
      navigate(`/guild/${guildMemberId}`);
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) navigate(`/guild/${guildMemberId}`); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Edit user</SheetTitle></SheetHeader>
        {!user ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div><Label>Name</Label><Input value={user.name || ''} onChange={(e) => setUser({ ...user, name: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={user.phone} onChange={(e) => setUser({ ...user, phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={user.email || ''} onChange={(e) => setUser({ ...user, email: e.target.value || null })} /></div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={() => navigate(`/guild/${guildMemberId}`)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
