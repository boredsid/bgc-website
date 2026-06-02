import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Inbox } from 'lucide-react';
import { OfflineBanner } from './OfflineBanner';
import { useWhoAmI } from '@/lib/whoami';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/registrations', label: 'Registrations', icon: Users, end: false },
  { to: '/leads', label: 'Leads', icon: Inbox, end: false },
];

export default function GuestLayout() {
  const who = useWhoAmI();
  const events = who?.events ?? [];
  const title = events.length === 1 ? events[0].name : 'Collaboration access';

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
      <nav className="border-b flex" aria-label="Primary">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px min-h-11',
                isActive
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <main
        className="flex-1 overflow-auto bg-muted/30 p-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Outlet />
      </main>
    </div>
  );
}
