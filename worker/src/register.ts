import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
import { sendEventRegistrationEmail } from './email';
import { applyCreditsToTotal, recordCreditEvent } from './credits';
import { consumePromoUses, getApplicablePromo } from './promos';

export async function handleRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json<{
    event_id: string;
    name: string;
    phone: string;
    email: string;
    seats: number;
    custom_answers: Record<string, string | boolean>;
    payment_status: 'pending' | 'confirmed';
    source?: string;
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

  const source = sanitizeSource(body.source);

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
    .neq('payment_status', 'cancelled');

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
          .neq('payment_status', 'cancelled');

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
      .insert({ phone, name, email, source })
      .select('id')
      .single();
    if (userError || !newUser) {
      return jsonResponse({ error: 'Registration failed' }, 500);
    }
    userId = newUser.id;
  }

  // Apply guild discount first; the giveaway promo then covers any remaining
  // paid seats. If guild brings the total to ₹0, the promo stays preserved.
  const { data: member } = await supabase
    .from('guild_path_members')
    .select('id, tier, expires_at, plus_ones_used')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('expires_at', new Date().toISOString().split('T')[0])
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let totalAmount = event.price * seats;
  let discountApplied: string | null = null;
  let plusOnesToConsume = 0;
  let membershipIdToUpdate: string | null = null;
  let membershipNewPlusOnesUsed = 0;
  let promoIdUsed: string | null = null;
  let promoSeatsConsumed = 0;
  // Per-seat cost array so the promo can cover the most-expensive seats first.
  let seatCosts: number[] = Array(seats).fill(event.price);

  if (member) {
    const { data: priorRegs } = await supabase
      .from('registrations')
      .select('seats')
      .eq('event_id', body.event_id)
      .eq('user_id', userId)
      .neq('payment_status', 'cancelled');
    const existingSeats = (priorRegs || []).reduce((sum, r) => sum + r.seats, 0);

    if (member.tier === 'initiate') {
      const firstSeats = existingSeats === 0 ? Math.min(1, seats) : 0;
      const afterFirst = seats - firstSeats;
      const secondSeats = existingSeats + firstSeats < 2 ? Math.min(1, afterFirst) : 0;
      const fullSeats = afterFirst - secondSeats;
      seatCosts = [
        ...Array(fullSeats).fill(event.price),
        ...Array(secondSeats).fill(event.price * 0.9),
        ...Array(firstSeats).fill(event.price * 0.8),
      ];
      totalAmount = Math.round(seatCosts.reduce((s, c) => s + c, 0));
      discountApplied = 'initiate';
    } else if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
      const cap = member.tier === 'adventurer' ? 1 : 5;
      const remainingCap = Math.max(0, cap - member.plus_ones_used);

      const selfSeats = existingSeats === 0 ? Math.min(1, seats) : 0;
      const plusOneCandidates = seats - selfSeats;
      plusOnesToConsume = Math.min(plusOneCandidates, remainingCap);
      const paidSeats = plusOneCandidates - plusOnesToConsume;

      // Free seats from guild are 0, paid seats are at full event.price.
      seatCosts = [
        ...Array(paidSeats).fill(event.price),
        ...Array(selfSeats + plusOnesToConsume).fill(0),
      ];
      totalAmount = paidSeats * event.price;
      discountApplied = member.tier;
      membershipIdToUpdate = member.id;
      membershipNewPlusOnesUsed = member.plus_ones_used + plusOnesToConsume;
    }
  }

  // Apply giveaway promo to any remaining paid seats (highest cost first).
  // If totalAmount is already 0, the promo is preserved.
  if (totalAmount > 0) {
    const applicablePromo = await getApplicablePromo(supabase, userId, event.price);
    if (applicablePromo) {
      const paidSeatsRemaining = seatCosts.filter((c) => c > 0).length;
      const toConsume = Math.min(paidSeatsRemaining, applicablePromo.remaining_uses);
      if (toConsume > 0) {
        const ok = await consumePromoUses(supabase, applicablePromo, toConsume);
        if (ok) {
          promoIdUsed = applicablePromo.id;
          promoSeatsConsumed = toConsume;
          const sortedCosts = [...seatCosts].sort((a, b) => b - a);
          const reduction = sortedCosts.slice(0, toConsume).reduce((s, c) => s + c, 0);
          totalAmount = Math.max(0, Math.round(totalAmount - reduction));
          if (!discountApplied) discountApplied = 'promo';
        }
      }
    }
  }

  // Apply user credits against the remaining balance
  const { creditsApplied, finalAmount } = await applyCreditsToTotal(supabase, userId, totalAmount);
  totalAmount = finalAmount;

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
      plus_ones_consumed: plusOnesToConsume,
      credits_applied: creditsApplied,
      promo_id: promoIdUsed,
      promo_uses_consumed: promoSeatsConsumed,
      source,
    })
    .select('id')
    .single();

  if (regError) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }

  // Convert any open lead matching this phone+event. Best-effort — failures here
  // must not fail the registration.
  try {
    await supabase
      .from('leads')
      .update({
        converted_at: new Date().toISOString(),
        registration_id: registration.id,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)
      .eq('event_id', body.event_id)
      .is('converted_at', null)
      .is('junk_at', null);
  } catch {
    // swallow
  }

  if (creditsApplied > 0) {
    await recordCreditEvent(supabase, {
      user_id: userId,
      amount: -creditsApplied,
      reason: 'registration_use',
      registration_id: registration.id,
    });
  }

  if (membershipIdToUpdate && plusOnesToConsume > 0) {
    await supabase
      .from('guild_path_members')
      .update({ plus_ones_used: membershipNewPlusOnesUsed })
      .eq('id', membershipIdToUpdate);
  }

  const customQuestionsForEmail = customQuestions
    .filter((q) => {
      const a = customAnswers[q.id];
      return a !== undefined && a !== null && a !== '' && a !== false;
    })
    .map((q) => ({
      id: q.id,
      label: q.label,
      answer: customAnswers[q.id] as string | boolean,
    }));

  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${totalAmount}&for=${encodeURIComponent(event.name)}`
    : '';

  ctx.waitUntil(
    sendEventRegistrationEmail(
      {
        to: email,
        name,
        event: {
          name: event.name,
          date: event.date,
          venue_name: event.venue_name,
          venue_area: event.venue_area ?? null,
          price_includes: event.price_includes ?? null,
        },
        seats,
        total_amount: totalAmount,
        discount_applied: discountApplied,
        custom_questions: customQuestionsForEmail,
        upi: {
          id: env.UPI_ID,
          payee_name: 'Board Game Company',
        },
        payment_url,
      },
      env
    ).catch((err) => console.error('[email] send error', err))
  );

  return jsonResponse({ success: true, registration_id: registration.id });
}
