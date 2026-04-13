export function sanitizePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  const match = cleaned.match(/^(?:\+?91)?(\d{10})$/);
  return match ? match[1] : null;
}

export function sanitizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return valid ? trimmed : null;
}

export function sanitizeName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
