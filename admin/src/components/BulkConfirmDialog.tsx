import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  title: string;
  count: number;
  sampleNames: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkConfirmDialog({ open, title, count, sampleNames, confirmLabel, onConfirm, onCancel }: Props) {
  const overflow = count - sampleNames.length;
  const description = overflow > 0
    ? `${sampleNames.join(', ')}, +${overflow} more`
    : sampleNames.join(', ');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Keep</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
