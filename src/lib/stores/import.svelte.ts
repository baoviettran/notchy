import { parseCsv } from '$lib/utils/csv_parse';
import { inferColumns, type InferredMapping } from '$lib/utils/infer_columns';
import { classifyRow, type RowStatus } from '$lib/utils/dedup';
import { parseCsvAmount } from '$lib/utils/parse_csv_amount';
import { FRACTION_DIGITS } from '$lib/utils/number_parse';
import * as txRepo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';
import type { Transaction } from '$lib/db/repos/transactions';

type Phase = 'select' | 'mapping' | 'preview' | 'done';

export interface ImportRow {
  raw: string[];
  date?: string;
  amount?: number;
  kind?: 'expense' | 'income';
  payee?: string;
  notes?: string;
  status: RowStatus;
  duplicateOfId?: string;
  included: boolean;
  error?: string;
}

export class ImportStore {
  phase = $state<Phase>('select');
  rows = $state<ImportRow[]>([]);
  mapping = $state<InferredMapping>({
    date: null, amount: null, payee: null, notes: null,
    debit: null, credit: null, signConvention: 'signed',
    dateFormat: null, amountLocale: 'en'
  });
  accountId = $state<string>('');

  private db: DatabaseService;
  private currency: string;
  private existingTx: Transaction[] = [];

  constructor(db: DatabaseService, currency: string = 'VND') {
    this.db = db;
    this.currency = currency;
  }

  get newCount(): number { return this.rows.filter(r => r.status === 'new').length; }
  get duplicateCount(): number { return this.rows.filter(r => r.status === 'duplicate').length; }
  get invalidCount(): number { return this.rows.filter(r => r.status === 'invalid').length; }
  get includedCount(): number { return this.rows.filter(r => r.included && r.status !== 'invalid').length; }

  async loadFile(csvText: string, accountId: string): Promise<void> {
    this.accountId = accountId;
    const parsed = parseCsv(csvText);
    const header = parsed.rows[0];
    const dataRows = parsed.rows.slice(1);

    this.mapping = inferColumns(header, dataRows.slice(0, 20));
    this.rows = dataRows.map(raw => ({ raw, status: 'new' as RowStatus, included: true }));

    await this.loadExistingTransactions();
    this.classifyAllRows();
    this.phase = 'mapping';
  }

  reclassify(): void {
    this.classifyAllRows();
  }

  private async loadExistingTransactions(): Promise<void> {
    const dates = this.rows
      .map(r => this.extractDate(r))
      .filter((d): d is string => d !== undefined);
    if (dates.length === 0) return;

    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));

    this.existingTx = await txRepo.listTransactions(this.db, {
      account_id: this.accountId,
      date_from: minDate,
      date_to: maxDate
    });
  }

  private classifyAllRows(): void {
    const seen: { id: string; accountId: string; date: string; amount: number; kind: string }[] =
      this.existingTx.map(tx => ({
        id: tx.id, accountId: tx.account_id, date: tx.date, amount: tx.amount, kind: tx.kind
      }));

    for (const row of this.rows) {
      const date = this.extractDate(row);
      const { amount, kind } = this.extractAmountAndKind(row);

      if (!date || amount === undefined || !kind || amount <= 0) {
        row.status = 'invalid';
        row.error = !date ? 'missing_date' : (amount === undefined || amount <= 0 ? 'invalid_amount' : 'missing_kind');
        row.included = false;
        row.date = date;
        row.amount = amount;
        row.kind = kind;
        row.payee = this.extractPayee(row);
        row.notes = this.extractNotes(row);
        continue;
      }

      const result = classifyRow({ accountId: this.accountId, date, amount, kind }, seen);
      row.status = result.status;
      row.duplicateOfId = result.duplicateOfId;
      row.error = result.error;
      row.date = date;
      row.amount = amount;
      row.kind = kind;
      row.payee = this.extractPayee(row);
      row.notes = this.extractNotes(row);
      row.included = result.status === 'new';

      if (result.status === 'new') {
        seen.push({ id: `pending:${this.rows.indexOf(row)}`, accountId: this.accountId, date, amount, kind });
      }
    }
  }

  private extractDate(row: ImportRow): string | undefined {
    if (this.mapping.date === null) return undefined;
    const raw = (row.raw[this.mapping.date] ?? '').trim();
    if (!raw) return undefined;
    if (this.mapping.dateFormat === 'YYYY-MM-DD') {
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    }
    if (this.mapping.dateFormat === 'DD/MM/YYYY') {
      const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return undefined;
      return `${m[3]}-${m[2]}-${m[1]}`;
    }
    if (this.mapping.dateFormat === 'MM/DD/YYYY') {
      const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return undefined;
      return `${m[3]}-${m[1]}-${m[2]}`;
    }
    return undefined;
  }

  private extractAmountAndKind(row: ImportRow): { amount: number | undefined; kind: 'expense' | 'income' | undefined } {
    const locale = this.mapping.amountLocale;

    if (this.mapping.signConvention === 'signed' && this.mapping.amount !== null) {
      const raw = (row.raw[this.mapping.amount] ?? '').trim();
      if (raw === '') return { amount: undefined, kind: undefined };
      const parsed = parseCsvAmount(raw, locale);
      if (parsed === null) return { amount: undefined, kind: undefined };
      return {
        amount: this.toSmallestUnit(parsed),
        kind: parsed < 0 ? 'expense' : 'income'
      };
    }

    if (this.mapping.signConvention === 'debit_credit_separate') {
      const debitRaw = this.mapping.debit !== null ? (row.raw[this.mapping.debit] ?? '').trim() : '';
      const creditRaw = this.mapping.credit !== null ? (row.raw[this.mapping.credit] ?? '').trim() : '';
      const d = debitRaw ? parseCsvAmount(debitRaw, locale) : 0;
      const c = creditRaw ? parseCsvAmount(creditRaw, locale) : 0;
      if (d === null || c === null) return { amount: undefined, kind: undefined };
      return {
        amount: this.toSmallestUnit(Math.abs(c - d)),
        kind: c > d ? 'income' : 'expense'
      };
    }

    return { amount: undefined, kind: undefined };
  }

  private toSmallestUnit(floatAmount: number): number {
    const digits = FRACTION_DIGITS[this.currency] ?? 0;
    return Math.round(Math.abs(floatAmount) * Math.pow(10, digits));
  }

  private extractPayee(row: ImportRow): string | undefined {
    if (this.mapping.payee === null) return undefined;
    const v = (row.raw[this.mapping.payee] ?? '').trim();
    return v === '' ? undefined : v;
  }

  private extractNotes(row: ImportRow): string | undefined {
    if (this.mapping.notes === null) return undefined;
    const v = (row.raw[this.mapping.notes] ?? '').trim();
    return v === '' ? undefined : v;
  }

  goToPreview(): void {
    this.phase = 'preview';
  }

  backToMapping(): void {
    this.phase = 'mapping';
  }

  async commit(): Promise<number> {
    const toInsert = this.rows.filter(r => r.included && r.status !== 'invalid');
    if (toInsert.length === 0) {
      this.phase = 'done';
      return 0;
    }

    const inputs = toInsert.map(r => ({
      kind: r.kind!,
      date: r.date!,
      amount: r.amount!,
      account_id: this.accountId,
      payee: r.payee,
      description: r.notes,
      tag_id: null
    }));

    await txRepo.createTransactions(this.db, inputs);
    this.phase = 'done';
    return toInsert.length;
  }

  reset(): void {
    this.phase = 'select';
    this.rows = [];
    this.accountId = '';
    this.existingTx = [];
  }
}
