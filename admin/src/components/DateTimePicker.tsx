import { Input } from '@/components/ui/input';
import { istIso, istWallClock } from '@/lib/ist';

interface Props {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  /** Hide the time picker and pin the value to Bangalore midnight. */
  dateOnly?: boolean;
  /** Rendered as the empty option, e.g. "Same day" for an optional end. */
  emptyTimeLabel?: string;
}

const TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

// Both directions run in Bangalore time, never the editing machine's zone, so
// an event edited from another country keeps the time at the venue.
function splitIso(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  return istWallClock(iso) ?? { date: '', time: '' };
}

function combine(date: string, time: string): string {
  return istIso(date, time || '00:00');
}

export function DateTimePicker({ value, onChange, className, dateOnly, emptyTimeLabel }: Props) {
  const { date, time } = splitIso(value);

  if (dateOnly) {
    return (
      <Input
        aria-label="Date"
        type="date"
        value={date}
        onChange={(e) => onChange(combine(e.target.value, '00:00'))}
        className={`min-w-0 ${className || ''}`}
      />
    );
  }

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${className || ''}`}>
      <Input
        aria-label="Date"
        type="date"
        value={date}
        onChange={(e) => onChange(combine(e.target.value, time || '00:00'))}
        className="min-w-0"
      />
      <select
        aria-label="Time"
        value={time}
        onChange={(e) => onChange(combine(date, e.target.value))}
        className="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm md:text-sm"
      >
        <option value="">{emptyTimeLabel || '—'}</option>
        {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
