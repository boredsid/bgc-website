import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAdmin } from '@/lib/api';

interface Props {
  onOpenMenu?: () => void;
}

export default function TopBar({ onOpenMenu }: Props) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchAdmin<{ email: string }>('/api/admin/whoami')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null));
  }, []);

  return (
    <header className="h-14 bg-background border-b flex items-center justify-between gap-2 px-4 md:px-6">
      <div className="flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenMenu}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="font-medium md:hidden">BGC Admin</span>
        <span className="font-medium hidden md:inline">Admin</span>
      </div>
      <div className="flex items-center gap-3 text-sm min-w-0">
        {email && <span className="text-muted-foreground truncate max-w-[180px] md:max-w-none">{email}</span>}
        <a href="/cdn-cgi/access/logout" className="text-sm hover:underline shrink-0">Sign out</a>
      </div>
    </header>
  );
}
