import { Input } from '@/components/ui/input';
import { parseRupees } from '@/lib/validation';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | null;
  onChange: (next: number | null) => void;
  allowRupees?: boolean;
  min?: number;
}

export function NumberInput({ value, onChange, allowRupees, ...rest }: Props) {
  const display = value == null ? '' : String(value);
  return (
    <Input
      type={allowRupees ? 'text' : 'number'}
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        if (allowRupees) {
          const n = parseRupees(raw);
          if (n != null) onChange(n);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      {...rest}
    />
  );
}
