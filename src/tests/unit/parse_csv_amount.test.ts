import { describe, it, expect } from 'vitest';
import { parseCsvAmount } from '$lib/utils/parse_csv_amount';

describe('parseCsvAmount', () => {
  it('parses US format with comma thousands and dot decimal', () => {
    expect(parseCsvAmount('1,234.56', 'en')).toBe(1234.56);
  });

  it('parses EU format with dot thousands and comma decimal', () => {
    expect(parseCsvAmount('1.234,56', 'vi')).toBe(1234.56);
  });

  it('parses plain integer with no separators', () => {
    expect(parseCsvAmount('100', 'en')).toBe(100);
    expect(parseCsvAmount('100', 'vi')).toBe(100);
  });

  it('returns null for unparseable text', () => {
    expect(parseCsvAmount('abc', 'en')).toBeNull();
    expect(parseCsvAmount('', 'en')).toBeNull();
  });

  it('parses negative amounts', () => {
    expect(parseCsvAmount('-1,234.56', 'en')).toBe(-1234.56);
    expect(parseCsvAmount('-1.234,56', 'vi')).toBe(-1234.56);
  });

  it('strips currency symbols and spaces', () => {
    expect(parseCsvAmount('$1,234.56', 'en')).toBe(1234.56);
    expect(parseCsvAmount('1.234,56 ₫', 'vi')).toBe(1234.56);
  });
});
