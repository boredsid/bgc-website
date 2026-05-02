import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, Library, Users, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/games', label: 'Games', icon: Library },
  { to: '/registrations', label: 'Registrations', icon: Users },
  { to: '/guild', label: 'Guild', icon: ShieldCheck },
];

interface Props {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: Props) {
  return (
    <aside className="w-56 shrink-0 bg-background border-r flex flex-col h-full">
      <div className="p-4 flex items-center gap-2">
        <img src="/bgc-logo.png" alt="" className="h-7 w-7" />
        <span className="font-heading font-semibold text-lg">Admin</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => (
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
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
