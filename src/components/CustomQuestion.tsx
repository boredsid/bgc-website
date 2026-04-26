import type { CustomQuestion as CQ } from '../lib/types';

interface Props {
  question: CQ;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  optionCounts?: Record<string, number>;
}

export default function CustomQuestion({ question, value, onChange, optionCounts }: Props) {
  const { id, label, type, required, options } = question;

  function isOptionFull(optValue: string, capacity?: number): boolean {
    if (capacity === undefined || !optionCounts) return false;
    return (optionCounts[optValue] || 0) >= capacity;
  }

  return (
    <div className="mb-5">
      <label className="label-brutal">
        {label} {required && <span style={{ color: '#FF6B6B' }}>*</span>}
      </label>

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
            const full = isOptionFull(opt.value, opt.capacity);
            return (
              <option key={opt.value} value={opt.value} disabled={full}>
                {opt.value}
                {full ? ' (Full)' : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => {
            const full = isOptionFull(opt.value, opt.capacity);
            const selected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={full}
                onClick={() => !full && onChange(opt.value)}
                className={`text-left font-heading font-semibold rounded-lg px-4 py-3 cursor-pointer transition-colors ${full ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{
                  border: '2px solid #1A1A1A',
                  background: selected ? '#1A1A1A' : '#FFFFFF',
                  color: selected ? '#FFFFFF' : '#1A1A1A',
                }}
              >
                <span>{opt.value}</span>
                {opt.capacity !== undefined && (
                  <span className="ml-2 text-xs font-normal opacity-70">
                    {full
                      ? '(Full)'
                      : `(${opt.capacity - (optionCounts?.[opt.value] || 0)} spots)`}
                  </span>
                )}
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
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}
