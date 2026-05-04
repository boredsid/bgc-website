import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}

export function BulkActionBar({ count, actions, onClear }: Props) {
  if (count === 0) return null;
  return (
    <div className="hidden md:flex sticky top-0 z-30 bg-secondary text-secondary-foreground rounded-md mb-3 px-3 py-2 items-center gap-2 flex-wrap">
      <span className="font-medium">{count} selected</span>
      <span className="opacity-50">·</span>
      {actions.map((a) => (
        <Button
          key={a.label}
          size="sm"
          variant={a.destructive ? 'destructive' : 'secondary'}
          onClick={a.onClick}
          disabled={a.disabled}
          className={cn(a.destructive ? '' : 'bg-background text-foreground hover:bg-muted')}
        >
          {a.label}
        </Button>
      ))}
      <span className="opacity-50">·</span>
      <Button size="sm" variant="ghost" onClick={onClear} className="text-secondary-foreground hover:bg-secondary/80">
        Clear
      </Button>
    </div>
  );
}
