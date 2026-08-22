import {
  bangaloreDayKey,
  formatEventDateLabel,
  formatEventTimeLabel,
  isHappeningNow,
  isMultiDay,
  type EventTiming,
} from '@/lib/eventDate';

interface Props { event: EventTiming; className?: string }

/**
 * Event timing for admin lists. Single-day events keep the familiar relative
 * wording ("Tomorrow, 7:30 pm"); all-day and multi-day events show what they
 * actually are, because "in 3 days" says nothing useful about a three-day run.
 */
export function EventWhen({ event, className }: Props) {
  const timeLabel = event.is_all_day ? 'all day' : formatEventTimeLabel(event);
  const title = `${formatEventDateLabel(event, 'long')}, ${timeLabel}`;

  let label: string;
  if (isMultiDay(event)) {
    label = isHappeningNow(event)
      ? `On now · ${formatEventDateLabel(event)}`
      : `${formatEventDateLabel(event)}, ${timeLabel}`;
  } else {
    const startKey = bangaloreDayKey(event.date);
    const diffDays = Math.round((Date.parse(startKey) - Date.parse(bangaloreDayKey(new Date()))) / 86400000);
    if (diffDays === 0) label = `Today, ${timeLabel}`;
    else if (diffDays === 1) label = `Tomorrow, ${timeLabel}`;
    else if (diffDays === -1) label = `Yesterday, ${timeLabel}`;
    else if (diffDays > 0 && diffDays <= 6) label = `in ${diffDays} days`;
    else if (diffDays < 0 && diffDays >= -6) label = `${Math.abs(diffDays)} days ago`;
    else label = `${formatEventDateLabel(event)}, ${timeLabel}`;
  }

  return (
    <time dateTime={event.date} title={title} className={className}>
      {label}
    </time>
  );
}
