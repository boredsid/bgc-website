import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getSource } from '../lib/source';
import { formatEventDateLabel, formatEventWhen } from '../lib/event-date';
import type {
  Event,
  PhoneLookupResponse,
  EventSpots,
  ReplayPassCheckResponse,
  CustomQuestion as CustomQuestionType,
} from '../lib/types';
import CustomQuestion from './CustomQuestion';
import PaymentSheet from './PaymentSheet';
import { useLeadCapture } from '../lib/use-lead-capture';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

// Mirror of worker/src/pricing.ts effectiveSeatPrice. The public site is a
// separate package and can't import from worker/, so the rule is duplicated.
// If any selected option carries a price, the base price is ignored and the
// effective per-seat price is the sum of selected priced options; an explicit
// price of 0 counts as a priced selection.
function effectiveSeatPrice(
  questions: CustomQuestionType[],
  answers: Record<string, string | boolean>,
  basePrice: number,
): number {
  const priced: number[] = [];
  for (const q of questions) {
    if (q.type !== 'radio' && q.type !== 'select') continue;
    const answer = answers[q.id];
    if (typeof answer !== 'string' || answer === '') continue;
    const opt = q.options?.find((o) => o.value === answer);
    if (opt && opt.price !== undefined) priced.push(opt.price);
  }
  if (priced.length === 0) return basePrice;
  return priced.reduce((sum, p) => sum + p, 0);
}

// Mirror of worker/src/pricing.ts applyReplayPassSeats. A REPLAY pass belongs to
// one person and is worth one free seat, so a booking gets as many free seats as
// it has pass holders in it — the purchaser plus any companion whose number was
// entered. Seats already free (a Guild Path self-seat, a plus-one) are left be.
function applyReplayPassSeats(
  seatCosts: number[],
  passCount: number,
): { seatCosts: number[]; seatsCovered: number } {
  if (passCount <= 0) return { seatCosts, seatsCovered: 0 };
  const paidIndexes = seatCosts
    .map((cost, index) => ({ cost, index }))
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, passCount)
    .map((s) => s.index);
  if (paidIndexes.length === 0) return { seatCosts, seatsCovered: 0 };
  const next = [...seatCosts];
  for (const i of paidIndexes) next[i] = 0;
  return { seatCosts: next, seatsCovered: paidIndexes.length };
}

// Same 10-digit rule as sanitizePhone in the Worker, so what the form counts as
// a pass holder is what the Worker will accept.
function phoneDigits(value: string): string | null {
  const match = value.replace(/[\s\-\(\)]/g, '').match(/^(?:\+?91)?(\d{10})$/);
  return match ? match[1] : null;
}

type CompanionStatus = 'idle' | 'checking' | 'pass' | 'no_pass' | 'claimed';

interface Companion {
  phone: string;
  status: CompanionStatus;
  editionName: string | null;
}

const BLANK_COMPANION: Companion = { phone: '', status: 'idle', editionName: null };

/**
 * The line under a companion's box. `covered` comes from the pricing pass, so a
 * number that holds a pass but was already counted (typed twice, or the
 * purchaser's own) says so rather than promising a second free seat.
 */
