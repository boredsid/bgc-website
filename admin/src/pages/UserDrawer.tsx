import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormDrawer } from '@/components/FormDrawer';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateUser, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { User, GuildMember } from '@/lib/types';

export default function UserDrawer() {
  const navigate = useNavigate();
  const { id: guildMemberId } = useParams();
  const [user, setUser] = useState<User | null>(null);
  const [initial, setInitial] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!guildMemberId) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${guildMemberId}`)
      .then(({ member }) => fetchAdmin<{ user: User }>(`/api/admin/users/${member.user_id}`))
      .then((r) => { setUser(r.user); setInitial(r.user); })
      .catch(showApiError);
  }, [guildMemberId]);

  const errors: ValidationErrors = useMemo(() => {
    if (!user) return {};
    return validateUser({ name: user.name, phone: user.phone, email: user.email });
  }, [user]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(user) !== JSON.stringify(initial), [user, initial]);

  function close() { navigate(`/guild/${guildMemberId}`); }

  async function save() {
    if (!user) return;
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: user.name || '', phone: user.phone, email: user.email }),
      });
      toast.success('User updated');
      navigate(`/guild/${guildMemberId}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof User>(k: K, v: User[K]) {
    setUser((x) => x ? { ...x, [k]: v } : x);
  }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title="Edit user"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {!user ? <p>Loading…</p> : (
        <div className="space-y-3">
          {field('name', 'Name', (
            <Input value={user.name || ''} onChange={(e) => set('name', e.target.value)} />
          ))}
          {field('phone', 'Phone', (
            <Input value={user.phone} onChange={(e) => set('phone', e.target.value)} />
          ))}
          {field('email', 'Email', (
            <Input value={user.email || ''} onChange={(e) => set('email', e.target.value || null)} />
          ))}
        </div>
      )}
    </FormDrawer>
  );
}
