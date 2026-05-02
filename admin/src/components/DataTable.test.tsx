import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DataTable, { Column } from './DataTable';

interface Row { id: string; name: string; n: number }

const rows: Row[] = [
  { id: '1', name: 'Charlie', n: 3 },
  { id: '2', name: 'Alice', n: 1 },
  { id: '3', name: 'Bob', n: 2 },
];

describe('DataTable sorting', () => {
  it('sorts ascending on first click of a sortable header', () => {
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Name', render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
      { key: 'n', header: 'N', render: (r) => String(r.n) },
    ];
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    const cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(cells).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('toggles to descending on second click', () => {
    const cols: Column<Row>[] = [
      { key: 'n', header: 'N', render: (r) => String(r.n), sortable: true, sortValue: (r) => r.n },
    ];
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /n/i }));
    fireEvent.click(screen.getByRole('button', { name: /n/i }));
    const cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(cells).toEqual(['3', '2', '1']);
  });
});

describe('DataTable selection', () => {
  it('toggles a single row when its checkbox is clicked', () => {
    const cols: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];
    let selected: string[] = [];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={(ids) => { selected = ids; }}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // [0] is the header "select all", [1..3] are row checkboxes.
    fireEvent.click(checkboxes[2]);
    expect(selected).toEqual(['2']);
  });

  it('selects all rows when the header checkbox is clicked', () => {
    const cols: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];
    let selected: string[] = [];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={(ids) => { selected = ids; }}
      />,
    );
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(selected).toEqual(['1', '2', '3']);
  });
});
