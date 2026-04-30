import UpiPaymentBlock from './UpiPaymentBlock';

interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

const RECIPIENT_NAME = 'Board Game Company';

export default function PaymentSheet({ amount, payerName, onConfirm, onClose, submitting }: Props) {
  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="animate-modal relative rounded-2xl overflow-y-auto w-full max-w-md"
        style={{
          background: '#FFF8E7',
          border: '4px solid #1A1A1A',
          boxShadow: '12px 12px 0 #1A1A1A',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer font-bold z-10"
          style={{ background: '#FFFFFF', border: '2px solid #1A1A1A' }}
        >
          ✕
        </button>

        <div className="p-8">
          <div className="text-center mb-6">
            <span className="pill pill-black mb-3 inline-block">Complete Payment</span>
            <p className="font-heading font-bold text-4xl mt-2" style={{ color: '#F47B20', letterSpacing: '-1px' }}>
              ₹{amount}
            </p>
            <p className="text-sm text-[#1A1A1A]/70 mt-1">{RECIPIENT_NAME}</p>
          </div>

          <UpiPaymentBlock amount={amount} note={payerName} />

          <button
            onClick={onConfirm}
            disabled={submitting}
            className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : "I've completed the payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
