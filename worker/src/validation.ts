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

export function sanitizeSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const cleaned = source.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Labels of the event's required custom questions that weren't answered.
 *
 * A checkbox is answered by being ticked; anything else needs a non-empty
 * value. Returns labels rather than ids so the caller can name the question the
 * admin actually sees on screen.
 */
export function missingRequiredAnswers(
  questions: Array<{ id: string; label: string; required?: boolean }>,
  answers: Record<string, string | boolean> | null | undefined,
): string[] {
  const given = answers || {};
  return questions
    .filter((q) => q.required)
    .filter((q) => {
      const answer = given[q.id];
      if (typeof answer === 'boolean') return !answer;
      return answer === undefined || answer === null || String(answer).trim() === '';
    })
    .map((q) => q.label);
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
