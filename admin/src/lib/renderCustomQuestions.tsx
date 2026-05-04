import type { CustomQuestion } from './types';

interface Args {
  question: CustomQuestion;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  optionCounts?: Record<string, number>;
}

const COLORS = {
  border: '2px solid #1A1A1A',
  text: '#1A1A1A',
  bgWhite: '#FFFFFF',
  bgBlack: '#1A1A1A',
  textInverse: '#FFFFFF',
  required: '#FF6B6B',
  cream: '#FFF8E7',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'Space Grotesk, system-ui, sans-serif',
  fontWeight: 700,
  fontSize: '0.875rem',
  marginBottom: 6,
  color: COLORS.text,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: COLORS.border,
  borderRadius: 8,
  padding: '0.5rem 0.75rem',
  background: COLORS.bgWhite,
  color: COLORS.text,
  fontFamily: 'Inter, system-ui, sans-serif',
};

const buttonBase: React.CSSProperties = {
  border: COLORS.border,
  borderRadius: 8,
  padding: '0.625rem 0.875rem',
  fontFamily: 'Space Grotesk, system-ui, sans-serif',
  fontWeight: 600,
  textAlign: 'left',
  width: '100%',
  cursor: 'pointer',
};

export function renderCustomQuestion({ question, value, onChange, optionCounts }: Args) {
  const { id, label, type, required, options } = question;
  const isFull = (optValue: string, capacity?: number) =>
    capacity !== undefined && optionCounts && (optionCounts[optValue] || 0) >= capacity;

  return (
    <div key={id} style={{ marginBottom: '1.25rem' }}>
      <label htmlFor={`cq-${id}`} style={labelStyle}>
        {label} {required && <span style={{ color: COLORS.required }}>*</span>}
      </label>

      {type === 'text' && (
        <input
          id={`cq-${id}`}
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          required={required}
        />
      )}

      {type === 'select' && options && (
        <select
          id={`cq-${id}`}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'Space Grotesk, system-ui, sans-serif', fontWeight: 600 }}
          required={required}
        >
          <option value="">Select…</option>
          {options.map((opt) => {
            const full = isFull(opt.value, opt.capacity);
            return (
              <option key={opt.value} value={opt.value} disabled={full}>
                {opt.value}{full ? ' (Full)' : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt) => {
            const full = isFull(opt.value, opt.capacity);
            const selected = value === opt.value;
            return (
              <button
                type="button"
                key={opt.value}
                disabled={full}
                onClick={() => !full && onChange(opt.value)}
                style={{
                  ...buttonBase,
                  background: selected ? COLORS.bgBlack : COLORS.bgWhite,
                  color: selected ? COLORS.textInverse : COLORS.text,
                  opacity: full ? 0.5 : 1,
                  cursor: full ? 'not-allowed' : 'pointer',
                }}
              >
                <span>{opt.value}</span>
                {opt.capacity !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: '0.75rem', fontWeight: 400, opacity: 0.7 }}>
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
          style={{
            ...buttonBase,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: (value as boolean) ? COLORS.bgBlack : COLORS.bgWhite,
            color: (value as boolean) ? COLORS.textInverse : COLORS.text,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 4,
              border: '2px solid currentColor',
            }}
          >
            {(value as boolean) ? '✓' : ''}
          </span>
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

export function CustomQuestionsPreview({
  questions,
  values,
  onChange,
}: {
  questions: CustomQuestion[];
  values: Record<string, string | boolean>;
  onChange: (id: string, value: string | boolean) => void;
}) {
  if (questions.length === 0) {
    return <div className="text-sm text-muted-foreground">No questions yet — add one to see the preview.</div>;
  }
  return (
    <div style={{ background: '#FFF8E7', padding: '1rem', borderRadius: 12, border: '2px solid #1A1A1A' }}>
      {questions.map((q) =>
        renderCustomQuestion({
          question: q,
          value: values[q.id] ?? (q.type === 'checkbox' ? false : ''),
          onChange: (v) => onChange(q.id, v),
        }),
      )}
    </div>
  );
}
