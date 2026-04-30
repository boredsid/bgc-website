const UPI_ID = import.meta.env.PUBLIC_UPI_ID as string;
const RECIPIENT_NAME = 'Board Game Company';

function buildUpiUrl(scheme: string, path: string, amount: number, note: string): string {
  const pn = encodeURIComponent(RECIPIENT_NAME);
  const tn = encodeURIComponent(note);
  return `${scheme}://${path}pay?pa=${UPI_ID}&pn=${pn}&am=${amount}&cu=INR&tn=${tn}`;
}

interface Props {
  amount: number;
  note: string;
}

export default function UpiPaymentBlock({ amount, note }: Props) {
  const genericUpi = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(genericUpi)}`;

  const gpayUrl = buildUpiUrl('tez', 'upi/', amount, note);
  const phonepeUrl = buildUpiUrl('phonepe', '', amount, note);
  const paytmUrl = `paytmmp://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;

  return (
    <>
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

      <div className="mb-6 text-center">
        <p className="label-brutal mb-2">UPI ID</p>
        <div className="pill pill-yellow" style={{ display: 'inline-block', fontSize: '0.9rem' }}>
          {UPI_ID}
        </div>
      </div>

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
    </>
  );
}
