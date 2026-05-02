import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, ShieldCheck, Calendar, MoreHorizontal, Library, LogOut } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { SidebarCounts } from './Sidebar';

const tabs = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, countKey: null as null | keyof SidebarCounts },
  { to: '/registrations', label: 'Registrations', icon: Users, end: false, countKey: 'pending_registration_count' as const },
  { to: '/guild', label: 'Guild', icon: ShieldCheck, end: false, countKey: 'pending_guild_count' as const },
  { to: '/events', label: 'Events', icon: Calendar, end: false, countKey: null },
];

interface Props { counts?: SidebarCounts }

export default function BottomTabBar({ counts }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        {tabs.map((t) => {
          const count = t.countKey ? counts?.[t.countKey] : undefined;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-11 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
              aria-label={t.label}
            >
              <span className="relative">
                <t.icon className="h-5 w-5" />
                {count && count > 0 ? (
                  <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-highlight text-highlight-foreground text-[10px] font-semibold">
                    {count}
                  </span>
                ) : null}
              </span>
              <span>{t.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-11 text-xs text-muted-foreground"
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="h-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="p-2 space-y-1">
            <NavLink
              to="/games"
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )
              }
            >
              <Library className="h-5 w-5" />
              Games
            </NavLink>
            <a
              href="/cdn-cgi/access/logout"
              className="flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11 hover:bg-muted"
            >
              <LogOut className="h-5 w-5" />
              Sign out
            </a>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
