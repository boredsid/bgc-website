import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAdmin } from '@/lib/api';
import { SearchOverlay } from './SearchOverlay';

export default function TopBar() {
  const [email, setEmail] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    fetchAdmin<{ email: string }>('/api/admin/whoami')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    <header className="h-14 bg-background border-b flex items-center gap-2 px-4 md:px-6">
      <div className="flex items-center gap-2 min-w-0 md:hidden">
        <img src="/bgc-logo.png" alt="" className="h-6 w-6" />
        <span className="font-heading font-semibold">Admin</span>
      </div>

      <div className="flex-1 hidden md:block max-w-xl">
        <button
          type="button"
          className="w-full flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/40 text-sm text-muted-foreground hover:bg-muted"
          aria-label="Search"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
          <span>Find someone… (Cmd-K)</span>
        </button>
      </div>

      <div className="flex-1 md:hidden" />

      <Button
        variant="ghost"
        size="icon"
        className="md:hidden min-h-11 min-w-11"
        aria-label="Search"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-3 text-sm min-w-0">
        <div className="hidden md:flex items-center gap-2">
          {email && <span className="text-muted-foreground truncate max-w-[180px]">{email}</span>}
          <a href="/cdn-cgi/access/logout" className="hover:underline shrink-0">Sign out</a>
        </div>
        <div
          className="md:hidden h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm"
          aria-label={email || 'Profile'}
          title={email || ''}
        >
          {initials}
        </div>
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
