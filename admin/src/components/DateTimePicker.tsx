import { Input } from '@/components/ui/input';

interface Props {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
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

const pad = (n: number) => String(n).padStart(2, '0');

function splitIso(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combine(date: string, time: string): string {
  if (!date) return '';
  const [h, m] = (time || '00:00').split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  const local = new Date(y, mo - 1, d, h, m);
  const offsetMin = -local.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const offH = pad(Math.floor(absMin / 60));
  const offM = pad(absMin % 60);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(m)}:00${sign}${offH}:${offM}`;
}

export function DateTimePicker({ value, onChange, className }: Props) {
  const { date, time } = splitIso(value);
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
        <option value="">—</option>
        {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}
