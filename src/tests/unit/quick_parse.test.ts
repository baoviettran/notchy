import { describe, it, expect } from 'vitest';
import { parseQuickInput } from '$lib/utils/quick_parse';
import { AppError } from '$lib/errors';

describe('parseQuickInput', () => {
  it('parses expense with k suffix and payee', () => {
    const r = parseQuickInput('50k coffee', 'vi');
    expect(r).toEqual({ kind: 'expense', amount: 50000, payee: 'coffee' });
  });

  it('parses m suffix under en', () => {
    const r = parseQuickInput('1.2m rent', 'en');
    expect(r).toEqual({ kind: 'expense', amount: 1200000, payee: 'rent' });
  });

  it('parses tr suffix under vi with Vietnamese payee diacritics', () => {
    const r = parseQuickInput('1.5tr lương', 'vi');
    expect(r).toEqual({ kind: 'expense', amount: 1500000, payee: 'lương' });
  });

  it('leading + means income', () => {
    const r = parseQuickInput('+50k salary', 'vi');
    expect(r).toEqual({ kind: 'income', amount: 50000, payee: 'salary' });
  });

  it('bare amount with no payee yields null payee', () => {
    const r = parseQuickInput('50k', 'vi');
    expect(r).toEqual({ kind: 'expense', amount: 50000, payee: null });
  });

  it('preserves multi-word payee', () => {
    const r = parseQuickInput('30k ca phe trung nguyen', 'vi');
    expect(r).toEqual({ kind: 'expense', amount: 30000, payee: 'ca phe trung nguyen' });
  });

  it('throws on missing amount', () => {
    expect(() => parseQuickInput('just a payee', 'vi')).toThrow(AppError);
  });

  it('throws on empty input', () => {
    expect(() => parseQuickInput('   ', 'vi')).toThrow(AppError);
  });

  it('throws when amount token is non-numeric (delegates to parseAmount)', () => {
    expect(() => parseQuickInput('coffee 50k', 'vi')).toThrow(AppError);
  });

  it('income with no payee yields null payee', () => {
    const r = parseQuickInput('+50k', 'vi');
    expect(r).toEqual({ kind: 'income', amount: 50000, payee: null });
  });

  it('throws on lone plus (empty body reaches parseAmount)', () => {
    expect(() => parseQuickInput('+', 'vi')).toThrow(AppError);
  });

  it('respects currency param for parsing', () => {
    // USD expands k/m but scales to cents (×100) via parseAmount's FRACTION_DIGITS
    const r = parseQuickInput('5k snack', 'en', 'USD');
    expect(r.amount).toBe(500000); // 5 * 1000 (k) * 100 (cents) = 500,000
  });
});
