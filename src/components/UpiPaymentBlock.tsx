const UPI_ID = import.meta.env.PUBLIC_UPI_ID as string;
const RECIPIENT_NAME = 'Board Game Company';

/**
 * The query the app buttons hand to a UPI app. The amount goes out with two
 * decimals because strict validators reject a bare integer.
 */
function upiQuery(amount: number, note: string): string {
  const pn = encodeURIComponent(RECIPIENT_NAME);
  const tn = encodeURIComponent(note);
  return `pa=${UPI_ID}&pn=${pn}&am=${amount.toFixed(2)}&cu=INR&tn=${tn}`;
}

/**
 * Chrome for Android will not follow a bare custom scheme like `tez://` — it
 * fails with ERR_UNKNOWN_URL_SCHEME unless an installed app claims the scheme,
 * and Google Pay dropped the Tez-era one after the rebrand. The Android-native
 * form is an intent URI naming the package, which also sends people to the Play
 * Store listing when the app is missing instead of to an error page.
 */
function androidIntentUrl(androidPackage: string, query: string): string {
  return `intent://pay?${query}#Intent;scheme=upi;package=${androidPackage};end`;
}

function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

const UPI_APPS = [
  {
    key: 'gpay',
    label: 'Google Pay',
    icon: '/payment-app-icons/gpay.png',
    androidPackage: 'com.google.android.apps.nbu.paisa.user',
    scheme: 'tez',
    path: 'upi/',
  },
  {
    key: 'phonepe',
    label: 'PhonePe',
    icon: '/payment-app-icons/phonepe.png',
    androidPackage: 'com.phonepe.app',
    scheme: 'phonepe',
    path: '',
  },
  {
    key: 'paytm',
    label: 'Paytm',
    icon: '/payment-app-icons/paytm.jpg',
    androidPackage: 'net.one97.paytm',
    scheme: 'paytmmp',
    path: '',
  },
] as const;

interface Props {
  amount: number;
  note: string;
}

export default function UpiPaymentBlock({ amount, note }: Props) {
  const genericUpi = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(genericUpi)}`;

  const appUrlQuery = upiQuery(amount, note);
  const android = isAndroid();

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
          {UPI_APPS.map((app) => (
            <a
              key={app.key}
              href={android ? androidIntentUrl(app.androidPackage, appUrlQuery) : `${app.scheme}://${app.path}pay?${appUrlQuery}`}
              aria-label={`Pay with ${app.label}`}
              className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
              style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
            >
              <img src={app.icon} alt={app.label} className="max-h-10 max-w-[80%] object-contain" />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
