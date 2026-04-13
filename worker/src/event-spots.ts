import type { Env } from './index';
import { getSupabase } from './supabase';
import { jsonResponse } from './validation';

export async function handleEventSpots(eventId: string, env: Env): Promise<Response> {
  if (!eventId) {
    return jsonResponse({ error: 'Missing event ID' }, 400);
  }

  const supabase = getSupabase(env);

  const [eventResult, regsResult] = await Promise.all([
    supabase
      .from('events')
      .select('capacity, custom_questions')
      .eq('id', eventId)
      .single(),
    supabase
      .from('registrations')
      .select('seats, custom_answers')
      .eq('event_id', eventId)
      .eq('payment_status', 'confirmed'),
  ]);

  if (!eventResult.data) {
    return jsonResponse({ error: 'Event not found' }, 404);
  }

  const capacity = eventResult.data.capacity;
  const registrations = regsResult.data || [];

  const registered = registrations.reduce((sum, r) => sum + r.seats, 0);
  const remaining = Math.max(0, capacity - registered);

  const optionCounts: Record<string, Record<string, number>> = {};
  const customQuestions = eventResult.data.custom_questions as Array<{
    id: string;
    options?: Array<{ value: string; capacity?: number }>;
  }> | null;

  if (customQuestions) {
    for (const q of customQuestions) {
      const hasCapacity = q.options?.some((o) => o.capacity !== undefined);
      if (!hasCapacity) continue;

      optionCounts[q.id] = {};
      for (const reg of registrations) {
        const answers = reg.custom_answers as Record<string, string> | null;
        if (answers && answers[q.id]) {
          const val = answers[q.id];
          optionCounts[q.id][val] = (optionCounts[q.id][val] || 0) + reg.seats;
        }
      }
    }
  }

  return jsonResponse({ capacity, registered, remaining, option_counts: optionCounts });
}
