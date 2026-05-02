interface Props { iso: string; className?: string }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function RelativeDate({ iso, className }: Props) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  let label: string;
  if (Math.abs(diffDays) <= 6) {
    if (diffDays === 0) label = `Today, ${formatTime(date)}`;
    else if (diffDays === 1) label = `Tomorrow, ${formatTime(date)}`;
    else if (diffDays === -1) label = `Yesterday, ${formatTime(date)}`;
    else if (diffDays > 0) label = `in ${diffDays} days`;
    else label = `${Math.abs(diffDays)} days ago`;
  } else {
    label = `${WEEKDAY[date.getDay()]} ${date.getDate()} ${MONTH[date.getMonth()]}, ${formatTime(date)}`;
  }

  return (
    <time dateTime={iso} title={iso} className={className}>
      {label}
    </time>
  );
}
