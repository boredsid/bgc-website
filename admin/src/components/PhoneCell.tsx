import { cn } from '@/lib/utils';

interface Props { phone: string; className?: string }

function digitsOnly(p: string): string {
  return p.replace(/\D/g, '');
}

function format(p: string): string {
  const d = digitsOnly(p);
  // Always 10 trailing digits (Indian mobile); strip a leading 91 if present.
  const rest = d.startsWith('91') && d.length === 12 ? d.slice(2) : d;
  if (rest.length !== 10) return `+91 ${rest}`;
  return `+91 ${rest.slice(0, 5)} ${rest.slice(5)}`;
}

function waNumber(p: string): string {
  const d = digitsOnly(p);
  return d.startsWith('91') ? d : `91${d}`;
}

export function PhoneCell({ phone, className }: Props) {
  return (
    <a
      href={`https://wa.me/${waNumber(phone)}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Message ${format(phone)} on WhatsApp`}
      className={cn('text-inherit hover:underline', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {format(phone)}
    </a>
  );
}
