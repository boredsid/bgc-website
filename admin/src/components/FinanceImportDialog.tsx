import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { prepareSheetImport } from '@/lib/financeImport';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { FinanceCategory } from '@/lib/types';

interface Props {
  open: boolean;
  categories: FinanceCategory[];
  onClose: () => void;
  onImported: () => void;
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function FinanceImportDialog({ open, categories, onClose, onImported }: Props) {
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [file, setFile] = useState<File | null>(null);
  const [incomeCategory, setIncomeCategory] = useState('Other income');
  const [preview, setPreview] = useState<{ rows: number; total: number; errors: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  async function inspect(nextFile: File | null) {
    setFile(nextFile);
    if (!nextFile) {
      setPreview(null);
      return;
    }
    const text = await nextFile.text();
    const prepared = prepareSheetImport(text, kind, incomeCategory);
    setPreview({
      rows: prepared.rows.length,
      total: prepared.rows.reduce((sum, row) => sum + row.amount, 0),
      errors: prepared.errors,
    });
  }

  async function importFile() {
    if (!file) return;
    setSaving(true);
    try {
      const text = await file.text();
      const prepared = prepareSheetImport(text, kind, incomeCategory);
      if (prepared.errors.length > 0) {
        setPreview({
          rows: prepared.rows.length,
          total: prepared.rows.reduce((sum, row) => sum + row.amount, 0),
          errors: prepared.errors,
        });
        return;
      }
      const result = await fetchAdmin<{ imported: number; control_total: number }>('/api/admin/finance/import', {
        method: 'POST',
        body: JSON.stringify({
          source_name: file.name,
          source_sha256: await sha256(text),
          rows: prepared.rows,
        }),
      });
      toast.success(`Imported ${result.imported} rows · ₹${result.control_total.toLocaleString('en-IN')}`);
      setFile(null);
      setPreview(null);
      onImported();
      onClose();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  }

  const incomeCategories = categories.filter((category) => category.transaction_type === 'income' && category.is_active);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Import historical transactions</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Export one Income or Expenses tab as CSV. The importer preserves displayed dates and rejects duplicate files.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Sheet type</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as 'income' | 'expense');
                setFile(null);
                setPreview(null);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expenses</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === 'income' && (
            <div>
              <Label>Income category</Label>
              <Select value={incomeCategory} onValueChange={setIncomeCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {incomeCategories.map((category) => (
                    <SelectItem key={category.id} value={category.name}>{category.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div>
          <Label>CSV file</Label>
          <Input type="file" accept=".csv,text/csv" onChange={(event) => inspect(event.target.files?.[0] || null)} />
        </div>
        {preview && (
          <div className={`rounded-md border p-3 text-sm ${preview.errors.length ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/30'}`}>
            <div>{preview.rows} ready · ₹{preview.total.toLocaleString('en-IN')}</div>
            {preview.errors.length > 0 && (
              <div className="mt-2 space-y-1 text-destructive max-h-32 overflow-y-auto">
                {preview.errors.slice(0, 20).map((error) => <div key={error}>{error}</div>)}
                {preview.errors.length > 20 && <div>+{preview.errors.length - 20} more issues</div>}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Internal Settlement rows are intentionally blocked. Record those as transfers so they do not inflate operating income or expenses.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={importFile} disabled={saving || !file || !preview || preview.errors.length > 0}>
            {saving ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
