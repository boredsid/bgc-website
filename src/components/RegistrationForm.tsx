import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, PhoneLookupResponse, EventSpots } from '../lib/types';
import CustomQuestion from './CustomQuestion';
import PaymentSheet from './PaymentSheet';

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
  const [membership, setMembership] = useState<PhoneLookupResponse['membership'] | null>(null);
  const [phoneLookedUp, setPhoneLookedUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('event');
    setEventId(id);
  }, []);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    async function fetchEvent() {
      const [eventRes, spotsRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        fetch(`${WORKER_URL}/api/event-spots/${eventId}`).then((r) => r.json()),
      ]);

      setEvent(eventRes.data);
      setSpots(spotsRes);
      setLoading(false);
    }
    fetchEvent();
  }, [eventId]);

  const lookupPhone = useCallback(async (phoneValue: string) => {
    const cleaned = phoneValue.replace(/[\s\-\(\)]/g, '');
    const match = cleaned.match(/^(?:\+?91)?(\d{10})$/);
    if (!match) {
      setPhoneLookedUp(false);
      setMembership(null);
      return;
    }

    try {
      const res = await fetch(`${WORKER_URL}/api/lookup-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: match[1] }),
      });
      const data: PhoneLookupResponse = await res.json();

      if (data.user.found) {
        if (data.user.name && !name) setName(data.user.name);
        if (data.user.email && !email) setEmail(data.user.email);
      }
      setMembership(data.membership);
      setPhoneLookedUp(true);
    } catch {
      setPhoneLookedUp(false);
    }
  }, [name, email]);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  if (!eventId || !event) {
    return (
      <div className="text-center py-12">
        <h1 className="font-heading text-2xl font-bold mb-2">Event Not Found</h1>
        <p className="text-muted">
          This event doesn't exist or is no longer available.
        </p>
        <a href="/calendar" className="text-primary hover:underline mt-4 inline-block">
          View upcoming events
        </a>
      </div>
    );
  }

  const soldOut = spots && spots.remaining <= 0;
  const maxSeats = spots ? Math.min(spots.remaining, 10) : 10;

  let total = event.price * seats;
  let discountLabel = '';
  if (membership?.isMember) {
    if (membership.discount === 'free') {
      total = 0;
      discountLabel = `${membership.tier} member — free!`;
    } else if (membership.discount === '20') {
      total = Math.round(total * 0.8);
      discountLabel = 'Initiate member — 20% off';
    }
  }

  const eventDate = new Date(event.date);

  function handleCustomAnswer(questionId: string, value: string | boolean) {
    setCustomAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

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
      <div className="bg-white rounded-2xl border border-border p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="font-heading text-2xl font-bold mb-2">You're registered!</h1>
        <p className="text-muted mb-4">
          See you at <strong>{event.name}</strong> on{' '}
          {eventDate.toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          .
        </p>
        <p className="text-sm text-muted">
          {event.venue_name}, {event.venue_area}
        </p>
        <a
          href="/calendar"
          className="inline-block mt-6 text-primary hover:underline font-medium"
        >
          Back to events
        </a>
      </div>
    );
  }

  if (step === 'payment') {
    return (
      <PaymentSheet
        amount={total}
        payerName={name}
        onConfirm={() => submitRegistration('confirmed')}
        onClose={() => setStep('form')}
        submitting={submitting}
      />
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
      <div className="mb-6 pb-6 border-b border-border">
        <h1 className="font-heading text-2xl font-bold">{event.name}</h1>
        <p className="text-muted text-sm mt-1">
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
          &middot; {event.venue_name}, {event.venue_area}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
          {spots && (
            <span className="text-xs text-muted">
              {spots.remaining} spot{spots.remaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </div>
      </div>

      {soldOut ? (
        <div className="text-center py-8">
          <p className="font-heading font-bold text-xl text-muted">Sold Out</p>
          <p className="text-sm text-muted mt-2">This event is fully booked.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => lookupPhone(phone)}
              placeholder="10-digit mobile number"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {phoneLookedUp && membership?.isMember && (
            <div className="bg-highlight/30 border border-highlight rounded-xl px-4 py-3 mb-5 text-sm font-medium">
              ✨ {discountLabel}
            </div>
          )}

          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Number of Seats
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSeats(Math.max(1, seats - 1))}
                className="w-10 h-10 rounded-xl border border-border bg-white font-bold text-lg hover:border-primary transition-colors"
              >
                −
              </button>
              <span className="font-heading font-bold text-xl w-8 text-center">{seats}</span>
              <button
                type="button"
                onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                className="w-10 h-10 rounded-xl border border-border bg-white font-bold text-lg hover:border-primary transition-colors"
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
              onChange={(val) => handleCustomAnswer(q.id, val)}
              optionCounts={spots?.option_counts?.[q.id]}
            />
          ))}

          <div className="flex items-center justify-between py-4 border-t border-border mt-6 mb-4">
            <span className="font-semibold text-muted">Total</span>
            <div className="text-right">
              {membership?.isMember && membership.discount && event.price * seats !== total && (
                <span className="text-muted line-through text-sm mr-2">
                  ₹{event.price * seats}
                </span>
              )}
              <span className="font-heading font-bold text-2xl">₹{total}</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {submitting
              ? 'Submitting...'
              : total === 0
                ? 'Get my spot'
                : 'Proceed to Pay'}
          </button>
          {total > 0 && (
            <p className="text-center text-xs text-muted mt-2">
              You'll be able to pay via UPI in the next step
            </p>
          )}
        </form>
      )}
    </div>
  );
}
