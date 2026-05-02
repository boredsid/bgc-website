import { cn } from '@/lib/utils';

export type Status = 'confirmed' | 'pending' | 'cancelled' | 'paid' | 'draft' | 'published';

const styles: Record<Status, string> = {
  confirmed: 'bg-status-confirmed text-status-confirmed-foreground status-confirmed',
  pending: 'bg-status-pending text-status-pending-foreground status-pending',
  cancelled: 'bg-status-cancelled text-status-cancelled-foreground status-cancelled',
  paid: 'bg-status-paid text-status-paid-foreground status-paid',
  draft: 'bg-status-draft text-status-draft-foreground status-draft',
  published: 'bg-status-published text-status-published-foreground status-published',
};

const labels: Record<Status, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  cancelled: 'Cancelled',
  paid: 'Paid',
  draft: 'Draft',
  published: 'Published',
};

interface Props { status: Status; className?: string }

export function StatusBadge({ status, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles[status],
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}