function companionNote(
  companion: Companion,
  covered: boolean,
  purchaserDigits: string | null,
): string | null {
  const digits = phoneDigits(companion.phone);
  if (!digits) return companion.phone.trim() ? 'Enter a 10-digit mobile number' : null;
  if (digits === purchaserDigits) return 'That’s your own number — your pass is already counted';
  if (companion.status === 'checking') return 'Checking…';
  if (companion.status === 'claimed') return 'This pass has already covered a seat for this event';
  if (companion.status === 'no_pass') return 'No confirmed pass on this number — this seat pays full price';
  if (companion.status === 'pass') {
    return covered
      ? `🎟️ ${companion.editionName || 'REPLAY'} pass — this seat is free`
      : 'Already added above';
  }
  return null;
}

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
  const [activePromo, setActivePromo] = useState<PhoneLookupResponse['active_promo']>(null);
  const [replayPass, setReplayPass] = useState<PhoneLookupResponse['replay_pass']>(null);
  // One slot per seat beyond the purchaser's, on REPLAY-perk events only.
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [phoneLookedUp, setPhoneLookedUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
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
            // ends_at, not date: a multi-day event that is running is still the
            // one someone landing on /register means to sign up for.
            .gte('ends_at', new Date().toISOString())
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
        if (!eventRes.data?.externally_managed) {
          try {
            const spotsRes = await fetch(`${WORKER_URL}/api/event-spots/${id}`);
            if (spotsRes.ok) setSpots(await spotsRes.json());
          } catch {
            // leave spots as null — UI already handles this gracefully
          }
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
      setActivePromo(data.active_promo ?? null);
      setReplayPass(data.replay_pass ?? null);
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
        setActivePromo(null);
        setReplayPass(null);
      }
      return;
    }
    const t = setTimeout(() => lookupPhone(phone, eventId), 300);
    return () => clearTimeout(t);
  }, [phone, eventId, lookupPhone]);

  const replayPassFree = !!event?.replay_pass_free;

  // One companion slot per seat beyond the purchaser's own. Trimming keeps the
  // slots the person already filled in when they step the seat count down and
  // back up again.
  useEffect(() => {
    const wanted = replayPassFree ? Math.max(0, seats - 1) : 0;
    setCompanions((prev) => {
      if (prev.length === wanted) return prev;
      if (prev.length > wanted) return prev.slice(0, wanted);
      return [...prev, ...Array.from({ length: wanted - prev.length }, () => BLANK_COMPANION)];
    });
  }, [seats, replayPassFree]);

  const checkCompanionPass = useCallback(async (index: number, digits: string, currentEventId: string | null) => {
    setCompanions((prev) =>
      prev.map((c, i) => (i === index && phoneDigits(c.phone) === digits ? { ...c, status: 'checking' } : c)),
    );
    let next: Partial<Companion>;
    try {
      const res = await fetch(`${WORKER_URL}/api/replay-pass-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, event_id: currentEventId }),
      });
      const data: ReplayPassCheckResponse = await res.json();
      next = {
        status: data.has_pass ? (data.already_claimed ? 'claimed' : 'pass') : 'no_pass',
        editionName: data.edition_name ?? null,
      };
    } catch {
      // Same fail-closed rule as the Worker: an unreachable check costs the
      // discount, never the registration.
      next = { status: 'no_pass', editionName: null };
    }
    // Only land the answer if the box still holds the number we asked about.
    setCompanions((prev) =>
      prev.map((c, i) => (i === index && phoneDigits(c.phone) === digits ? { ...c, ...next } : c)),
    );
  }, []);

  const companionSignature = companions.map((c) => `${c.phone}/${c.status}`).join('|');
  useEffect(() => {
    const pending = companions
      .map((c, index) => ({ index, digits: phoneDigits(c.phone), status: c.status }))
      .filter((c) => c.status === 'idle' && c.digits);
    if (pending.length === 0) return;
    const t = setTimeout(() => {
      for (const c of pending) checkCompanionPass(c.index, c.digits!, eventId);
    }, 400);
    return () => clearTimeout(t);
    // companionSignature stands in for `companions` so this fires on real edits
    // rather than on every render that rebuilds the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionSignature, eventId, checkCompanionPass]);

  const updateCompanionPhone = useCallback((index: number, value: string) => {
    setCompanions((prev) =>
      prev.map((c, i) => (i === index ? { phone: value, status: 'idle', editionName: null } : c)),
    );
  }, []);

  const updateCustomAnswer = useCallback((id: string, value: string | boolean) => {
    setCustomAnswers((prev) => ({ ...prev, [id]: value }));
    setDetailsTouched(true);
  }, []);

  useLeadCapture({ phone, name, eventId, detailsTouched });

  function resetLookup() {
    setPhone('');
    setName('');
    setEmail('');
    setSeats(1);
    setCustomAnswers({});
    setDetailsTouched(false);
    setPhoneLookedUp(false);
    setMembership(null);
    setExistingSeatsForEvent(0);
    setCreditBalance(0);
    setActivePromo(null);
    setReplayPass(null);
    setCompanions([]);
  }

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

  if (event.externally_managed) {
    return (
      <div>
        <div className="mb-6 pb-6" style={{ borderBottom: '3px solid #1A1A1A' }}>
          <h1 className="font-heading text-2xl font-bold">{event.name}</h1>
          <p className="text-[#1A1A1A]/70 text-sm mt-1">
            {formatEventWhen(event)} · {event.venue_name}, {event.venue_area}
          </p>
        </div>
        <div className="card-brutal p-6 text-center" style={{ background: '#A8E6CF' }}>
          <div className="text-4xl mb-3">↗</div>
          <h2 className="font-heading text-xl font-bold mb-2">Registration is managed by our event partner</h2>
          <p className="text-sm text-[#1A1A1A]/80 mb-5">
            Continue to the partner's website for availability, pricing, and registration details.
          </p>
          {event.external_registration_url ? (
            <a
              href={event.external_registration_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary no-underline w-full sm:w-auto"
              style={{ whiteSpace: 'normal' }}
            >
              Continue to registration ↗
            </a>
          ) : (
            <p className="font-heading font-semibold">The registration link is temporarily unavailable.</p>
          )}
        </div>
      </div>
    );
  }

  const soldOut = spots && spots.remaining <= 0;
  const maxSeats = spots ? Math.min(spots.remaining, 10) : 10;

  const seatPrice = effectiveSeatPrice(event.custom_questions || [], customAnswers, event.price);
  const grossTotal = seatPrice * seats;
  const promoFits = !!activePromo && seatPrice <= activePromo.max_event_price;

  // 1. Apply guild discount first, building a per-seat cost array.
  let seatCosts: number[] = Array(seats).fill(seatPrice);
  let total = grossTotal;
  let discountLabel = '';
  // The REPLAY pass is once per person, so it must not stack on a Guild Path
  // seat that is already free.
  let selfSeatFreeFromGuild = false;
  if (membership?.isMember) {
    if (membership.discount === '20') {
      const firstSeats = existingSeatsForEvent === 0 ? Math.min(1, seats) : 0;
      const afterFirst = seats - firstSeats;
      const secondSeats = existingSeatsForEvent + firstSeats < 2 ? Math.min(1, afterFirst) : 0;
      const fullSeats = afterFirst - secondSeats;
      seatCosts = [
        ...Array(fullSeats).fill(seatPrice),
        ...Array(secondSeats).fill(seatPrice * 0.9),
        ...Array(firstSeats).fill(seatPrice * 0.8),
      ];
      total = Math.round(seatCosts.reduce((s, c) => s + c, 0));
      const parts: string[] = [];
      if (firstSeats > 0) parts.push('20% off your seat');
      if (secondSeats > 0) parts.push('10% off second seat');
      if (fullSeats > 0) parts.push(`${fullSeats} seat${fullSeats > 1 ? 's' : ''} at full price`);
      discountLabel = `Initiate member — ${parts.join(', ')}`;
    } else if (membership.discount === 'free') {
      const selfSeats = existingSeatsForEvent === 0 ? Math.min(1, seats) : 0;
      selfSeatFreeFromGuild = selfSeats > 0;
      const plusOneCandidates = seats - selfSeats;
      const plusOnesUsed = Math.min(plusOneCandidates, membership.plus_ones_remaining);
      const paidSeats = plusOneCandidates - plusOnesUsed;
      seatCosts = [
        ...Array(paidSeats).fill(seatPrice),
        ...Array(selfSeats + plusOnesUsed).fill(0),
      ];
      total = paidSeats * seatPrice;

      const tierName = membership.tier === 'guildmaster' ? 'Guildmaster' : 'Adventurer';
      const remainingAfter = membership.plus_ones_remaining - plusOnesUsed;
      const parts: string[] = [];
      if (selfSeats > 0) parts.push('your seat free');
      if (plusOnesUsed > 0) parts.push(`${plusOnesUsed} plus-one${plusOnesUsed > 1 ? 's' : ''} applied`);
      if (parts.length === 0) parts.push(`${membership.plus_ones_remaining} plus-one${membership.plus_ones_remaining === 1 ? '' : 's'} left`);
      discountLabel = `${tierName} — ${parts.join(', ')}${plusOnesUsed > 0 ? ` (${remainingAfter} left)` : ''}`;
    }
  }

  // 2. REPLAY passes cover one seat each — the purchaser's own, plus any
  // companion whose number checked out. A number that has already covered a
  // seat on this event, in any booking, is spent.
  const purchaserPassCounts =
    !!replayPass?.has_pass &&
    !replayPass.already_claimed &&
    existingSeatsForEvent === 0 &&
    !selfSeatFreeFromGuild;

  // Duplicates are one pass however many boxes they are typed into, and the
  // purchaser's own number is counted on its own terms above.
  const companionDigits: string[] = [];
  const seenDigits = new Set<string>([phoneDigits(phone) || '']);
  const companionCovered = companions.map((c) => {
    const digits = phoneDigits(c.phone);
    if (!digits || c.status !== 'pass' || seenDigits.has(digits)) return false;
    seenDigits.add(digits);
    companionDigits.push(digits);
    return true;
  });

  const passCount = (purchaserPassCounts ? 1 : 0) + companionDigits.length;
  const passEditionName =
    replayPass?.edition_name || companions.find((c) => c.editionName)?.editionName || 'REPLAY';

  let replayPassLabel = '';
  if (total > 0 && passCount > 0) {
    const applied = applyReplayPassSeats(seatCosts, passCount);
    if (applied.seatsCovered > 0) {
      seatCosts = applied.seatCosts;
      total = Math.round(seatCosts.reduce((s, c) => s + c, 0));
      replayPassLabel =
        applied.seatsCovered === 1 && purchaserPassCounts
          ? `🎟️ ${passEditionName} pass — your seat is free`
          : `🎟️ ${passEditionName} passes — ${applied.seatsCovered} seat${applied.seatsCovered > 1 ? 's' : ''} free`;
    }
  }

  // 3. If anything's still owed, giveaway covers highest-cost paid seats first.
  let promoLabel = '';
  let promoSeatsApplied = 0;
  if (total > 0 && promoFits) {
    const paidSeatsRemaining = seatCosts.filter((c) => c > 0).length;
    promoSeatsApplied = Math.min(paidSeatsRemaining, activePromo!.remaining_uses);
    if (promoSeatsApplied > 0) {
      const sortedCosts = [...seatCosts].sort((a, b) => b - a);
      const reduction = sortedCosts.slice(0, promoSeatsApplied).reduce((s, c) => s + c, 0);
      total = Math.max(0, Math.round(total - reduction));
      const remainingAfter = activePromo!.remaining_uses - promoSeatsApplied;
      promoLabel = `🎁 Free giveaway — ${promoSeatsApplied} seat${promoSeatsApplied > 1 ? 's' : ''} covered${remainingAfter > 0 ? ` (${remainingAfter} left)` : ''}`;
    }
  }
  const promoPreserved = promoFits && promoSeatsApplied === 0 && activePromo!.remaining_uses > 0;

  const subtotalAfterDiscount = total;
  const creditApplied = Math.max(0, Math.min(creditBalance, subtotalAfterDiscount));
  total = subtotalAfterDiscount - creditApplied;

  const guildGate =
    event.guild_path_exclusive && phoneLookedUp && membership?.isMember === false;

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
          companion_phones: companionDigits,
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

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWaitlistSubmitting(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name,
          phone,
          email,
          seats,
          source: getSource(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      });
      const data = await res.json();
      if (data.available) {
        // A spot opened up between page load and submit. Reload so the page
        // re-resolves capacity and shows the normal registration form — a plain
        // setSpots could leave the user stranded on the waitlist form if the
        // spots re-fetch failed (stale soldOut, no registration path visible).
        window.location.reload();
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not join the waitlist. Please try again.');
        setWaitlistSubmitting(false);
        return;
      }
      setWaitlistJoined(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setWaitlistSubmitting(false);
  }

  if (step === 'success') {
    return (
      <div className="card-brutal p-8 text-center" style={{ background: '#A8E6CF' }}>
        <div className="text-6xl mb-4">✅</div>
        <h1 className="font-heading text-3xl font-bold mb-3">You're in! 🎲</h1>
        <p className="text-[#1A1A1A]/85 mb-2">
          See you at <strong>{event.name}</strong> on{' '}
          {formatEventDateLabel(event, 'long')}.
        </p>
        <p className="text-sm text-[#1A1A1A]/70">
          {event.venue_name}, {event.venue_area}
        </p>
        <a
          href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-6 btn btn-black no-underline text-sm max-w-full"
          style={{ background: '#25D366', color: '#1A1A1A', padding: '8px 16px', whiteSpace: 'normal' }}
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
          {formatEventWhen(event)} · {event.venue_name}, {event.venue_area}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <span className="font-heading font-bold text-lg">₹{seatPrice} / person</span>
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
        {event.replay_pass_free && (
          <div className="mt-3">
            <span
              className="pill inline-block"
              style={{
                background: '#FFD166',
                padding: '6px 14px',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                border: '2px solid #1A1A1A',
              }}
            >
              🎟️ Free with REPLAY Pass
            </span>
            <p className="mt-2 text-sm text-[#1A1A1A]/70 leading-relaxed">
              Registration for this event is free when you enter the phone number linked to a valid{' '}
              <a
                href="https://replaycon.in"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-[#1A1A1A] hover:text-[#F47B20] transition-colors"
              >
                REPLAY pass
              </a>
              . Anyone sitting with you who has their own pass is free too — add their number
              below. Seats without a pass follow the per-person price shown above.
            </p>
          </div>
        )}
        {event.guild_path_exclusive && (
          <div className="mt-3">
            <span
              className="pill inline-block"
              style={{
                background: '#C3A6FF',
                padding: '6px 14px',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                border: '2px solid #1A1A1A',
              }}
            >
              👑 Guild Path Exclusive
            </span>
          </div>
        )}
      </div>

      {soldOut ? (
        waitlistJoined ? (
          <div className="card-brutal p-8 text-center" style={{ background: '#A8E6CF' }}>
            <div className="text-5xl mb-3">🎟️</div>
            <h2 className="font-heading text-2xl font-bold mb-2">You're on the waitlist!</h2>
            <p className="text-[#1A1A1A]/85">
              We'll WhatsApp or email you at <strong>{email}</strong> if a spot opens up for{' '}
              <strong>{event.name}</strong>.
            </p>
          </div>
        ) : (
          <div>
            <div className="card-brutal p-4 mb-5 text-center" style={{ background: '#FFD166' }}>
              <p className="font-heading font-bold">This event is full</p>
              <p className="text-sm text-[#1A1A1A]/75 mt-1">
                Join the waitlist and we'll reach out if a spot frees up.
              </p>
            </div>
            <form onSubmit={joinWaitlist}>
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
                    onClick={() => setSeats(Math.min(10, seats + 1))}
                    className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                    style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
                  >
                    +
                  </button>
                </div>
              </div>
              {error && (
                <div className="card-brutal p-4 mb-4" style={{ background: '#FF6B6B' }}>
                  <p className="font-heading font-semibold">{error}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={waitlistSubmitting}
                className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {waitlistSubmitting ? 'Joining...' : 'Join the waitlist'}
              </button>
            </form>
          </div>
        )
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

          {guildGate ? (
            <div
              className="card-brutal p-6 mt-2"
              style={{ background: '#C3A6FF' }}
            >
              <div className="text-3xl mb-2">👑</div>
              <h2 className="font-heading text-xl font-bold mb-2">
                Guild Path Exclusive Event
              </h2>
              <p className="text-sm text-[#1A1A1A]/85 leading-relaxed mb-4">
                This session is open only to current Guild Path members. Join the
                Guild Path to register for this and other member-only events,
                plus get discounts and free seats on regular events.
              </p>
              <a
                href="/guild-path"
                className="btn btn-primary no-underline inline-block"
              >
                Join Guild Path →
              </a>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={resetLookup}
                  className="text-sm underline text-[#1A1A1A]/70 bg-transparent border-0 cursor-pointer p-0"
                >
                  Try a different phone number
                </button>
              </div>
            </div>
          ) : (
            <>
              {phoneLookedUp && replayPassLabel && (
                <div className="mb-3">
                  <span
                    className="pill inline-block"
                    style={{ background: '#FFD166', padding: '8px 16px' }}
                  >
                    {replayPassLabel}
                  </span>
                </div>
              )}

              {phoneLookedUp && promoLabel && (
                <div className="mb-3">
                  <span
                    className="pill inline-block"
                    style={{ background: '#A8E6CF', padding: '8px 16px' }}
                  >
                    {promoLabel}
                  </span>
                </div>
              )}

              {phoneLookedUp && membership?.isMember && discountLabel && (
                <div className="mb-5">
                  <span
                    className="pill inline-block"
                    style={{ background: '#C3A6FF', padding: '8px 16px' }}
                  >
                    👑 {discountLabel}
                  </span>
                </div>
              )}

              {phoneLookedUp && activePromo && !promoFits && (
                <div className="mb-5 text-xs text-[#1A1A1A]/60">
                  You have a giveaway for events up to ₹{activePromo.max_event_price} — doesn't apply to this event.
                </div>
              )}

              {phoneLookedUp && promoPreserved && (
                <div className="mb-5 text-xs text-[#1A1A1A]/60">
                  🎁 Giveaway preserved — your Guild Path already covers this. {activePromo!.remaining_uses} use{activePromo!.remaining_uses === 1 ? '' : 's'} saved for later.
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

              {event.replay_pass_free && companions.length > 0 && (
                <div className="mb-5 card-brutal p-4" style={{ background: '#FFF4D6' }}>
                  <label className="label-brutal">Anyone else with a REPLAY pass?</label>
                  <p className="text-xs text-[#1A1A1A]/70 leading-relaxed mb-3">
                    Add the number linked to their pass and their seat is free too. One pass covers one
                    seat. Leave blank for anyone without a pass.
                  </p>
                  {companions.map((companion, i) => (
                    <div key={i} className={i === companions.length - 1 ? '' : 'mb-3'}>
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="off"
                        value={companion.phone}
                        onChange={(e) => updateCompanionPhone(i, e.target.value)}
                        placeholder={`Seat ${i + 2} — 10-digit number (optional)`}
                        className="input-brutal"
                      />
                      {companionNote(companion, companionCovered[i], phoneDigits(phone)) && (
                        <p className="text-xs mt-1 font-heading font-semibold">
                          {companionNote(companion, companionCovered[i], phoneDigits(phone))}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

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
            </>
          )}
        </form>
      )}
    </div>
  );
}
