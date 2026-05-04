import { describe, it, expect, beforeEach } from 'vitest';
import { listViews, saveView, deleteView } from './savedViews';

describe('savedViews', () => {
  beforeEach(() => localStorage.clear());

  it('saves and lists views', () => {
    saveView('regs', 'REPLAY pending', { event: 'e1', status: 'pending' });
    expect(listViews('regs')).toEqual([{ name: 'REPLAY pending', params: { event: 'e1', status: 'pending' } }]);
  });

  it('overwrites a view with the same name', () => {
    saveView('regs', 'A', { x: '1' });
    saveView('regs', 'A', { x: '2' });
    expect(listViews('regs')).toEqual([{ name: 'A', params: { x: '2' } }]);
  });

  it('deletes a view', () => {
    saveView('regs', 'A', {});
    saveView('regs', 'B', {});
    deleteView('regs', 'A');
    expect(listViews('regs').map((v) => v.name)).toEqual(['B']);
  });

  it('isolates pages', () => {
    saveView('regs', 'A', {});
    saveView('guild', 'A', {});
    expect(listViews('regs')).toHaveLength(1);
    expect(listViews('guild')).toHaveLength(1);
  });
});
