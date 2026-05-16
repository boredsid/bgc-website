import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getSource } from '../lib/source';
import type { Event, PhoneLookupResponse, EventSpots } from '../lib/types';
import CustomQuestion from './CustomQuestion';
import PaymentSheet from './PaymentSheet';
import { useLeadCapture } from '../lib/use-lead-capture';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Step = 'form' | 'payment' | 'success';

export default function RegistrationForm() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [spots, setSpots] = useState<EventSpots | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('form');

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(1);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>({});
  const [detailsTouched, setDetailsTouched] = useState(false);
  const [membership, setMembership] = useState<PhoneLookupResponse['membership'] | null>(null);
  const [existingSeatsForEvent, setExistingSeatsForEvent] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [phoneLookedUp, setPhoneLookedUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setRegistrationId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('event');

    async function resolveEvent() {
      try {
        let id = paramId;

        if (!id) {
          const { data } = await supabase
            .from('events')
            .select('id')
            .eq('is_published', true)
            .gte('date', new Date().toISOString())
            .order('date', { ascending: true })
            .limit(1)
            .maybeSingle();
          id = data?.id ?? null;
        }

        if (!id) return;

        setEventId(id);

        const eventRes = await supabase.from('events').select('*').eq('id', id).single();
        setEvent(eventRes.data);

        // Spots come from the Worker; if it's unreachable (e.g. *.workers.dev
        // blocked by privacy extensions/Firefox ETP), allow registration to
        // proceed with default capacity rather than blocking the whole page.
        try {
          const spotsRes = await fetch(`${WORKER_URL}/api/event-spots/${id}`);
          if (spotsRes.ok) setSpots(await spotsRes.json());
        } catch {
          // leave spots as null — UI already handles this gracefully
        }
      } finally {
        setLoading(false);
      }
    }

    resolveEvent();
  }, []);

  const lookupPhone = useCallback(async (phoneValue: string, currentEventId: string | null) => {
    const cleaned = phoneValue.replace(/[\s\-\(\)]/g, '');
    const match = cleaned.match(/^(?:\+?91)?(\d{10})$/);
    if (!match) {
      setPhoneLookedUp(false);
      setMembership(null);
      setExistingSeatsForEvent(0);
      return;
    }

    try {
      const res = await fetch(`${WORKER_URL}/api/lookup-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: match[1], event_id: currentEventId }),
      });
      const data: PhoneLookupResponse = await res.json();

      if (data.user.found) {
        if (data.user.name) setName((cur) => cur || data.user.name!);
        if (data.user.email) setEmail((cur) => cur || data.user.email!);
      }
      setMembership(data.membership);
      setExistingSeatsForEvent(data.existing_seats_for_event ?? 0);
      setCreditBalance(data.credit_balance ?? 0);
      setPhoneLookedUp(true);
    } catch {
      setPhoneLookedUp(false);
    }
  }, []);

  useEffect(() => {
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^(?:\+?91)?\d{10}$/.test(cleaned)) {
      if (phoneLookedUp) {
        setPhoneLookedUp(false);
        setMembership(null);
        setExistingSeatsForEvent(0);
        setCreditBalance(0);
      }
      return;
    }
    const t = setTimeout(() => lookupPhone(phone, eventId), 300);
    return () => clearTimeout(t);
  }, [phone, eventId, lookupPhone]);

  const updateCustomAnswer = useCallback((id: string, value: string | boolean) => {
    setCustomAnswers((prev) => ({ ...prev, [id]: value }));
    setDetailsTouched(true);
  }, []);

  useLeadCapture({ phone, name, eventId, detailsTouched });

  if (loading) {
    return <div className="text-center py-12 text-[#1A1A1A]/60 font-heading">Loading...</div>;
  }

  if (!eventId || !event) {
    return (
      <div className="text-center py-8">
        <div className="text-5xl mb-4">🎲</div>
        <h1 className="font-heading text-2xl font-bold mb-2">Event Not Found</h1>
        <p className="text-[#1A1A1A]/70">This event doesn't exist or is no longer available.</p>
        <a href="/calendar" className="inline-block mt-6 btn btn-primary no-underline">
          View upcoming events
        </a>
      </div>
    );
  }

  const soldOut = spots && spots.remaining <= 0;
  const maxSeats = spots ? Math.min(spots.remaining, 10) : 10;

  const grossTotal = event.price * seats;
  let total = grossTotal;
  let discountLabel = '';
  if (membership?.isMember) {
    if (membership.discount === '20') {
      const firstSeats = existingSeatsForEvent === 0 ? Math.min(1, seats) : 0;
      const afterFirst = seats - firstSeats;
      const secondSeats = existingSeatsForEvent + firstSeats < 2 ? Math.min(1, afterFirst) : 0;
      const fullSeats = afterFirst - secondSeats;
      total = Math.round(
        firstSeats * event.price * 0.8 +
          secondSeats * event.price * 0.9 +
          fullSeats * event.price,
      );
      const parts: string[] = [];
      if (firstSeats > 0) parts.push('20% off your seat');
      if (secondSeats > 0) parts.push('10% off second seat');
      if (fullSeats > 0) parts.push(`${fullSeats} seat${fullSeats > 1 ? 's' : ''} at full price`);
      discountLabel = `Initiate member — ${parts.join(', ')}`;
    } else if (membership.discount === 'free') {
      const selfSeats = existingSeatsForEvent === 0 ? Math.min(1, seats) : 0;
      const plusOneCandidates = seats - selfSeats;
      const plusOnesUsed = Math.min(plusOneCandidates, membership.plus_ones_remaining);
      const paidSeats = plusOneCandidates - plusOnesUsed;
      total = paidSeats * event.price;

      const tierName = membership.tier === 'guildmaster' ? 'Guildmaster' : 'Adventurer';
      const remainingAfter = membership.plus_ones_remaining - plusOnesUsed;
      const parts: string[] = [];
      if (selfSeats > 0) parts.push('your seat free');
      if (plusOnesUsed > 0) parts.push(`${plusOnesUsed} plus-one${plusOnesUsed > 1 ? 's' : ''} applied`);
      if (parts.length === 0) parts.push(`${membership.plus_ones_remaining} plus-one${membership.plus_ones_remaining === 1 ? '' : 's'} left`);
      discountLabel = `${tierName} — ${parts.join(', ')}${plusOnesUsed > 0 ? ` (${remainingAfter} left)` : ''}`;
    }
  }

  const subtotalAfterDiscount = total;
  const creditApplied = Math.max(0, Math.min(creditBalance, subtotalAfterDiscount));
  total = subtotalAfterDiscount - creditApplied;

  const eventDate = new Date(event.date);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (total === 0) {
      await submitRegistration('confirmed');
    } else {
      setStep('payment');
    }
  }

  async function submitRegistration(paymentStatus: 'pending' | 'confirmed') {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name,
          phone,
          email,
          seats,
          custom_answers: customAnswers,
          payment_status: paymentStatus,
          source: getSource(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed');
        setStep('form');
        setSubmitting(false);
        return;
      }

      setRegistrationId(data.registration_id);
      setStep('success');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
    setSubmitting(false);
  }

  if (step === 'success') {
    return (
      <div className="card-brutal p-8 text-center" style={{ background: '#A8E6CF' }}>
        <div className="text-6xl mb-4">✅</div>
        <h1 className="font-heading text-3xl font-bold mb-3">You're in! 🎲</h1>
        <p className="text-[#1A1A1A]/85 mb-2">
          See you at <strong>{event.name}</strong> on{' '}
          {eventDate.toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          .
        </p>
        <p className="text-sm text-[#1A1A1A]/70">
          {event.venue_name}, {event.venue_area}
        </p>
        <a
          href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-6 btn btn-black no-underline text-sm"
          style={{ background: '#25D366', color: '#1A1A1A', padding: '8px 16px' }}
        >
          Join the WhatsApp group to stay updated
        </a>
      </div>
    );
  }

  if (step === 'payment') {
    return (
      <PaymentSheet
        amount={total}
        payerName={name}
        onConfirm={() => submitRegistration('pending')}
        onClose={() => setStep('form')}
        submitting={submitting}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 pb-6" style={{ borderBottom: '3px solid #1A1A1A' }}>
        <h1 className="font-heading text-2xl font-bold">{event.name}</h1>
        <p className="text-[#1A1A1A]/70 text-sm mt-1">
          {eventDate.toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}{' '}
          at{' '}
          {eventDate.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}{' '}
          · {event.venue_name}, {event.venue_area}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
          {spots && (
            <span className="text-xs text-[#1A1A1A]/60">
              {spots.remaining} spot{spots.remaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </div>
        {event.price_includes && (
          <div className="card-brutal px-3 py-2 text-sm mt-3 font-heading font-semibold" style={{ background: '#FFD166', boxShadow: '3px 3px 0 #1A1A1A' }}>
            {event.price_includes}
          </div>
        )}
      </div>

      {soldOut ? (
        <div className="text-center py-8">
          <p className="font-heading font-bold text-xl text-[#1A1A1A]/60">Sold Out</p>
          <p className="text-sm text-[#1A1A1A]/60 mt-2">This event is fully booked.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="label-brutal">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              required
              className="input-brutal"
            />
          </div>

          {phoneLookedUp && membership?.isMember && (
            <div className="mb-5">
              <span
                className="pill inline-block"
                style={{ background: '#C3A6FF', padding: '8px 16px' }}
              >
                👑 {discountLabel}
              </span>
            </div>
          )}

          <div className="mb-5">
            <label className="label-brutal">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              required
              className="input-brutal"
            />
          </div>

          <div className="mb-5">
            <label className="label-brutal">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="input-brutal"
            />
          </div>

          <div className="mb-5">
            <label className="label-brutal">Number of Seats</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSeats(Math.max(1, seats - 1))}
                className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
              >
                −
              </button>
              <span className="font-heading font-bold text-xl w-8 text-center">{seats}</span>
              <button
                type="button"
                onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
              >
                +
              </button>
            </div>
          </div>

          {event.custom_questions?.map((q) => (
            <CustomQuestion
              key={q.id}
              question={q}
              value={customAnswers[q.id] ?? (q.type === 'checkbox' ? false : '')}
              onChange={(val) => updateCustomAnswer(q.id, val)}
              optionCounts={spots?.option_counts?.[q.id]}
            />
          ))}

          {creditApplied > 0 && (
            <div className="mt-6 mb-3 flex items-center justify-between text-sm font-heading">
              <span>Credits applied (you have ₹{creditBalance})</span>
              <span className="font-bold text-[#4A9B8E]">−₹{creditApplied}</span>
            </div>
          )}

          <div
            className={`card-brutal p-5 ${creditApplied > 0 ? 'mb-5' : 'mt-6 mb-5'} flex items-center justify-between`}
            style={{ background: '#FFD166' }}
          >
            <span className="font-heading font-bold text-sm uppercase tracking-wider">Total</span>
            <div className="text-right">
              {grossTotal !== total && (
                <span className="text-[#1A1A1A]/60 line-through text-sm mr-2">
                  ₹{grossTotal}
                </span>
              )}
              <span className="font-heading font-bold text-3xl">₹{total}</span>
            </div>
          </div>

          {error && (
            <div
              className="card-brutal p-4 mb-4"
              style={{ background: '#FF6B6B' }}
            >
              <p className="font-heading font-semibold">{error}</p>
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting
              ? 'Submitting...'
              : total === 0
                ? 'Get my spot'
                : 'Proceed to Pay'}
          </button>
          {total > 0 && (
            <p className="text-center text-xs text-[#1A1A1A]/60 mt-3">
              You'll be able to pay via UPI in the next step
            </p>
          )}
        </form>
      )}
    </div>
  );
}
