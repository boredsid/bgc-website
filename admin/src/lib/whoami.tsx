import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchAdmin } from './api';

export interface GuestEvent {
  id: string;
  name: string;
  date: string;
}

export interface WhoAmI {
  email: string;
  role: 'admin' | 'guest';
  events?: GuestEvent[];
}

const WhoAmIContext = createContext<WhoAmI | null>(null);

export function useWhoAmI(): WhoAmI | null {
  return useContext(WhoAmIContext);
}

export function WhoAmIProvider({
  children,
  fallback,
}: {
  children: (who: WhoAmI) => ReactNode;
  fallback: ReactNode;
}) {
  const [who, setWho] = useState<WhoAmI | null>(null);

  useEffect(() => {
    fetchAdmin<WhoAmI>('/api/admin/whoami')
      .then(setWho)
      .catch(() => setWho({ email: '', role: 'admin' }));
  }, []);

  if (!who) return <>{fallback}</>;
  return <WhoAmIContext.Provider value={who}>{children(who)}</WhoAmIContext.Provider>;
}
