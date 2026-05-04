import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface ActionItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

interface Props {
  open: boolean;
  title: string;
  actions: ActionItem[];
  onClose: () => void;
}

export function ActionSheet({ open, title, actions, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <ul className="p-2 space-y-1">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                disabled={a.disabled}
                onClick={() => { a.onClick(); onClose(); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11 text-left',
                  a.destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted',
                  a.disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {a.icon}
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
