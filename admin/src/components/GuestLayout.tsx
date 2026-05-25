import { Outlet } from 'react-router-dom';
import { OfflineBanner } from './OfflineBanner';
import { useWhoAmI } from '@/lib/whoami';

export default function GuestLayout() {
  const who = useWhoAmI();
  const events = who?.events ?? [];
  const title = events.length === 1 ? events[0].name : 'Collaboration registrations';

  return (
    <div className="flex flex-col h-full">
      <OfflineBanner />
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-semibold truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">Guest access · {who?.email}</div>
        </div>
        <a href="/cdn-cgi/access/logout" className="text-sm text-muted-foreground underline shrink-0 ml-3">
          Sign out
        </a>
      </header>
      <main
        className="flex-1 overflow-auto bg-muted/30 p-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Outlet />
      </main>
    </div>
  );
}
