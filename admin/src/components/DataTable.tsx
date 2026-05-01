import { ReactNode } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export default function DataTable<T>({ rows, columns, rowKey, onRowClick, emptyMessage }: Props<T>) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{emptyMessage || 'Nothing to show.'}</div>;
  }
  return (
    <div className="rounded-md border bg-background overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : undefined}
            >
              {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.render(row)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
