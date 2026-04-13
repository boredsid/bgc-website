interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

const UPI_ID = 'REPLACE_WITH_BGC_UPI_ID';
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
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-w-xl mx-auto animate-slide-up">
        <div className="p-6">
          {/* Handle */}
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="font-heading font-bold text-xl">Complete Payment</h2>
            <p className="font-heading font-bold text-3xl text-primary mt-1">₹{amount}</p>
            <p className="text-sm text-muted">{RECIPIENT_NAME}</p>
          </div>

          <hr className="border-border mb-6" />

          {/* QR Code */}
          <div className="text-center mb-6">
            <p className="text-sm text-muted mb-3">Scan with any UPI app</p>
            <div className="inline-block bg-white p-3 rounded-xl border border-border">
              <img src={qrUrl} alt="UPI QR Code" className="w-48 h-48" />
            </div>
          </div>

          <hr className="border-border mb-6" />

          {/* UPI App Buttons */}
          <div className="mb-6">
            <p className="text-sm text-muted text-center mb-3">Or pay directly with</p>
            <div className="flex justify-center gap-4">
              <a
                href={gpayUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">G</div>
                <span className="text-xs text-secondary">GPay</span>
              </a>
              <a
                href={phonepeUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">P</div>
                <span className="text-xs text-secondary">PhonePe</span>
              </a>
              <a
                href={paytmUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">₹</div>
                <span className="text-xs text-secondary">Paytm</span>
              </a>
            </div>
          </div>

          {/* Confirm Button */}
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : "I've completed the payment"}
          </button>
        </div>
      </div>
    </>
  );
}
