import { describe, expect, it } from 'vitest';
import {
  type FinanceTransactionInput,
  validateFinanceTransaction,
} from './finance';

function valid(overrides: Partial<FinanceTransactionInput> = {}): FinanceTransactionInput {
  return {
    transaction_type: 'income',
    occurred_on: '2026-07-28',
    amount: 500,
    title: 'Event payment',
    category_id: 'category-1',
    from_account_id: null,
    to_account_id: 'account-1',
    payment_method: 'upi',
    ...overrides,
  };
}

describe('validateFinanceTransaction', () => {
  it('accepts a complete income', () => {
    expect(validateFinanceTransaction(valid(), true)).toBeNull();
  });

  it('requires a receiving account and category for income', () => {
    expect(validateFinanceTransaction(valid({ to_account_id: null }), true)).toContain('Received-in');
    expect(validateFinanceTransaction(valid({ category_id: null }), true)).toContain('Category');
  });

  it('requires a paying account and category for an expense', () => {
    const expense = valid({
      transaction_type: 'expense',
      from_account_id: null,
      to_account_id: null,
    });
    expect(validateFinanceTransaction(expense, true)).toContain('Paid-from');
    expect(validateFinanceTransaction({ ...expense, from_account_id: 'account-1', category_id: null }, true))
      .toContain('Category');
  });

  it('requires distinct accounts and no category for transfers', () => {
    const transfer = valid({
      transaction_type: 'transfer',
      from_account_id: 'account-1',
      to_account_id: 'account-1',
      category_id: null,
    });
    expect(validateFinanceTransaction(transfer, true)).toContain('different');
    expect(validateFinanceTransaction({
      ...transfer,
      to_account_id: 'account-2',
      category_id: 'category-1',
    }, true)).toContain('do not use');
  });

  it('requires positive whole-rupee amounts', () => {
    expect(validateFinanceTransaction(valid({ amount: 0 }), true)).toContain('greater than zero');
    expect(validateFinanceTransaction(valid({ amount: 12.5 }), true)).toContain('whole number');
  });

  it('rejects impossible dates and unsupported payment methods', () => {
    expect(validateFinanceTransaction(valid({ occurred_on: '2026-02-31' }), true)).toContain('valid');
    expect(validateFinanceTransaction(valid({ payment_method: 'cheque' as never }), true)).toContain('Payment method');
  });

  it('validates only fields present in a partial update', () => {
    expect(validateFinanceTransaction({ title: 'Updated title' }, false)).toBeNull();
    expect(validateFinanceTransaction({ amount: -1 }, false)).toContain('greater than zero');
  });
});
