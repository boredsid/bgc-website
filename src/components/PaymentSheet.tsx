interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

const UPI_ID = 'suranjanadatta24-1@okaxis';
const RECIPIENT_NAME = 'Board Game Company';

function buildUpiUrl(scheme: string, path: string, amount: number, payerName: string): string {
  const pn = encodeURIComponent(RECIPIENT_NAME);
  const tn = encodeURIComponent(payerName);
  return `${scheme}://${path}pay?pa=${UPI_ID}&pn=${pn}&am=${amount}&cu=INR&tn=${tn}`;
}

export default function PaymentSheet({ amount, payerName, onConfirm, onClose, submitting }: Props) {
  const genericUpi = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(payerName)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(genericUpi)}`;

  const gpayUrl = buildUpiUrl('tez', 'upi/', amount, payerName);
  const phonepeUrl = buildUpiUrl('phonepe', '', amount, payerName);
  const paytmUrl = `paytmmp://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(payerName)}`;

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
          {/* Header */}
          <div className="text-center mb-6">
            <span className="pill pill-black mb-3 inline-block">Complete Payment</span>
            <p className="font-heading font-bold text-4xl mt-2" style={{ color: '#F47B20', letterSpacing: '-1px' }}>
              ₹{amount}
            </p>
            <p className="text-sm text-[#1A1A1A]/70 mt-1">{RECIPIENT_NAME}</p>
          </div>

          {/* QR Code */}
          <div className="text-center mb-6">
            <p className="label-brutal mb-3">Scan with any UPI app</p>
            <div
              className="inline-block"
              style={{
                padding: '12px',
                background: '#FFFFFF',
                border: '4px solid #1A1A1A',
                boxShadow: '6px 6px 0 #1A1A1A',
                borderRadius: '16px',
              }}
            >
              <img src={qrUrl} alt="UPI QR Code" className="w-48 h-48 block" />
            </div>
          </div>

          {/* UPI ID */}
          <div className="mb-6 text-center">
            <p className="label-brutal mb-2">UPI ID</p>
            <div className="pill pill-yellow" style={{ display: 'inline-block', fontSize: '0.9rem' }}>
              {UPI_ID}
            </div>
          </div>

          {/* UPI App Buttons */}
          <div className="mb-6">
            <p className="label-brutal text-center mb-3">Or pay directly with</p>
            <div className="grid grid-cols-3 gap-3">
              <a
                href={gpayUrl}
                aria-label="Pay with Google Pay"
                className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
                style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
              >
                <img src="/payment-app-icons/gpay.png" alt="Google Pay" className="max-h-10 max-w-[80%] object-contain" />
              </a>
              <a
                href={phonepeUrl}
                aria-label="Pay with PhonePe"
                className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
                style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
              >
                <img src="/payment-app-icons/phonepe.png" alt="PhonePe" className="max-h-10 max-w-[80%] object-contain" />
              </a>
              <a
                href={paytmUrl}
                aria-label="Pay with Paytm"
                className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
                style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
              >
                <img src="/payment-app-icons/paytm.jpg" alt="Paytm" className="max-h-10 max-w-[80%] object-contain" />
              </a>
            </div>
          </div>

          {/* Confirm Button */}
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
