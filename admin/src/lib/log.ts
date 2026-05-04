const QUEUE: Array<{ message: string; stack?: string; url?: string; user_agent?: string }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function reportError(err: unknown, extra?: { url?: string }) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  QUEUE.push({
    message: message.slice(0, 2000),
    stack: stack?.slice(0, 4000),
    url: extra?.url || (typeof location !== 'undefined' ? location.href : undefined),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : undefined,
  });
  if (timer) return;
  timer = setTimeout(flush, 1000);
}

async function flush() {
  timer = null;
  while (QUEUE.length > 0) {
    const entry = QUEUE.shift()!;
    try {
      await fetch('/api/admin/log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch {
      // network down — drop silently
    }
  }
}

export function installGlobalErrorHandler() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
}

export function __resetForTests() {
  QUEUE.length = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
