import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar, { type SidebarCounts } from './Sidebar';
import BottomTabBar from './BottomTabBar';
import TopBar from './TopBar';
import { OfflineBanner } from './OfflineBanner';
import { fetchAdmin } from '@/lib/api';

interface SummaryResponse {
  pending_guild_count?: number;
  pending_registration_count?: number;
}

export default function Layout() {
  const [counts, setCounts] = useState<SidebarCounts>({});

  useEffect(() => {
    fetchAdmin<SummaryResponse>('/api/admin/summary')
      .then((r) =>
        setCounts({
          pending_guild_count: r.pending_guild_count,
          pending_registration_count: r.pending_registration_count,
        }),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full">
      <div className="hidden md:flex">
        <Sidebar counts={counts} />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineBanner />
        <TopBar />
        <main
          className="flex-1 overflow-auto bg-muted/30 p-4 md:p-6 pb-20 md:pb-6"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </main>
        <BottomTabBar counts={counts} />
      </div>
    </div>
  );
}
