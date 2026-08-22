import { describe, expect, it } from 'vitest';
import { effectiveSeatPrice, applyReplayPassSeat, type PricingQuestion } from './pricing';

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

describe('applyReplayPassSeat', () => {
  const held = { hasPass: true, existingSeatsForEvent: 0 };

  it('covers the only seat for a pass holder', () => {
    expect(applyReplayPassSeat([500], held)).toEqual({ seatCosts: [0], seatCovered: true });
  });

  it('covers exactly one seat, leaving companions to pay', () => {
    expect(applyReplayPassSeat([500, 500, 500], held)).toEqual({ seatCosts: [0, 500, 500], seatCovered: true });
  });

  it('covers the most expensive seat', () => {
    expect(applyReplayPassSeat([400, 900, 400], held)).toEqual({ seatCosts: [400, 0, 400], seatCovered: true });
  });

  it('does nothing without a pass', () => {
    const costs = [500, 500];
    expect(applyReplayPassSeat(costs, { hasPass: false, existingSeatsForEvent: 0 })).toEqual({
      seatCosts: costs, seatCovered: false,
    });
  });

  it('does nothing once the holder already has a seat for this event', () => {
    expect(applyReplayPassSeat([500], { hasPass: true, existingSeatsForEvent: 1 })).toEqual({
      seatCosts: [500], seatCovered: false,
    });
  });

  it('does not stack on a Guild Path seat that is already free', () => {
    expect(applyReplayPassSeat([0, 500], held)).toEqual({ seatCosts: [0, 500], seatCovered: false });
  });

  it('leaves an all-free booking alone', () => {
    expect(applyReplayPassSeat([0, 0], held)).toEqual({ seatCosts: [0, 0], seatCovered: false });
  });

  it('handles an empty seat list', () => {
    expect(applyReplayPassSeat([], held)).toEqual({ seatCosts: [], seatCovered: false });
  });

  it('does not mutate the input array', () => {
    const costs = [500, 500];
    applyReplayPassSeat(costs, held);
    expect(costs).toEqual([500, 500]);
  });
});
