import { useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { DiscardGuardModal } from './DiscardGuardModal';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  errorCount?: number;
  errorMessage?: string | null;
}

export function FormDrawer({
  open, title, children, dirty, saving, onCancel, onSave, errorCount, errorMessage,
}: Props) {
  const [askDiscard, setAskDiscard] = useState(false);

  function attemptCancel() {
    if (dirty) setAskDiscard(true);
    else onCancel();
  }

  const saveLabel = saving
    ? 'Saving…'
    : errorCount && errorCount > 0
      ? `Save (${errorCount} issue${errorCount === 1 ? '' : 's'})`
      : 'Save';

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) attemptCancel(); }}>
        <SheetContent
          side="bottom"
          className="md:!right-0 md:!left-auto md:!top-0 md:!bottom-0 md:!w-full md:!max-w-2xl md:!h-full max-h-[92vh] md:max-h-none rounded-t-xl md:rounded-none flex flex-col p-0"
        >
          <SheetHeader className="px-4 pt-4 md:px-6 md:pt-6 pb-2 border-b">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>

          {errorMessage && (
            <div className="mx-4 md:mx-6 mt-3 rounded-md bg-status-cancelled text-status-cancelled-foreground p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>{errorMessage}</div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
            {children}
          </div>

          <div
            className="border-t bg-background px-4 md:px-6 py-3 flex justify-end gap-2"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            <Button variant="ghost" onClick={attemptCancel} disabled={saving}>Cancel</Button>
            <Button onClick={onSave} disabled={saving}>{saveLabel}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <DiscardGuardModal
        open={askDiscard}
        onCancel={() => setAskDiscard(false)}
        onDiscard={() => { setAskDiscard(false); onCancel(); }}
      />
    </>
  );
}
