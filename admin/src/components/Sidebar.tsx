import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, Library, Users, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, countKey: null as null | string },
  { to: '/events', label: 'Events', icon: Calendar, end: false, countKey: null },
  { to: '/games', label: 'Games', icon: Library, end: false, countKey: null },
  { to: '/registrations', label: 'Registrations', icon: Users, end: false, countKey: 'pending_registration_count' },
  { to: '/guild', label: 'Guild', icon: ShieldCheck, end: false, countKey: 'pending_guild_count' },
];

export interface SidebarCounts {
  pending_registration_count?: number;
  pending_guild_count?: number;
}

interface Props {
  onNavigate?: () => void;
  counts?: SidebarCounts;
}

export default function Sidebar({ onNavigate, counts }: Props) {
  return (
    <aside className="w-56 shrink-0 bg-background border-r flex flex-col h-full">
      <div className="p-4 flex items-center gap-2">
        <img src="/bgc-logo.png" alt="" className="h-7 w-7" />
        <span className="font-heading font-semibold text-lg">Admin</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => {
          const count = item.countKey ? counts?.[item.countKey as keyof SidebarCounts] : undefined;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {count && count > 0 ? (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-highlight text-highlight-foreground text-xs font-semibold">
                  {count}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
