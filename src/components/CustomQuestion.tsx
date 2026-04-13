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
      <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
        {label} {required && <span className="text-error">*</span>}
      </label>

      {type === 'text' && (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          required={required}
        />
      )}

      {type === 'select' && options && (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          required={required}
        >
          <option value="">Select...</option>
          {options.map((opt) => {
            const full = isOptionFull(opt.value, opt.capacity);
            return (
              <option key={opt.value} value={opt.value} disabled={full}>
                {opt.value}{full ? ' (Full)' : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => {
            const full = isOptionFull(opt.value, opt.capacity);
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  value === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                } ${full ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name={id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => onChange(opt.value)}
                  disabled={full}
                  className="accent-primary"
                />
                <span className="text-sm">
                  {opt.value}
                  {opt.capacity !== undefined && (
                    <span className="text-muted ml-1">
                      {full ? '(Full)' : `(${opt.capacity - (optionCounts?.[opt.value] || 0)} spots)`}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {type === 'checkbox' && (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-primary w-4 h-4"
          />
          <span className="text-sm">{label}</span>
        </label>
      )}
    </div>
  );
}
