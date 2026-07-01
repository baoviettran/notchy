import { parseAmount } from './number_parse';
import type { Locale } from './number_parse';
import { stripControlChars } from './sanitize';
import { AppError } from '$lib/errors';

export interface QuickInput {
  kind: 'expense' | 'income';
  amount: number;
  payee: string | null;
}

/**
 * Parse a single quick-capture line.
 *
 * Grammar:  [+] <amount>[suffix] <payee…>
 *
 * The tokenizer does NOT expand k/m/tr — parseAmount owns suffix expansion
 * (number_parse.ts:28-34). We only consume the leading '+' (income) and split
 * the numeric token from the payee remainder.
 */
export function parseQuickInput(
  input: string,
  locale: Locale,
  currency: string = 'VND'
): QuickInput {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new AppError('invalid_amount');
  }

  const isIncome = trimmed.startsWith('+');
  const kind: 'expense' | 'income' = isIncome ? 'income' : 'expense';
  const body = isIncome ? trimmed.slice(1).trimStart() : trimmed;

  // Split on first whitespace: numeric token | payee remainder.
  const sp = body.search(/\s/);
  const numericToken = sp === -1 ? body : body.slice(0, sp);
  const payeeRaw = sp === -1 ? '' : body.slice(sp).trim();

  // parseAmount throws AppError('invalid_amount') if the token has no digits.
  const amount = parseAmount(numericToken, locale, currency);

  const payee = payeeRaw === '' ? null : stripControlChars(payeeRaw).trim();
  return { kind, amount, payee };
}
