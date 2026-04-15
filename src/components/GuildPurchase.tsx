import { useState } from 'react';
import PaymentSheet from './PaymentSheet';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Tier = {
  key: string;
  name: string;
  price: number;
  priceLabel: string;
  period: string;
  color: string;
  badge: string | null;
  benefits: string[];
  note: string | null;
};

const TIERS: Tier[] = [
  {
    key: 'initiate',
    name: 'Initiate',
    price: 600,
    priceLabel: '₹600',
    period: '3 months',
    color: 'bg-accent',
    badge: null,
    benefits: [
      'Flat 20% off every event',
      'Flat 10% off for one tag along',
      'Early access to all events',
      'Exclusive Guild Path only events',
      'Valid for 3 months',
    ],
    note: "Free if you've attended 10+ events in the last year",
  },
  {
    key: 'adventurer',
    name: 'Adventurer',
    price: 2000,
    priceLabel: '₹2,000',
    period: '3 months',
    color: 'bg-primary',
    badge: 'Recommended',
    benefits: [
      'Everything under Initiate',
      'Flat 100% off every event',
      'Flat 100% off for one tag along for 1 event',
      'Valid for 3 months',
    ],
    note: null,
  },
  {
    key: 'guildmaster',
    name: 'Guildmaster',
    price: 8000,
    priceLabel: '₹8,000',
    period: '12 months',
    color: 'bg-secondary',
    badge: 'Best Value',
    benefits: [
      'Everything under Adventurer',
      'Flat 100% off every event',
      'Flat 100% off for one tag along across 5 events',
      'Free 2 day passes for REPLAY conventions',
      'Valid for 12 months',
    ],
    note: null,
  },
];

type Step = 'idle' | 'form' | 'payment' | 'submitting' | 'success';

export default function GuildPurchase() {
  const [step, setStep] = useState<Step>('idle');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function selectTier(tier: Tier) {
    setSelectedTier(tier);
    setStep('form');
    setError(null);
  }

  function handleChange() {
    setSelectedTier(null);
    setStep('idle');
    setError(null);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep('payment');
  }

  async function handlePaymentConfirm() {
    if (!selectedTier) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/api/guild-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          tier: selectedTier.key,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        setStep('form');
        setSubmitting(false);
        return;
      }

      setStep('success');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
    setSubmitting(false);
  }

  // Success state
  if (step === 'success') {
    return (
      <div className="bg-white rounded-2xl border border-border p-8 text-center max-w-lg mx-auto">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="font-heading text-2xl font-bold mb-2">Thanks!</h2>
        <p className="text-muted">
          We'll confirm your membership shortly. You'll receive the benefits once your payment is verified.
        </p>
      </div>
    );
  }

  // Payment sheet
  if (step === 'payment' && selectedTier) {
    return (
      <PaymentSheet
        amount={selectedTier.price}
        payerName={name}
        onConfirm={handlePaymentConfirm}
        onClose={() => setStep('form')}
        submitting={submitting}
      />
    );
  }

  return (
    <>
      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`${tier.color} text-white rounded-2xl p-6 flex flex-col relative`}
          >
            {tier.badge && (
              <span className="absolute top-4 right-4 bg-highlight text-secondary text-xs font-bold px-3 py-1 rounded-full">
                {tier.badge}
              </span>
            )}
            <h3 className="font-heading text-2xl font-bold mb-4">{tier.name}</h3>
            <p className="font-heading font-bold text-sm uppercase tracking-wide mb-3 opacity-80">
              Benefits
            </p>
            <ul className="flex-1 space-y-2 mb-6">
              {tier.benefits.map((benefit, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 opacity-60">•</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            {tier.note && (
              <div className="bg-white/20 rounded-lg px-3 py-2 text-xs mb-4">
                {tier.note}
              </div>
            )}
            <div className="border-t border-white/20 pt-4 mb-4">
              <span className="font-heading text-3xl font-bold">{tier.priceLabel}</span>
              <span className="text-sm opacity-70 ml-1">/ {tier.period}</span>
            </div>
            <button
              onClick={() => selectTier(tier)}
              className="w-full py-3 rounded-full border-2 border-white text-white font-heading font-semibold hover:bg-white/10 transition-colors"
            >
              Select Plan
            </button>
          </div>
        ))}
      </div>

      {/* Inline Form */}
      {step === 'form' && selectedTier && (
        <div className="max-w-md mx-auto mt-8">
          <div className="bg-[#FFF8F0] border border-primary rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted">
                Selected plan:{' '}
                <strong className="text-secondary font-heading">{selectedTier.name}</strong>
              </p>
              <button
                onClick={handleChange}
                className="text-sm text-primary hover:underline"
              >
                Change
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-sm text-muted mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Phone *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors mt-1"
              >
                Pay {selectedTier.priceLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
