import type { CustomQuestion as CQ, CustomQuestionOption } from '../lib/types';
import { optionSpotsLeft, spotsText } from '../lib/option-capacity';

interface Props {
  question: CQ;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  optionCounts?: Record<string, number>;
  eventRemaining?: number;
  seats: number;
}

export default function CustomQuestion({ question, value, onChange, optionCounts, eventRemaining, seats }: Props) {
  const { id, label, type, required, options } = question;

  // An option with fewer spots than the seats being booked can't be chosen.
  // One already chosen stays chosen (fresh counts can shrink it after the
  // fact) — the form explains and refuses it at submit instead.
  function availability(opt: CustomQuestionOption) {
    const left = optionSpotsLeft(opt, optionCounts, eventRemaining);
    const tooFew = left !== null && left < seats;
    const note =
      left === null ? '' : left === 0 ? 'Full' : tooFew ? `${left} left — not enough for ${seats}` : `${spotsText(left)} left`;
    return { unavailable: tooFew && value !== opt.value, note };
  }

  return (
    <div className="mb-5">
      {type !== 'checkbox' && (
        <label className="label-brutal">
          {label} {required && <span style={{ color: '#FF6B6B' }}>*</span>}
        </label>
      )}

      {type === 'text' && (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal"
          required={required}
        />
      )}

      {type === 'select' && options && (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="input-brutal font-heading font-semibold"
          required={required}
        >
          <option value="">Select...</option>
          {options.map((opt) => {
            const { unavailable, note } = availability(opt);
            return (
              <option key={opt.value} value={opt.value} disabled={unavailable}>
                {opt.value}
                {note ? ` (${note})` : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => {
            const { unavailable, note } = availability(opt);
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                // aria-disabled, not disabled: keyboard and screen-reader users
                // can still reach the option and hear why it can't be picked.
                aria-disabled={unavailable}
                aria-pressed={selected}
                onClick={() => {
                  if (unavailable) return;
                  // A second tap clears an optional question, so a capped choice
                  // isn't stuck limiting the seat count.
                  onChange(selected && !required ? '' : opt.value);
                }}
                className={`text-left font-heading font-semibold rounded-lg px-4 py-3 transition-colors ${unavailable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                style={{
                  border: '2px solid #1A1A1A',
                  background: selected ? '#1A1A1A' : '#FFFFFF',
                  color: selected ? '#FFFFFF' : '#1A1A1A',
                }}
              >
                <span>{opt.value}</span>
                {note && <span className="ml-2 text-xs font-normal opacity-70">({note})</span>}
              </button>
            );
          })}
        </div>
      )}

      {type === 'checkbox' && (
        <button
          type="button"
          onClick={() => onChange(!(value as boolean))}
          className="flex items-center gap-3 font-heading font-semibold rounded-lg px-4 py-3 cursor-pointer w-full text-left"
          style={{
            border: '2px solid #1A1A1A',
            background: (value as boolean) ? '#1A1A1A' : '#FFFFFF',
            color: (value as boolean) ? '#FFFFFF' : '#1A1A1A',
          }}
        >
          <span className="inline-flex items-center justify-center w-5 h-5 rounded" style={{ border: '2px solid currentColor' }}>
            {(value as boolean) ? '✓' : ''}
          </span>
          <span>
            {label} {required && <span style={{ color: '#FF6B6B' }}>*</span>}
          </span>
        </button>
      )}
    </div>
  );
}
