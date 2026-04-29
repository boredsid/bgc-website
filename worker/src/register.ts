import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from './validation';

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    event_id: string;
    name: string;
    phone: string;
    email: string;
    seats: number;
    custom_answers: Record<string, string | boolean>;
    payment_status: 'pending' | 'confirmed';
  }>();

  // Validate inputs
  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  const seats = Math.floor(body.seats);
  if (seats < 1 || seats > 20) return jsonResponse({ error: 'Invalid seat count' }, 400);

  if (!body.event_id) return jsonResponse({ error: 'Missing event ID' }, 400);
  if (!['pending', 'confirmed'].includes(body.payment_status)) {
    return jsonResponse({ error: 'Invalid payment status' }, 400);
  }

  const supabase = getSupabase(env);

  // Fetch event
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', body.event_id)
    .eq('is_published', true)
    .single();

  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  // Check spots remaining
  const { data: regs } = await supabase
    .from('registrations')
    .select('seats')
    .eq('event_id', body.event_id)
    .eq('payment_status', 'confirmed');

  const registered = (regs || []).reduce((sum, r) => sum + r.seats, 0);
  const remaining = event.capacity - registered;

  if (seats > remaining) {
    return jsonResponse({ error: `Only ${remaining} spots remaining` }, 400);
  }

  // Validate custom questions
  const customQuestions = (event.custom_questions || []) as Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: Array<{ value: string; capacity?: number }>;
  }>;

  const customAnswers = body.custom_answers || {};

  for (const q of customQuestions) {
    const answer = customAnswers[q.id];
    if (q.required && (answer === undefined || answer === null || answer === '')) {
      return jsonResponse({ error: `"${q.label}" is required` }, 400);
    }

    if (answer && q.options) {
      const option = q.options.find((o) => o.value === answer);
      if (q.type !== 'checkbox' && q.type !== 'text' && !option) {
        return jsonResponse({ error: `Invalid option for "${q.label}"` }, 400);
      }
      if (option?.capacity !== undefined) {
        const { data: allRegs } = await supabase
          .from('registrations')
          .select('seats, custom_answers')
          .eq('event_id', body.event_id)
          .eq('payment_status', 'confirmed');

        const optionCount = (allRegs || []).reduce((sum, r) => {
          const a = r.custom_answers as Record<string, string> | null;
          return a && a[q.id] === answer ? sum + r.seats : sum;
        }, 0);

        if (optionCount + seats > option.capacity) {
          return jsonResponse({ error: `"${option.value}" is full` }, 400);
        }
      }
    }
  }

  // Upsert user first so we can stamp user_id onto the registration.
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await supabase
      .from('users')
      .update({ name, email, last_registered_at: new Date().toISOString() })
      .eq('id', userId);
  } else {
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({ phone, name, email })
      .select('id')
      .single();
    if (userError || !newUser) {
      return jsonResponse({ error: 'Registration failed' }, 500);
    }
    userId = newUser.id;
  }

  // Check Guild Path membership and calculate total
  let totalAmount = event.price * seats;
  let discountApplied: string | null = null;

  const { data: member } = await supabase
    .from('guild_path_members')
    .select('tier, expires_at')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('expires_at', new Date().toISOString().split('T')[0])
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (member) {
    if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
      totalAmount = 0;
      discountApplied = member.tier;
    } else if (member.tier === 'initiate') {
      totalAmount = Math.round(totalAmount * 0.8);
      discountApplied = 'initiate';
    }
  }

  // Insert registration
  const { data: registration, error: regError } = await supabase
    .from('registrations')
    .insert({
      event_id: body.event_id,
      user_id: userId,
      name,
      phone,
      email,
      seats,
      total_amount: totalAmount,
      discount_applied: discountApplied,
      custom_answers: customAnswers,
      payment_status: body.payment_status,
    })
    .select('id')
    .single();

  if (regError) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }

  return jsonResponse({ success: true, registration_id: registration.id });
}
