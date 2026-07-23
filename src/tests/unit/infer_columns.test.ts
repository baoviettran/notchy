import { describe, it, expect } from 'vitest';
import { inferColumns } from '$lib/utils/infer_columns';

describe('inferColumns', () => {
  it('infers date, amount, payee, notes from English headers', () => {
    const header = ['Date', 'Amount', 'Payee', 'Notes'];
    const sample = [['2024-01-01', '100', 'Store', 'Purchase']];
    const mapping = inferColumns(header, sample);

    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBe(1);
    expect(mapping.payee).toBe(2);
    expect(mapping.notes).toBe(3);
    expect(mapping.signConvention).toBe('signed');
    expect(mapping.dateFormat).toBe('YYYY-MM-DD');
  });

  it('infers from Vietnamese headers with DD/MM/YYYY dates', () => {
    const header = ['Ngày', 'Số tiền', 'Nội dung', 'Ghi chú'];
    const sample = [['01/01/2024', '100', 'Cửa hàng', 'Mua hàng']];
    const mapping = inferColumns(header, sample);

    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBe(1);
    expect(mapping.payee).toBe(2);
    expect(mapping.notes).toBe(3);
    expect(mapping.dateFormat).toBe('DD/MM/YYYY');
    expect(mapping.amountLocale).toBe('vi');
  });

  it('disambiguates MM/DD when a sample day exceeds 12', () => {
    const header = ['Date', 'Amount'];
    const sample = [['13/01/2024', '100']];
    const mapping = inferColumns(header, sample);
    expect(mapping.dateFormat).toBe('DD/MM/YYYY');
  });

  it('detects debit/credit separate columns', () => {
    const header = ['Date', 'Debit', 'Credit', 'Payee'];
    const sample = [['2024-01-01', '100', '', 'Store']];
    const mapping = inferColumns(header, sample);

    expect(mapping.debit).toBe(1);
    expect(mapping.credit).toBe(2);
    expect(mapping.signConvention).toBe('debit_credit_separate');
    expect(mapping.amount).toBeNull();
  });
});
