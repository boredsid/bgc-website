import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileCardList, { CardField } from './MobileCardList';

interface Row { id: string; name: string; phone: string }
const rows: Row[] = [
  { id: '1', name: 'Alice', phone: '+91 98765 43210' },
  { id: '2', name: 'Bob', phone: '+91 98765 43211' },
];

describe('MobileCardList', () => {
  const fields: CardField<Row>[] = [
    { key: 'name', label: 'Name', render: (r) => r.name, primary: true },
    { key: 'phone', label: 'Phone', render: (r) => r.phone },
  ];

  it('renders one card per row, primary field prominent', () => {
    render(<MobileCardList rows={rows} fields={fields} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('shows the empty message when rows is empty', () => {
    render(<MobileCardList rows={[]} fields={fields} rowKey={(r) => r.id} emptyMessage="None yet" />);
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });

  it('calls onRowClick when a card is tapped', () => {
    const onRowClick = vi.fn();
    render(<MobileCardList rows={rows} fields={fields} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
