import { useEffect } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

export function emitRevalidate(): void {
  for (const fn of listeners) fn();
}

export function useRevalidate(reload: () => void): void {
  useEffect(() => {
    listeners.add(reload);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', reload);
    return () => {
      listeners.delete(reload);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);
}
