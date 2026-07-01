import { describe, expect, it } from 'vitest';
import { effectiveSeatPrice, type PricingQuestion } from './pricing';

const tableQ: PricingQuestion = {
  id: 'table', label: 'Table', type: 'radio', required: true,
  options: [{ value: 'Standard' }, { value: 'VIP', price: 800 }, { value: 'Free', price: 0 }],
};
const mealQ: PricingQuestion = {
  id: 'meal', label: 'Meal', type: 'select', required: false,
  options: [{ value: 'None' }, { value: 'Dinner', price: 300 }],
};
const textQ: PricingQuestion = { id: 'note', label: 'Note', type: 'text', required: false };

describe('effectiveSeatPrice', () => {
  it('returns base price when no priced option is selected', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'Standard', meal: 'None' }, 500)).toBe(500);
  });
  it('returns base price when there are no option questions', () => {
    expect(effectiveSeatPrice([textQ], { note: 'hi' }, 500)).toBe(500);
  });
  it('uses a single priced option and ignores the base', () => {
    expect(effectiveSeatPrice([tableQ], { table: 'VIP' }, 500)).toBe(800);
  });
  it('sums priced options across questions', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'VIP', meal: 'Dinner' }, 500)).toBe(1100);
  });
  it('treats an explicit price of 0 as a priced selection', () => {
    expect(effectiveSeatPrice([tableQ], { table: 'Free' }, 500)).toBe(0);
  });
  it('only counts the priced answer when mixing priced and unpriced', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'Standard', meal: 'Dinner' }, 500)).toBe(300);
  });
  it('ignores questions with no matching answer', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { note: 'x' }, 500)).toBe(500);
  });
  it('ignores checkbox questions even when the option carries a price', () => {
    const checkboxQ: PricingQuestion = {
      id: 'addon', label: 'Add-on', type: 'checkbox', required: false,
      options: [{ value: 'Extras', price: 200 }],
    };
    expect(effectiveSeatPrice([checkboxQ], { addon: true }, 500)).toBe(500);
  });
});
