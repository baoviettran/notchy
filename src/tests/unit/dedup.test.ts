import { describe, it, expect } from 'vitest';
import { classifyRow } from '$lib/utils/dedup';

describe('classifyRow', () => {
  it('classifies row as new when no match', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' as const };
    const existing = [
      { id: 'tx1', accountId: 'acc1', date: '2024-01-02', amount: 200, kind: 'expense' }
    ];
    const result = classifyRow(candidate, existing);
    expect(result.status).toBe('new');
  });

  it('requires account, date, and amount to all match before classifying a duplicate', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' as const };
    const existingRows = [
      { id: 'different-account', accountId: 'acc2', date: '2024-01-01', amount: 100, kind: 'expense' },
      { id: 'different-date', accountId: 'acc1', date: '2024-01-02', amount: 100, kind: 'expense' },
      { id: 'different-amount', accountId: 'acc1', date: '2024-01-01', amount: 200, kind: 'expense' }
    ];

    for (const existing of existingRows) {
      expect(classifyRow(candidate, [existing])).toEqual({ status: 'new' });
    }
  });

  it('classifies row as duplicate when match found', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' as const };
    const existing = [
      { id: 'tx1', accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' }
    ];
    const result = classifyRow(candidate, existing);
    expect(result.status).toBe('duplicate');
    expect(result.duplicateOfId).toBe('tx1');
  });

  it('matches on amount magnitude regardless of kind', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'income' as const };
    const existing = [
      { id: 'tx1', accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' }
    ];
    const result = classifyRow(candidate, existing);
    expect(result.status).toBe('duplicate');
  });

  it('classifies as invalid when date missing', () => {
    const candidate = { accountId: 'acc1', date: '', amount: 100, kind: 'expense' as const };
    const result = classifyRow(candidate, []);
    expect(result.status).toBe('invalid');
    expect(result.error).toBe('missing_required_fields');
  });

  it('classifies as invalid when accountId missing', () => {
    const candidate = { accountId: '', date: '2024-01-01', amount: 100, kind: 'expense' as const };
    const result = classifyRow(candidate, []);
    expect(result.status).toBe('invalid');
    expect(result.error).toBe('missing_required_fields');
  });

  it('classifies as invalid when amount is zero', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 0, kind: 'expense' as const };
    const result = classifyRow(candidate, []);
    expect(result.status).toBe('invalid');
    expect(result.error).toBe('invalid_amount');
  });

  it('classifies as invalid when amount is negative', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: -100, kind: 'expense' as const };
    const result = classifyRow(candidate, []);
    expect(result.status).toBe('invalid');
    expect(result.error).toBe('invalid_amount');
  });

  it('classifies as invalid when amount is not finite', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: Infinity, kind: 'expense' as const };
    const result = classifyRow(candidate, []);
    expect(result.status).toBe('invalid');
    expect(result.error).toBe('invalid_amount');
  });

  it('matches against the first of multiple existing matches', () => {
    const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' as const };
    const existing = [
      { id: 'tx1', accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' },
      { id: 'tx2', accountId: 'acc1', date: '2024-01-01', amount: 100, kind: 'expense' }
    ];
    const result = classifyRow(candidate, existing);
    expect(result.status).toBe('duplicate');
    expect(result.duplicateOfId).toBe('tx1');
  });
});
