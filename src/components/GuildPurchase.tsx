import { useState } from 'react';
import PaymentSheet from './PaymentSheet';
import { TIERS, type Tier } from '../lib/guild-tiers';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

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
      <div className="card-brutal p-8 text-center max-w-lg mx-auto" style={{ background: '#A8E6CF' }}>
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="font-heading text-2xl font-bold mb-2">Thanks!</h2>
        <p className="text-[#1A1A1A]/70">
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
            className="card-brutal p-8 flex flex-col relative"
            style={{ background: tier.color }}
          >
            {tier.badge && (
              <span className="pill pill-black absolute top-4 right-4">
                {tier.badge}
              </span>
            )}
            <span className="pill pill-black mb-4 self-start">{tier.name}</span>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="font-heading font-bold text-4xl">{tier.priceLabel}</span>
              <span className="text-sm text-[#1A1A1A]/70">/ {tier.period}</span>
            </div>
            <p className="font-heading font-bold text-xs uppercase tracking-wide mb-3 text-[#1A1A1A]/60">
              Benefits
            </p>
            <ul className="flex-1 space-y-2 mb-6 list-none p-0">
              {tier.benefits.map((benefit, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span>✓</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            {tier.note && (
              <div
                className="card-brutal px-3 py-2 text-xs mb-4"
                style={{ background: 'rgba(255,255,255,0.6)', boxShadow: '3px 3px 0 #1A1A1A' }}
              >
                {tier.note}
              </div>
            )}
            <button
              onClick={() => selectTier(tier)}
              className="btn btn-black w-full"
            >
              Select Plan
            </button>
          </div>
        ))}
      </div>

      {/* Inline Form */}
      {step === 'form' && selectedTier && (
        <div className="max-w-md mx-auto mt-8">
          <div className="card-brutal p-8" style={{ background: '#FFFFFF' }}>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-[#1A1A1A]/60">
                Selected plan:{' '}
                <strong className="text-[#1A1A1A] font-heading">{selectedTier.name}</strong>
              </p>
              <button
                onClick={handleChange}
                className="btn btn-secondary btn-sm"
              >
                Change
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
              <div>
                <label className="label-brutal">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className="input-brutal w-full"
                />
              </div>
              <div>
                <label className="label-brutal">Phone *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  required
                  className="input-brutal w-full"
                />
              </div>
              <div>
                <label className="label-brutal">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="input-brutal w-full"
                />
              </div>

              {error && (
                <div className="card-brutal p-4 mb-4" style={{ background: '#FF6B6B' }}>
                  <p className="font-heading font-semibold">{error}</p>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full"
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
