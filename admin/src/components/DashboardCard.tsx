import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SummaryCard, CustomQuestion, QuestionSummary } from '@/lib/types';

interface Props { summary: SummaryCard }

export default function DashboardCard({ summary }: Props) {
  const { event, totals, guild_member_count, capacity_used, custom_question_summary } = summary;
  const fillPct = event.capacity > 0 ? Math.min(100, Math.round((capacity_used / event.capacity) * 100)) : 0;
  const questions: CustomQuestion[] = (event.custom_questions || []) as CustomQuestion[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{event.name}</span>
          <span className="text-sm font-normal text-muted-foreground">{new Date(event.date).toLocaleString()}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">{event.venue_name || ''}</div>
        <div className="flex gap-4 text-sm">
          <span><strong>{totals.confirmed}</strong> confirmed</span>
          <span><strong>{totals.pending}</strong> pending</span>
          <span><strong>{totals.cancelled}</strong> cancelled</span>
          <span><strong>{guild_member_count}</strong> guild</span>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{capacity_used} / {event.capacity} seats</div>
          <div className="h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        {questions.length > 0 && (
          <div className="space-y-2">
            {questions.map((q) => {
              const s = custom_question_summary[q.id];
              if (!s) return null;
              return <QuestionSummaryRow key={q.id} question={q} summary={s} />;
            })}
          </div>
        )}
        <div className="pt-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/registrations?event=${event.id}`}>View registrations</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionSummaryRow({ question, summary }: { question: CustomQuestion; summary: QuestionSummary }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="text-sm border-t pt-2">
      <div className="font-medium">{question.label}</div>
      {summary.type === 'select' || summary.type === 'radio' ? (
        <ul className="text-xs text-muted-foreground pl-2">
          {Object.entries(summary.counts).map(([opt, n]) => <li key={opt}>{opt}: {n}</li>)}
        </ul>
      ) : summary.type === 'checkbox' ? (
        <div className="text-xs text-muted-foreground">Yes: {summary.yes} · No: {summary.no}</div>
      ) : summary.type === 'text' ? (
        <div className="text-xs text-muted-foreground">
          <button onClick={() => setExpanded((x) => !x)} className="flex items-center gap-1 hover:underline">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {summary.count} answer{summary.count === 1 ? '' : 's'}
          </button>
          {expanded && (
            <ul className="pl-3 mt-1 space-y-0.5">
              {summary.answers.map((a, i) => <li key={i}>· {a}</li>)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
