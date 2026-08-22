import { istWallClock } from '@/lib/ist';

interface Props { iso: string; className?: string }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Rendered in Bangalore time, not the viewing machine's zone: these are
// timestamps from a Bangalore business, read by admins who think in IST.
function formatTime(time: string): string {
  const [h24, m] = time.split(':').map(Number);
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function RelativeDate({ iso, className }: Props) {
  const wc = istWallClock(iso);
  if (!wc) return <time className={className}>—</time>;

  const time = formatTime(wc.time);
  const [y, m, d] = wc.date.split('-').map(Number);
  // Compare Bangalore calendar days, so "Today" flips at Bangalore midnight.
  const today = istWallClock(new Date())!.date;
  const diffDays = Math.round((Date.parse(wc.date) - Date.parse(today)) / 86400000);
  // Weekday of the Bangalore date, read via UTC to avoid a second zone shift.
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  let label: string;
  if (Math.abs(diffDays) <= 6) {
    if (diffDays === 0) label = `Today, ${time}`;
    else if (diffDays === 1) label = `Tomorrow, ${time}`;
    else if (diffDays === -1) label = `Yesterday, ${time}`;
    else if (diffDays > 0) label = `in ${diffDays} days`;
    else label = `${Math.abs(diffDays)} days ago`;
  } else {
    label = `${weekday} ${d} ${MONTH[m - 1]}, ${time}`;
  }

  return (
    <time dateTime={iso} title={iso} className={className}>
      {label}
    </time>
  );
}
