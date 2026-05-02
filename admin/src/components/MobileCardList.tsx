import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardField<T> {
  key: string;
  label?: string;
  render: (row: T) => ReactNode;
  primary?: boolean;
}

interface Props<T> {
  rows: T[];
  fields: CardField<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  trailing?: (row: T) => ReactNode;
}

export default function MobileCardList<T>({
  rows, fields, rowKey, onRowClick, emptyMessage, trailing,
}: Props<T>) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{emptyMessage || 'Nothing to show.'}</div>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const primary = fields.find((f) => f.primary);
        const secondaries = fields.filter((f) => !f.primary);
        return (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-md border bg-card p-3 flex items-start gap-3 min-h-[44px]',
              onRowClick && 'cursor-pointer hover:bg-muted/40 active:bg-muted/60',
            )}
          >
            <div className="flex-1 min-w-0">
              {primary && (
                <div className="font-semibold truncate">{primary.render(row)}</div>
              )}
              <div className="text-sm text-muted-foreground space-y-0.5 mt-0.5">
                {secondaries.map((f) => (
                  <div key={f.key} className="truncate">
                    {f.label && <span className="text-xs uppercase tracking-wide mr-1">{f.label}</span>}
                    {f.render(row)}
                  </div>
                ))}
              </div>
            </div>
            {trailing && <div className="shrink-0">{trailing(row)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
