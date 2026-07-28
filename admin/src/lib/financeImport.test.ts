import { describe, expect, it } from 'vitest';
import { parseCsv, prepareSheetImport } from './financeImport';

describe('parseCsv', () => {
  it('preserves commas and escaped quotes inside quoted cells', () => {
    expect(parseCsv('Title,Amount\n"Venue, snacks","₹1,200"\n"He said ""hi""",500'))
      .toEqual([
        ['Title', 'Amount'],
        ['Venue, snacks', '₹1,200'],
        ['He said "hi"', '500'],
      ]);
  });
});

describe('prepareSheetImport', () => {
  it('prepares income rows with the displayed US date and rupee amount', () => {
    const result = prepareSheetImport(
      'Title,Date,Payee,Amount\n"Games Night","4/28/2024","Siddhant Narula","₹1,25,000"',
      'income',
      'Event registrations',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([expect.objectContaining({
      transaction_type: 'income',
      occurred_on: '2024-04-28',
      amount: 125000,
      account_name: 'Siddhant Narula',
      category_name: 'Event registrations',
    })]);
  });

  it('normalizes the historical Miscellanous spelling', () => {
    const result = prepareSheetImport(
      'Title,Date,Payor,Amount,Category\nTape,2026-07-01,Amrit Kochar,200,Miscellanous',
      'expense',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0].category_name).toBe('Miscellaneous');
  });

  it('rejects internal settlements as operating expenses', () => {
    const result = prepareSheetImport(
      'Title,Date,Payor,Amount,Category\nSettlement,2026-07-01,Amrit Kochar,200,Internal Settlement',
      'expense',
    );

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('transfers');
  });

  it('rejects settlement counterpart rows from the Income tab', () => {
    const result = prepareSheetImport(
      'Title,Date,Payee,Amount\nInternal Settlement from Amrit,2026-07-01,Siddhant Narula,200',
      'income',
      'Other income',
    );

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('transfers');
  });

  it('rejects impossible dates and non-positive amounts', () => {
    const result = prepareSheetImport(
      'Title,Date,Payor,Amount,Category\nInvalid,2026-02-31,Amrit Kochar,0,Venue',
      'expense',
    );

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('check');
  });
});
