// src/lib/use-lead-capture.ts
import { useEffect, useRef } from 'react';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL as string | undefined;
const DEBOUNCE_MS = 1500;

export type LeadStep = 'phone_entered' | 'name_entered' | 'details_entered';

interface Args {
  phone: string;
  name: string;
  eventId: string | null;
  detailsTouched: boolean;
}

function sanitizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-\(\)]/g, '');
  const m = cleaned.match(/^(?:\+?91)?(\d{10})$/);
  return m ? m[1] : null;
}

function deriveStep(name: string, detailsTouched: boolean): LeadStep {
  if (detailsTouched) return 'details_entered';
  if (name.trim().length > 0) return 'name_entered';
  return 'phone_entered';
}

function readSource(): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('bgc_source');
    return raw ? { utm_source: raw } : null;
  } catch {
    return null;
  }
}

function send(payload: Record<string, unknown>): void {
  if (!WORKER_URL) return;
  try {
    fetch(`${WORKER_URL}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // swallow — fire-and-forget
  }
}

export function useLeadCapture({ phone, name, eventId, detailsTouched }: Args): void {
  const lastPayloadRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const cleanedPhone = sanitizePhone(phone);
    if (!cleanedPhone) return;

    const payload: Record<string, unknown> = {
      phone: cleanedPhone,
      event_id: eventId,
      last_step: deriveStep(name, detailsTouched),
      source: readSource(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };
    const trimmedName = name.trim();
    if (trimmedName) payload.name = trimmedName;

    latestRef.current = payload;
    const serialised = JSON.stringify(payload);
    if (serialised === lastPayloadRef.current) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      lastPayloadRef.current = serialised;
      send(payload);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [phone, name, eventId, detailsTouched]);

  useEffect(() => {
    function flush() {
      if (latestRef.current) send(latestRef.current);
    }
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}
