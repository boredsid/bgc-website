import { useEffect, useState } from 'react';
import UpiPaymentBlock from './UpiPaymentBlock';

const RECIPIENT_NAME = 'Board Game Company';

type Parsed =
  | { ok: true; amount: number; label: string }
  | { ok: false };

function parseParams(): Parsed {
  if (typeof window === 'undefined') return { ok: false };
  const params = new URLSearchParams(window.location.search);
  const amountRaw = params.get('amount');
  const label = params.get('for');
  if (!amountRaw || !label) return { ok: false };
  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  return { ok: true, amount, label };
}

export default function PaymentPage() {
  const [parsed, setParsed] = useState<Parsed | null>(null);

  useEffect(() => {
    setParsed(parseParams());
  }, []);

  if (parsed === null) {
    return <div className="text-center py-12 text-[#1A1A1A]/60 font-heading">Loading...</div>;
  }

  if (!parsed.ok) {
    return (
      <div className="card-brutal p-8 text-center" style={{ background: '#FFE5E5' }}>
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="font-heading text-2xl font-bold mb-2">Invalid payment link</h1>
        <p className="text-[#1A1A1A]/70 mb-6">
          The link you followed is missing payment details. Please check the URL or contact us.
        </p>
        <a href="/" className="btn btn-black no-underline">
          Back home
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <span className="pill pill-black mb-3 inline-block">Complete Payment</span>
        <h1 className="font-heading font-bold text-2xl mt-2" style={{ letterSpacing: '-0.5px' }}>
          Pay for {parsed.label}
        </h1>
        <p className="font-heading font-bold text-5xl mt-3" style={{ color: '#F47B20', letterSpacing: '-1px' }}>
          ₹{parsed.amount}
        </p>
        <p className="text-sm text-[#1A1A1A]/70 mt-1">{RECIPIENT_NAME}</p>
      </div>

      <div
        className="rounded-2xl p-8"
        style={{
          background: '#FFF8E7',
          border: '4px solid #1A1A1A',
          boxShadow: '8px 8px 0 #1A1A1A',
        }}
      >
        <UpiPaymentBlock amount={parsed.amount} note={parsed.label} />
      </div>

      <div className="text-center mt-8">
        <a href="/" className="text-sm text-[#1A1A1A]/60 no-underline hover:underline">
          ← Done, back home
        </a>
      </div>
    </div>
  );
}
