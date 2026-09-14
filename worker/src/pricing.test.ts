import { describe, expect, it } from 'vitest';
import { effectiveSeatPrice, applyReplayPassSeats, countPaidSeats, type PricingQuestion } from './pricing';

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

describe('countPaidSeats', () => {
  it('counts only the seats still being paid for', () => {
    expect(countPaidSeats([500, 0, 400])).toBe(2);
    expect(countPaidSeats([0, 0])).toBe(0);
    expect(countPaidSeats([])).toBe(0);
  });
});

describe('applyReplayPassSeats', () => {
  it('covers the only seat for a single pass holder', () => {
    expect(applyReplayPassSeats([500], 1)).toEqual({ seatCosts: [0], seatsCovered: 1 });
  });

  it('covers one seat per pass, leaving the rest to pay', () => {
    expect(applyReplayPassSeats([500, 500, 500], 1)).toEqual({ seatCosts: [0, 500, 500], seatsCovered: 1 });
  });

  it('covers a seat for every pass the booking claimed', () => {
    expect(applyReplayPassSeats([500, 500, 500], 2)).toEqual({ seatCosts: [0, 0, 500], seatsCovered: 2 });
  });

  it('covers the most expensive seats first', () => {
    expect(applyReplayPassSeats([400, 900, 700], 2)).toEqual({ seatCosts: [400, 0, 0], seatsCovered: 2 });
  });

  it('does nothing without a pass', () => {
    const costs = [500, 500];
    expect(applyReplayPassSeats(costs, 0)).toEqual({ seatCosts: costs, seatsCovered: 0 });
  });

  it('skips seats the Guild Path already made free', () => {
    expect(applyReplayPassSeats([0, 500], 1)).toEqual({ seatCosts: [0, 0], seatsCovered: 1 });
  });

  it('leaves an all-free booking alone', () => {
    expect(applyReplayPassSeats([0, 0], 1)).toEqual({ seatCosts: [0, 0], seatsCovered: 0 });
  });

  it('covers no more seats than are actually being paid for', () => {
    expect(applyReplayPassSeats([500], 3)).toEqual({ seatCosts: [0], seatsCovered: 1 });
  });

  it('handles an empty seat list', () => {
    expect(applyReplayPassSeats([], 2)).toEqual({ seatCosts: [], seatsCovered: 0 });
  });

  it('does not mutate the input array', () => {
    const costs = [500, 500];
    applyReplayPassSeats(costs, 2);
    expect(costs).toEqual([500, 500]);
  });
});
