import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}

export function DiscardGuardModal({ open, onCancel, onDiscard }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard your changes?</DialogTitle>
          <DialogDescription>
            You'll lose anything you've typed but haven't saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Keep editing</Button>
          <Button variant="destructive" onClick={onDiscard}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
