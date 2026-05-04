import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="bg-status-pending text-status-pending-foreground text-sm flex items-center gap-2 px-4 py-2">
      <WifiOff className="h-4 w-4 shrink-0" />
      You're offline — showing the last data we fetched. Saving is disabled.
    </div>
  );
}
