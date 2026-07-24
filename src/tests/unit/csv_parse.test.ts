import { describe, it, expect } from 'vitest';
import { parseCsv } from '$lib/utils/csv_parse';

describe('parseCsv', () => {
  it('parses simple comma-delimited CSV with header', () => {
    const csv = 'date,amount,payee\n2024-01-01,100,Store';
    const result = parseCsv(csv);
    expect(result.rows).toEqual([
      ['date', 'amount', 'payee'],
      ['2024-01-01', '100', 'Store']
    ]);
    expect(result.delimiter).toBe(',');
  });

  it('handles quoted fields with embedded delimiters', () => {
    const csv = 'date,payee,amount\n2024-01-01,"Store, Inc.",100';
    const result = parseCsv(csv);
    expect(result.rows[1]).toEqual(['2024-01-01', 'Store, Inc.', '100']);
  });

  it('handles embedded newlines inside quoted fields', () => {
    const csv = 'payee,amount\n"Line 1\nLine 2",100';
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual(['Line 1\nLine 2', '100']);
  });

  it('auto-detects semicolon delimiter', () => {
    const csv = 'date;amount;payee\n2024-01-01;100;Store';
    const result = parseCsv(csv);
    expect(result.rows).toEqual([
      ['date', 'amount', 'payee'],
      ['2024-01-01', '100', 'Store']
    ]);
    expect(result.delimiter).toBe(';');
  });

  it('auto-detects tab delimiter', () => {
    const csv = 'date\tamount\tpayee\n2024-01-01\t100\tStore';
    const result = parseCsv(csv);
    expect(result.delimiter).toBe('\t');
    expect(result.rows[1]).toEqual(['2024-01-01', '100', 'Store']);
  });

  it('handles escaped quotes (doubled)', () => {
    const csv = 'payee,amount\n"Store ""A""",100';
    const result = parseCsv(csv);
    expect(result.rows[1]).toEqual(['Store "A"', '100']);
  });

  it('strips UTF-8 BOM from start of file', () => {
    const csv = '﻿date,amount,payee\n2024-01-01,100,Store';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['date', 'amount', 'payee']);
    expect(result.rows[1]).toEqual(['2024-01-01', '100', 'Store']);
  });

  it('throws AppError on empty file', () => {
    expect(() => parseCsv('')).toThrow();
    expect(() => parseCsv('   \n  ')).toThrow();
  });
});
