import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import type { CustomQuestion, CustomQuestionOption } from '@/lib/types';

const TYPE_LABELS: Record<CustomQuestion['type'], string> = {
  text: 'Short text',
  checkbox: 'Yes/no',
  select: 'Pick one (dropdown)',
  radio: 'Pick one (radio)',
};

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

interface Props {
  value: CustomQuestion[];
  onChange: (next: CustomQuestion[]) => void;
  hasRegistrations?: boolean;
}

export default function CustomQuestionsEditor({ value, onChange, hasRegistrations }: Props) {
  function update(idx: number, patch: Partial<CustomQuestion>) {
    const next = value.map((q, i) => (i === idx ? { ...q, ...patch } : q));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function addQuestion() {
    const taken = new Set(value.map((q) => q.id));
    const id = uniqueId(`question-${value.length + 1}`, taken);
    onChange([...value, { id, label: '', type: 'text', required: false }]);
  }

  return (
    <div className="space-y-3">
      {hasRegistrations && value.length > 0 && (
        <div className="text-xs rounded-md bg-amber-50 text-amber-900 p-2">
          This event already has registrations. Renaming options can break stored answers — change with care.
        </div>
      )}
      {value.map((q, idx) => (
        <div key={idx} className="rounded-md border p-3 space-y-2 bg-muted/20">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Question</Label>
              <Input value={q.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="What do you want to ask?" />
            </div>
            <div className="w-44">
              <Label className="text-xs">Answer type</Label>
              <Select value={q.type} onValueChange={(t) => {
                const next: Partial<CustomQuestion> = { type: t as CustomQuestion['type'] };
                if ((t === 'select' || t === 'radio') && !q.options) next.options = [];
                if (t !== 'select' && t !== 'radio') next.options = undefined;
                update(idx, next);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['text','checkbox','select','radio'] as const).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={q.required} onCheckedChange={(c) => update(idx, { required: c })} />
              <Label className="text-xs">Required</Label>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(idx)} aria-label="Remove question">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {(q.type === 'select' || q.type === 'radio') && (
            <OptionsEditor
              options={q.options || []}
              onChange={(opts) => update(idx, { options: opts })}
            />
          )}
        </div>
      ))}
      <Button variant="outline" onClick={addQuestion}>
        <Plus className="h-4 w-4 mr-1" /> Add question
      </Button>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: CustomQuestionOption[]; onChange: (next: CustomQuestionOption[]) => void }) {
  function update(idx: number, patch: Partial<CustomQuestionOption>) {
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }
  return (
    <div className="pl-2 space-y-2">
      <Label className="text-xs">Options</Label>
      {options.map((o, idx) => (
        <div key={idx} className="flex gap-2">
          <Input value={o.value} placeholder="Option label" onChange={(e) => update(idx, { value: e.target.value })} />
          <Input
            type="number"
            placeholder="Capacity (optional)"
            className="w-40"
            value={o.capacity ?? ''}
            onChange={(e) => update(idx, { capacity: e.target.value ? Number(e.target.value) : undefined })}
          />
          <Button variant="ghost" size="icon" onClick={() => remove(idx)} aria-label="Remove option">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...options, { value: '' }])}>
        <Plus className="h-4 w-4 mr-1" /> Add option
      </Button>
    </div>
  );
}
