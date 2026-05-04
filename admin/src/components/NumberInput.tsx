import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { parseRupees } from '@/lib/validation';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | null;
  onChange: (next: number | null) => void;
  allowRupees?: boolean;
  min?: number;
}

export function NumberInput({ value, onChange, allowRupees, ...rest }: Props) {
  if (allowRupees) {
    return <NumberInputRupees value={value} onChange={onChange} {...rest} />;
  }
  return <NumberInputNumeric value={value} onChange={onChange} {...rest} />;
}

function NumberInputNumeric({ value, onChange, ...rest }: Omit<Props, 'allowRupees'>) {
  const display = value == null ? '' : String(value);
  return (
    <Input
      type="number"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      {...rest}
    />
  );
}

function NumberInputRupees({ value, onChange, ...rest }: Omit<Props, 'allowRupees'>) {
  const [display, setDisplay] = useState<string>(value == null ? '' : String(value));
  useEffect(() => {
    // Sync down when parent changes value to something not equivalent to display.
    const parsed = parseRupees(display);
    if ((value == null && display === '') || parsed === value) return;
    setDisplay(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        setDisplay(raw);
        if (raw === '') return onChange(null);
        const n = parseRupees(raw);
        if (n != null) onChange(n);
      }}
      {...rest}
    />
  );
}
