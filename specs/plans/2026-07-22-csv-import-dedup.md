# CSV Transaction Import Implementation Plan
**Serves:** STORY-006

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add CSV transaction import with editable column mapping, strict duplicate detection (DB + intra-file), and preview-then-commit flow.

**Architecture:** Four pure utils (csv_parse, infer_columns, dedup, parse_csv_amount) handle the riskiest logic with no DB/Svelte dependencies. An import store orchestrates parse→infer→dedup→preview→commit, including intra-file duplicate tracking. A modal provides the UI with editable mapping controls. Batch insert reuses existing transaction validation in one SAVEPOINT.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, TypeScript, Vitest, Playwright, SQLite, Paraglide JS i18n, Tailwind

## Global Constraints

- Node 22.22.3, pnpm 10.11.0
- Svelte 5 runes ($state, $derived, $effect, $props), not legacy stores
- Paraglide 1.11.8 pinned — flat underscore keys only (no dotted IDs)
- Amounts are always integers (smallest currency unit). No floats.
- IDs are ULIDs (custom implementation in src/lib/utils/id.ts)
- TDD discipline: Red-Green-Refactor. Write test first, watch it fail, implement minimum to pass.
- All finance calculation in repo layer (testable with DB-pattern). All parsing math in pure utils.
- Do not mock the database. Use createTestDb() for DB-dependent tests.
- i18n keys use `import_tx_*` prefix (distinct from existing `settings_backup_import_*`)
- Styling: Tailwind with design tokens (`text-ledger`, `bg-tape`, `border-line`, `text-dim`, `text-debit`, `text-phosphor`). Use existing primitives (`Modal.svelte`, `Button.svelte`, `Input.svelte`).
- Currency scaling: import store converts parsed float → smallest unit via `number_parse.ts` `FRACTION_DIGITS` (VND ×1, USD ×100).

---

## File Structure

**New files:**
- `src/lib/utils/csv_parse.ts` — Pure CSV parser (RFC-4180-ish, delimiter auto-detect)
- `src/lib/utils/infer_columns.ts` — Pure column inference (header heuristics, EN+Vi)
- `src/lib/utils/dedup.ts` — Pure dedup classifier (no DB)
- `src/lib/utils/parse_csv_amount.ts` — Pure CSV amount parser (locale-aware, handles US + EU formats)
- `src/lib/stores/import.svelte.ts` — Orchestration store (parse→infer→dedup→preview→commit, intra-file dedup)
- `src/lib/components/modals/ImportTransactionsModal.svelte` — UI modal with editable mapping
- `src/tests/unit/csv_parse.test.ts` — Pure unit tests for CSV parser
- `src/tests/unit/infer_columns.test.ts` — Pure unit tests for column inference
- `src/tests/unit/dedup.test.ts` — Pure unit tests for dedup classifier
- `src/tests/unit/parse_csv_amount.test.ts` — Pure unit tests for CSV amount parser
- `src/tests/unit/import.test.ts` — Store integration tests
- `src/tests/e2e/csv-import.spec.ts` — E2E test for full flow

**Modified files:**
- `src/lib/db/repos/transactions.ts` — Add `createTransactions(db, inputs[])` batch insert
- `src/tests/unit/transactions.test.ts` — Add batch insert tests
- `messages/en.json` — Add `import_tx_*` keys
- `messages/vi.json` — Add `import_tx_*` keys
- `src/routes/transactions/+page.svelte` — Add "Import CSV" trigger button + modal mount

---

### Task 1: CSV Parser (Pure Util)

**Files:**
- Create: `src/lib/utils/csv_parse.ts`
- Test: `src/tests/unit/csv_parse.test.ts`

**Interfaces:**
- Consumes: `AppError` from `$lib/errors`
- Produces: `parseCsv(text: string, opts?: CsvParseOptions): CsvParseResult`

- [x] **Step 1: Write failing test for basic CSV parsing**

```typescript
// src/tests/unit/csv_parse.test.ts
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
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/csv_parse.test.ts`
Expected: FAIL with "Cannot find module '$lib/utils/csv_parse'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/utils/csv_parse.ts
import { AppError } from '$lib/errors';

export interface CsvParseOptions {
  delimiter?: string;
}

export interface CsvParseResult {
  rows: string[][];
  delimiter: string;
}

export function parseCsv(text: string, opts?: CsvParseOptions): CsvParseResult {
  if (!text || text.trim() === '') {
    throw new AppError('import_csv_parse_failed', { reason: 'empty' });
  }

  const delimiter = opts?.delimiter ?? detectDelimiter(text);
  const rows = parseRows(text, delimiter);

  if (rows.length === 0) {
    throw new AppError('import_csv_parse_failed', { reason: 'empty' });
  }

  return { rows, delimiter };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split('\n')[0];
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length
  };
  const max = Math.max(counts[','], counts[';'], counts['\t']);
  if (max === 0) return ',';
  if (counts[','] === max) return ',';
  if (counts[';'] === max) return ';';
  return '\t';
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += char === '\r' ? 2 : 1;
      } else if (char === '\r') {
        // Lone CR — treat as line end
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Flush trailing field/row (file without trailing newline)
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/csv_parse.test.ts`
Expected: PASS

- [x] **Step 5: Write test for quoted fields with embedded delimiters and newlines**

```typescript
// Add to src/tests/unit/csv_parse.test.ts
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
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/csv_parse.test.ts`
Expected: PASS

- [x] **Step 7: Write test for semicolon and tab delimiters**

```typescript
// Add to src/tests/unit/csv_parse.test.ts
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
```

- [x] **Step 8: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/csv_parse.test.ts`
Expected: PASS

- [x] **Step 9: Write test for escaped quotes and empty file**

```typescript
// Add to src/tests/unit/csv_parse.test.ts
it('handles escaped quotes (doubled)', () => {
  const csv = 'payee,amount\n"Store ""A""",100';
  const result = parseCsv(csv);
  expect(result.rows[1]).toEqual(['Store "A"', '100']);
});

it('throws AppError on empty file', () => {
  expect(() => parseCsv('')).toThrow();
  expect(() => parseCsv('   \n  ')).toThrow();
});
```

- [x] **Step 10: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/csv_parse.test.ts`
Expected: PASS

- [x] **Step 11: Commit**

```bash
git add src/lib/utils/csv_parse.ts src/tests/unit/csv_parse.test.ts
git commit -m "feat(csv-import): add pure CSV parser with delimiter auto-detect"
```

---

### Task 2: CSV Amount Parser (Pure Util)

**Why this exists separate from `parseAmount`:** The existing `parseAmount` (`src/lib/utils/number_parse.ts`) does `input.replace(/[\s,]/g, '')` — it strips ALL commas and treats `.` as the decimal separator. So `1.234,56` (Vietnamese/European format) becomes `1.23456`, which is wrong. Bank CSVs use both conventions depending on locale. This pure parser handles both correctly based on the detected locale. (Per CLAUDE.md gotcha, `parseAmount` must stay pure and unchanged for manual entry; CSV import gets its own parser.)

**Files:**
- Create: `src/lib/utils/parse_csv_amount.ts`
- Test: `src/tests/unit/parse_csv_amount.test.ts`

**Interfaces:**
- Consumes: Nothing (pure)
- Produces: `parseCsvAmount(raw: string, locale: 'en' | 'vi'): number | null` (returns float; caller scales to smallest unit)

- [x] **Step 1: Write failing test for US and EU formats**

```typescript
// src/tests/unit/parse_csv_amount.test.ts
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
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/parse_csv_amount.test.ts`
Expected: FAIL with "Cannot find module '$lib/utils/parse_csv_amount'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/utils/parse_csv_amount.ts
export type AmountLocale = 'en' | 'vi';

/**
 * Parse a CSV amount cell into a float, locale-aware.
 *
 * Two conventions (per the import spec §"Sign convention"):
 * - 'en' (US): comma = thousands sep, dot = decimal. "1,234.56" → 1234.56
 * - 'vi' (EU): dot = thousands sep, comma = decimal. "1.234,56" → 1234.56
 *
 * Returns null for unparseable input (caller marks the row invalid).
 * Sign is preserved: "-1.234,56" → -1234.56.
 *
 * Caller scales the result to the smallest currency unit (VND ×1, USD ×100)
 * and rounds to an integer — mirroring parseAmount's scaling step.
 */
export function parseCsvAmount(raw: string, locale: AmountLocale): number | null {
  if (!raw) return null;

  let cleaned = raw.trim();
  if (cleaned === '') return null;

  // Capture sign before stripping
  let negative = false;
  if (cleaned.startsWith('-')) {
    negative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Strip currency symbols and spaces (e.g. "₫", "$", "VND", non-breaking spaces)
  cleaned = cleaned.replace(/[₫$VND\s ]/gi, '');

  if (cleaned === '') return null;

  if (locale === 'vi') {
    // EU: dot is thousands sep (remove), comma is decimal (→ dot)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // US: comma is thousands sep (remove), dot is decimal (keep)
    cleaned = cleaned.replace(/,/g, '');
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || !isFinite(parsed)) return null;

  return negative ? -parsed : parsed;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/parse_csv_amount.test.ts`
Expected: PASS

- [x] **Step 5: Write test for negative amounts and currency symbols**

```typescript
// Add to src/tests/unit/parse_csv_amount.test.ts
it('parses negative amounts', () => {
  expect(parseCsvAmount('-1,234.56', 'en')).toBe(-1234.56);
  expect(parseCsvAmount('-1.234,56', 'vi')).toBe(-1234.56);
});

it('strips currency symbols and spaces', () => {
  expect(parseCsvAmount('$1,234.56', 'en')).toBe(1234.56);
  expect(parseCsvAmount('1.234,56 ₫', 'vi')).toBe(1234.56);
});
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/parse_csv_amount.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/lib/utils/parse_csv_amount.ts src/tests/unit/parse_csv_amount.test.ts
git commit -m "feat(csv-import): add locale-aware CSV amount parser"
```

---

### Task 3: Column Inference (Pure Util)

**Files:**
- Create: `src/lib/utils/infer_columns.ts`
- Test: `src/tests/unit/infer_columns.test.ts`

**Interfaces:**
- Consumes: Nothing (pure)
- Produces: `inferColumns(header: string[] | null, sampleRows: string[][]): InferredMapping`

- [x] **Step 1: Write failing test for English header inference**

```typescript
// src/tests/unit/infer_columns.test.ts
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
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/infer_columns.test.ts`
Expected: FAIL with "Cannot find module '$lib/utils/infer_columns'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/utils/infer_columns.ts
export type SignConvention = 'signed' | 'debit_credit_separate';

export interface InferredMapping {
  date: number | null;
  amount: number | null;
  payee: number | null;
  notes: number | null;
  debit: number | null;
  credit: number | null;
  signConvention: SignConvention;
  dateFormat: string | null;   // 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
  amountLocale: 'en' | 'vi';   // inferred from date format; user-overrideable
}

export function inferColumns(header: string[] | null, sampleRows: string[][]): InferredMapping {
  const mapping: InferredMapping = {
    date: null,
    amount: null,
    payee: null,
    notes: null,
    debit: null,
    credit: null,
    signConvention: 'signed',
    dateFormat: null,
    amountLocale: 'en'
  };

  if (!header || header.length === 0) return mapping;

  const headerNorm = header.map(h => h.toLowerCase().trim().replace(/\s+/g, ' '));

  for (let i = 0; i < headerNorm.length; i++) {
    const h = headerNorm[i];
    if (mapping.date === null && isDateHeader(h)) {
      mapping.date = i;
    } else if (mapping.debit === null && isDebitHeader(h)) {
      mapping.debit = i;
    } else if (mapping.credit === null && isCreditHeader(h)) {
      mapping.credit = i;
    } else if (mapping.amount === null && isAmountHeader(h)) {
      mapping.amount = i;
    } else if (mapping.payee === null && isPayeeHeader(h)) {
      mapping.payee = i;
    } else if (mapping.notes === null && isNotesHeader(h)) {
      mapping.notes = i;
    }
  }

  // Separate debit/credit columns → that's the sign convention
  if (mapping.debit !== null && mapping.credit !== null) {
    mapping.signConvention = 'debit_credit_separate';
    mapping.amount = null;
  }

  // Infer date format + amount locale from a sample value
  if (mapping.date !== null && sampleRows.length > 0) {
    const dateSample = sampleRows[0][mapping.date];
    mapping.dateFormat = inferDateFormat(dateSample, sampleRows, mapping.date);
    mapping.amountLocale = mapping.dateFormat?.startsWith('DD') ? 'vi' : 'en';
  }

  return mapping;
}

function isDateHeader(h: string): boolean {
  return /^(date|ngày|trans(action)?\s*date|posting\s*date|time|value\s*date)$/.test(h);
}

function isAmountHeader(h: string): boolean {
  return /^(amount|số\s*tiền|transaction\s*amount|value)$/.test(h);
}

function isPayeeHeader(h: string): boolean {
  return /^(payee|description|memo|nội\s*dung|người\s*nhận|người\s*chuyển|detail|name|narration)$/.test(h);
}

function isNotesHeader(h: string): boolean {
  return /^(notes?|ghi\s*chú|remarks?|reference)$/.test(h);
}

function isDebitHeader(h: string): boolean {
  return /^(debit|withdrawal|rút\s*tiền|chi|tiền\s*ra)$/.test(h);
}

function isCreditHeader(h: string): boolean {
  return /^(credit|deposit|gửi|thu|tiền\s*vào)$/.test(h);
}

function inferDateFormat(sample: string, sampleRows: string[][], dateCol: number): string | null {
  if (!sample) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return 'YYYY-MM-DD';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(sample)) {
    // DD/MM vs MM/DD: scan all samples for a disambiguating value > 12
    for (const row of sampleRows) {
      const v = row[dateCol];
      if (!v || !/^\d{2}\/\d{2}\/\d{4}$/.test(v)) continue;
      const [a, b] = v.split('/').map(Number);
      if (a > 12) return 'DD/MM/YYYY';
      if (b > 12) return 'MM/DD/YYYY';
    }
    // Ambiguous — default to DD/MM/YYYY (Vietnamese/European common case)
    return 'DD/MM/YYYY';
  }
  return null;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/infer_columns.test.ts`
Expected: PASS

- [x] **Step 5: Write test for Vietnamese headers and EU date**

```typescript
// Add to src/tests/unit/infer_columns.test.ts
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
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/infer_columns.test.ts`
Expected: PASS

- [x] **Step 7: Write test for debit/credit separate columns**

```typescript
// Add to src/tests/unit/infer_columns.test.ts
it('detects debit/credit separate columns', () => {
  const header = ['Date', 'Debit', 'Credit', 'Payee'];
  const sample = [['2024-01-01', '100', '', 'Store']];
  const mapping = inferColumns(header, sample);

  expect(mapping.debit).toBe(1);
  expect(mapping.credit).toBe(2);
  expect(mapping.signConvention).toBe('debit_credit_separate');
  expect(mapping.amount).toBeNull();
});
```

- [x] **Step 8: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/infer_columns.test.ts`
Expected: PASS

- [x] **Step 9: Commit**

```bash
git add src/lib/utils/infer_columns.ts src/tests/unit/infer_columns.test.ts
git commit -m "feat(csv-import): add pure column inference with EN+Vi headers"
```

---

### Task 4: Dedup Classifier (Pure Util)

**Files:**
- Create: `src/lib/utils/dedup.ts`
- Test: `src/tests/unit/dedup.test.ts`

**Interfaces:**
- Consumes: Nothing (pure)
- Produces: `classifyRow(candidate, existing[]): ClassifyResult` — `existing` is the combined set of DB transactions AND already-classified pending rows from the same file (enables intra-file dedup).

- [x] **Step 1: Write failing test for new row**

```typescript
// src/tests/unit/dedup.test.ts
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
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/dedup.test.ts`
Expected: FAIL with "Cannot find module '$lib/utils/dedup'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/utils/dedup.ts
export type RowStatus = 'new' | 'duplicate' | 'invalid';

export interface ClassifyResult {
  status: RowStatus;
  duplicateOfId?: string;
  error?: string;
}

/**
 * Classify a single import row against existing transactions (DB rows +
 * already-classified pending rows from the same file).
 *
 * Match key is magnitude-only: (account_id, date, amount). Kind is NOT
 * compared — a bank that flips the sign on a re-export would otherwise slip
 * past a kind-aware check. Matching magnitude-only catches it.
 */
export function classifyRow(
  candidate: { accountId: string; date: string; amount: number; kind: 'expense' | 'income' },
  existing: { id: string; accountId: string; date: string; amount: number; kind: string }[]
): ClassifyResult {
  if (!candidate.date || !candidate.accountId) {
    return { status: 'invalid', error: 'missing_required_fields' };
  }
  if (candidate.amount <= 0 || !Number.isFinite(candidate.amount)) {
    return { status: 'invalid', error: 'invalid_amount' };
  }

  const match = existing.find(
    tx => tx.accountId === candidate.accountId &&
          tx.date === candidate.date &&
          tx.amount === candidate.amount
  );

  if (match) {
    return { status: 'duplicate', duplicateOfId: match.id };
  }
  return { status: 'new' };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/dedup.test.ts`
Expected: PASS

- [x] **Step 5: Write tests for duplicate, invalid, and magnitude-only matching**

```typescript
// Add to src/tests/unit/dedup.test.ts
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

it('classifies as invalid when amount is zero or negative', () => {
  const candidate = { accountId: 'acc1', date: '2024-01-01', amount: 0, kind: 'expense' as const };
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
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/dedup.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/lib/utils/dedup.ts src/tests/unit/dedup.test.ts
git commit -m "feat(csv-import): add pure dedup classifier with magnitude matching"
```

---

### Task 5: Batch Create in Transactions Repo

**Files:**
- Modify: `src/lib/db/repos/transactions.ts` (append `createTransactions` after `createTransaction` function, which ends at line 120)
- Test: `src/tests/unit/transactions.test.ts`

**Interfaces:**
- Consumes: `DatabaseService`, `NewTransaction`, `ulid`, `stripControlChars`, `AppError`
- Produces: `createTransactions(db: DatabaseService, inputs: NewTransaction[]): Promise<string[]>`

- [x] **Step 1: Write failing test for batch insert**

```typescript
// Add to src/tests/unit/transactions.test.ts (append a new describe block)
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';

describe('createTransactions (batch)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = createTestDb();
    await runMigrations(db, migrations);
    await db.execute(
      `INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
       VALUES ('acc1', 'Checking', 'checking', 'VND', datetime('now'), datetime('now'))`
    );
  });

  it('inserts multiple transactions atomically in one SAVEPOINT', async () => {
    const inputs = [
      { kind: 'expense' as const, date: '2024-01-01', amount: 100, account_id: 'acc1', payee: 'Store A' },
      { kind: 'income' as const, date: '2024-01-02', amount: 200, account_id: 'acc1', payee: 'Store B' }
    ];

    const ids = await repo.createTransactions(db, inputs);
    expect(ids).toHaveLength(2);

    const txs = await repo.listTransactions(db, { account_id: 'acc1' });
    expect(txs).toHaveLength(2);
    // listTransactions orders DESC by date — Store B (Jan 2) first
    expect(txs[0].payee).toBe('Store B');
    expect(txs[1].payee).toBe('Store A');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/transactions.test.ts`
Expected: FAIL with "repo.createTransactions is not a function"

- [x] **Step 3: Write minimal implementation**

Append to `src/lib/db/repos/transactions.ts` after the `createTransaction` function (after line 120):

```typescript
export async function createTransactions(db: DatabaseService, inputs: NewTransaction[]): Promise<string[]> {
  if (inputs.length === 0) return [];

  const now = new Date().toISOString();
  const ids: string[] = [];

  await db.transaction(async () => {
    for (const input of inputs) {
      // Import rows are only expense or income — reject other kinds defensively.
      if (input.kind !== 'expense' && input.kind !== 'income') {
        throw new AppError('import_invalid_kind', { kind: input.kind });
      }
      if (input.refund_of_id) throw new AppError('import_no_refunds');

      const description = input.description != null ? stripControlChars(input.description) : null;
      const id = ulid();

      await db.execute(
        `INSERT INTO transactions (id, kind, date, amount, account_id, refund_of_id, tag_id, payee, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.kind, input.date, input.amount, input.account_id,
         null, input.tag_id ?? null, input.payee ?? null, description, now, now]
      );

      ids.push(id);
    }
  });

  return ids;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/transactions.test.ts`
Expected: PASS

- [x] **Step 5: Write test for atomic rollback on constraint violation**

```typescript
// Add to src/tests/unit/transactions.test.ts in the createTransactions describe block
it('rolls back entire batch when one row violates a CHECK constraint', async () => {
  const inputs = [
    { kind: 'expense' as const, date: '2024-01-01', amount: 100, account_id: 'acc1', payee: 'Store A' },
    // amount <= 0 violates the DB CHECK(amount > 0) constraint
    { kind: 'expense' as const, date: '2024-01-02', amount: -50, account_id: 'acc1', payee: 'Store B' }
  ];

  await expect(repo.createTransactions(db, inputs)).rejects.toThrow();

  const txs = await repo.listTransactions(db, { account_id: 'acc1' });
  expect(txs).toHaveLength(0); // whole batch rolled back — nothing partial
});
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/transactions.test.ts`
Expected: PASS (SQLite CHECK constraint triggers SAVEPOINT rollback)

- [x] **Step 7: Write test that transfer inputs are rejected**

```typescript
// Add to src/tests/unit/transactions.test.ts
it('rejects transfer rows (import never produces transfers)', async () => {
  const inputs = [
    { kind: 'transfer' as const, date: '2024-01-01', amount: 100, account_id: 'acc1', transfer_account_id: 'acc2' }
  ];
  await expect(repo.createTransactions(db, inputs)).rejects.toThrow();
});
```

- [x] **Step 8: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/transactions.test.ts`
Expected: PASS

- [x] **Step 9: Commit**

```bash
git add src/lib/db/repos/transactions.ts src/tests/unit/transactions.test.ts
git commit -m "feat(csv-import): add batch createTransactions with atomic rollback"
```

---

### Task 6: Import Store (Orchestration with intra-file dedup)

**Files:**
- Create: `src/lib/stores/import.svelte.ts`
- Test: `src/tests/unit/import.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `inferColumns`, `classifyRow`, `parseCsvAmount`, `listTransactions`, `createTransactions`
- Produces: `ImportStore` class with `phase`, `rows`, `mapping` state; `loadFile`, `reclassify`, `goToPreview`, `commit` methods

- [x] **Step 1: Write failing test for phase transition after file load**

```typescript
// src/tests/unit/import.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ImportStore } from '$lib/stores/import.svelte';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as txRepo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';

describe('ImportStore', () => {
  let db: DatabaseService;
  let store: InstanceType<typeof ImportStore>;

  beforeEach(async () => {
    db = createTestDb();
    await runMigrations(db, migrations);
    await db.execute(
      `INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
       VALUES ('acc1', 'Checking', 'checking', 'VND', datetime('now'), datetime('now'))`
    );
    store = new ImportStore(db, 'VND');
  });

  it('starts in select phase', () => {
    expect(store.phase).toBe('select');
  });

  it('transitions to mapping after loadFile and infers columns', async () => {
    const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-02,200,Other';
    await store.loadFile(csv, 'acc1');
    expect(store.phase).toBe('mapping');
    expect(store.mapping.date).toBe(0);
    expect(store.mapping.amount).toBe(1);
    expect(store.mapping.payee).toBe(2);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: FAIL with "Cannot find module '$lib/stores/import.svelte'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/stores/import.svelte.ts
import { parseCsv } from '$lib/utils/csv_parse';
import { inferColumns, type InferredMapping } from '$lib/utils/infer_columns';
import { classifyRow, type RowStatus } from '$lib/utils/dedup';
import { parseCsvAmount, FRACTION_DIGITS } from '$lib/utils/number_parse';
import * as txRepo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';
import type { Transaction } from '$lib/db/repos/transactions';

type Phase = 'select' | 'mapping' | 'preview' | 'done';

export interface ImportRow {
  raw: string[];
  date?: string;
  amount?: number;          // smallest currency unit (integer)
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

  /** Re-run classification after the user edits the mapping. Called from $derived in the modal. */
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

    // No limit — personal finance accounts rarely exceed a few thousand transactions
    // in a date range, and truncating could miss duplicates.
    this.existingTx = await txRepo.listTransactions(this.db, {
      account_id: this.accountId,
      date_from: minDate,
      date_to: maxDate
    });
  }

  private classifyAllRows(): void {
    // Build the set classifyRow checks against. Start with DB rows (committed),
    // then add each newly-classified 'new' row as a pending candidate so a
    // later identical row in the SAME file matches it → intra-file dedup.
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
      row.included = result.status === 'new'; // dups default off, new default on

      // A 'new' row becomes a pending candidate for subsequent rows in this file.
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

  /**
   * Parse amount and determine kind in one pass to avoid double-parsing the same cell.
   * Returns { amount: smallest-unit integer, kind: 'expense' | 'income' }.
   */
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
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: PASS

- [x] **Step 5: Write test for DB-duplicate detection**

```typescript
// Add to src/tests/unit/import.test.ts
it('flags rows matching an existing DB transaction as duplicate (excluded by default)', async () => {
  await txRepo.createTransaction(db, {
    kind: 'expense', date: '2024-01-01', amount: 100, account_id: 'acc1', payee: 'Store'
  });

  const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-02,200,Other';
  await store.loadFile(csv, 'acc1');

  expect(store.rows).toHaveLength(2);
  expect(store.rows[0].status).toBe('duplicate');
  expect(store.rows[0].included).toBe(false);
  expect(store.rows[1].status).toBe('new');
  expect(store.rows[1].included).toBe(true);
});
```

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: PASS

- [x] **Step 7: Write test for intra-file dedup**

```typescript
// Add to src/tests/unit/import.test.ts
it('flags the second identical row in the same file as a duplicate of the first', async () => {
  // Two identical rows in one file — neither exists in the DB yet.
  const csv = 'date,amount,payee\n2024-01-01,100,Store\n2024-01-01,100,Store';
  await store.loadFile(csv, 'acc1');

  expect(store.rows).toHaveLength(2);
  expect(store.rows[0].status).toBe('new');
  expect(store.rows[0].included).toBe(true);
  expect(store.rows[1].status).toBe('duplicate');
  expect(store.rows[1].included).toBe(false);
});
```

- [x] **Step 8: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: PASS

- [x] **Step 9: Write test for commit writing only included rows**

```typescript
// Add to src/tests/unit/import.test.ts
it('commits only included non-invalid rows', async () => {
  const csv = 'date,amount,payee\n2024-01-01,100,Store A\n2024-01-02,200,Store B';
  await store.loadFile(csv, 'acc1');

  // User unchecks the first row
  store.rows[0].included = false;

  const count = await store.commit();
  expect(count).toBe(1);

  const txs = await txRepo.listTransactions(db, { account_id: 'acc1' });
  expect(txs).toHaveLength(1);
  expect(txs[0].payee).toBe('Store B');
});
```

- [x] **Step 10: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: PASS

- [x] **Step 11: Write test for reclassify after mapping change (EU amount locale)**

```typescript
// Add to src/tests/unit/import.test.ts
it('reclassifies amounts when the user switches the amount locale to EU', async () => {
  // EU-format amounts under a US-inferred locale parse wrong until overridden.
  // Amount field is quoted because it contains an embedded comma (1.234,56).
  const csv = 'date,amount,payee\n01/01/2024,"1.234,56",Store';
  await store.loadFile(csv, 'acc1');

  // With vi amountLocale, "1.234,56" → 1234.56 → 1234 VND.
  store.mapping.amountLocale = 'vi';
  store.reclassify();

  const valid = store.rows.filter(r => r.status !== 'invalid');
  expect(valid.length).toBeGreaterThan(0);
  expect(valid[0].amount).toBe(1234);
});
```

- [x] **Step 12: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/import.test.ts`
Expected: PASS (if this fails on CSV parsing of the embedded comma, fix the test CSV to use a quoted amount field: `"1.234,56"`, and confirm parseCsv + parseCsvAmount handle it)

- [x] **Step 13: Commit**

```bash
git add src/lib/stores/import.svelte.ts src/tests/unit/import.test.ts
git commit -m "feat(csv-import): add import store with intra-file dedup and live reclassify"
```

---

### Task 7: i18n Keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Consumes: Nothing
- Produces: `import_tx_*` keys consumed by the modal via `m.import_tx_*()`

- [x] **Step 1: Add English keys**

Add these keys to `messages/en.json` (maintain alphabetical order within the file; insert before the final closing brace):

```json
  "import_tx_title": "Import Transactions",
  "import_tx_select_file": "Select CSV file",
  "import_tx_select_account": "Select account",
  "import_tx_load": "Load file",
  "import_tx_mapping_heading": "Column mapping",
  "import_tx_mapping_date": "Date column",
  "import_tx_mapping_amount": "Amount column",
  "import_tx_mapping_payee": "Payee column",
  "import_tx_mapping_notes": "Notes column",
  "import_tx_mapping_debit": "Debit column",
  "import_tx_mapping_credit": "Credit column",
  "import_tx_mapping_sign": "Sign convention",
  "import_tx_mapping_sign_signed": "Signed amount",
  "import_tx_mapping_sign_separate": "Separate debit/credit",
  "import_tx_mapping_date_format": "Date format",
  "import_tx_mapping_amount_locale": "Amount format",
  "import_tx_mapping_amount_locale_en": "US (1,234.56)",
  "import_tx_mapping_amount_locale_vi": "EU (1.234,56)",
  "import_tx_mapping_ignore": "Ignore",
  "import_tx_preview_next": "Continue to preview",
  "import_tx_back": "Back",
  "import_tx_preview_heading": "Preview",
  "import_tx_col_include": "Include",
  "import_tx_col_date": "Date",
  "import_tx_col_payee": "Payee",
  "import_tx_col_amount": "Amount",
  "import_tx_col_status": "Status",
  "import_tx_status_new": "New",
  "import_tx_status_duplicate": "Duplicate",
  "import_tx_status_invalid": "Invalid",
  "import_tx_summary": "{count} new · {duplicates} duplicates · {invalid} invalid",
  "import_tx_commit": "Import {count}",
  "import_tx_commit_none": "No transactions to import",
  "import_tx_commit_success": "Imported {count} transactions",
  "import_tx_done": "Done",
  "import_tx_error_parse": "Could not parse this CSV file. Check that it is a valid CSV."
```

- [x] **Step 2: Add Vietnamese keys**

Add matching keys to `messages/vi.json` (before the final closing brace):

```json
  "import_tx_title": "Nhập giao dịch",
  "import_tx_select_file": "Chọn file CSV",
  "import_tx_select_account": "Chọn tài khoản",
  "import_tx_load": "Tải file",
  "import_tx_mapping_heading": "Ánh xạ cột",
  "import_tx_mapping_date": "Cột ngày",
  "import_tx_mapping_amount": "Cột số tiền",
  "import_tx_mapping_payee": "Cột người nhận",
  "import_tx_mapping_notes": "Cột ghi chú",
  "import_tx_mapping_debit": "Cột nợ",
  "import_tx_mapping_credit": "Cột có",
  "import_tx_mapping_sign": "Quy ước dấu",
  "import_tx_mapping_sign_signed": "Số tiền có dấu",
  "import_tx_mapping_sign_separate": "Tách nợ/có",
  "import_tx_mapping_date_format": "Định dạng ngày",
  "import_tx_mapping_amount_locale": "Định dạng số tiền",
  "import_tx_mapping_amount_locale_en": "Mỹ (1,234.56)",
  "import_tx_mapping_amount_locale_vi": "VN (1.234,56)",
  "import_tx_mapping_ignore": "Bỏ qua",
  "import_tx_preview_next": "Tiếp tục xem trước",
  "import_tx_back": "Quay lại",
  "import_tx_preview_heading": "Xem trước",
  "import_tx_col_include": "Chọn",
  "import_tx_col_date": "Ngày",
  "import_tx_col_payee": "Người nhận",
  "import_tx_col_amount": "Số tiền",
  "import_tx_col_status": "Trạng thái",
  "import_tx_status_new": "Mới",
  "import_tx_status_duplicate": "Trùng lặp",
  "import_tx_status_invalid": "Không hợp lệ",
  "import_tx_summary": "{count} mới · {duplicates} trùng · {invalid} không hợp lệ",
  "import_tx_commit": "Nhập {count}",
  "import_tx_commit_none": "Không có giao dịch để nhập",
  "import_tx_commit_success": "Đã nhập {count} giao dịch",
  "import_tx_done": "Xong",
  "import_tx_error_parse": "Không thể đọc file CSV. Kiểm tra lại file hợp lệ."
```

- [x] **Step 3: Regenerate Paraglide and typecheck**

Run: `pnpm check`
Expected: Paraglide compiles, no TypeScript/Svelte errors

- [x] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "feat(csv-import): add import_tx i18n keys (en + vi)"
```

---

### Task 8: Import Modal UI (with editable mapping)

**Files:**
- Create: `src/lib/components/modals/ImportTransactionsModal.svelte`
- Modify: `src/routes/transactions/+page.svelte` (add trigger button + mount modal)

**Interfaces:**
- Consumes: `ImportStore`, `accounts` store, `settings` store, i18n `m`, `Modal`/`Button`/`Input` primitives, `toast` store, `getDb`
- Produces: Modal component `{ onclose }` prop; rendered conditionally by the transactions page

- [x] **Step 1: Create the modal component**

```svelte
<!-- src/lib/components/modals/ImportTransactionsModal.svelte -->
<script lang="ts">
  import { ImportStore } from '$lib/stores/import.svelte';
  import Modal from '$lib/components/primitives/Modal.svelte';
  import Button from '$lib/components/primitives/Button.svelte';
  import * as m from '$lib/paraglide/messages';
  import { getDb } from '$lib/db';
  import { accounts } from '$lib/stores/accounts.svelte';
  import { settings } from '$lib/stores/settings.svelte';
  import { transactions } from '$lib/stores/transactions.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { formatCurrency } from '$lib/utils/currency';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let store = $state<ImportStore | null>(null);
  let selectedAccountId = $state('');
  let fileText = $state('');
  let loading = $state(false);
  let errorMsg = $state<string | null>(null);

  // Re-classify live whenever the mapping changes. Per the spec invariant:
  // "Mapping edits re-classify live — preview always reflects current mapping."
  // Uses $effect (not $derived) because reclassify() mutates store.rows.
  $effect(() => {
    if (store) {
      // Touch every mapping property so Svelte tracks them as dependencies.
      const _touch = [
        store.mapping.date, store.mapping.amount, store.mapping.payee,
        store.mapping.notes, store.mapping.debit, store.mapping.credit,
        store.mapping.signConvention, store.mapping.dateFormat, store.mapping.amountLocale
      ];
      store.reclassify();
    }
  });

  const activeAccounts = $derived(accounts.items.filter(a => !a.archived));

  async function onFileChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileText = await file.text();
  }

  async function onLoad() {
    if (!fileText || !selectedAccountId) return;
    loading = true;
    errorMsg = null;
    try {
      const db = await getDb();
      store = new ImportStore(db, settings.currency);
      await store.loadFile(fileText, selectedAccountId);
    } catch (e) {
      errorMsg = m.import_tx_error_parse();
      store = null;
    } finally {
      loading = false;
    }
  }

  async function onCommit() {
    if (!store) return;
    loading = true;
    try {
      const count = await store.commit();
      if (count > 0) {
        // Cross-window refresh: emit the existing event the layout listens for.
        // In Tauri, @tauri-apps/api/event emit reaches other webviews; in the
        // web/E2E build, dispatch a window event the same listener catches.
        try {
          if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('transaction:saved', {});
          } else {
            window.dispatchEvent(new Event('transaction:saved'));
          }
        } catch { /* non-fatal: list refresh still runs below */ }
        await transactions.load();
        toast.show(m.import_tx_commit_success({ count }));
      } else {
        toast.show(m.import_tx_commit_none());
      }
      open = false;
      reset();
    } finally {
      loading = false;
    }
  }

  function reset() {
    store = null;
    fileText = '';
    selectedAccountId = '';
    errorMsg = null;
  }

  // Live summary counts from the store
  let newCount = $derived(store?.newCount ?? 0);
  let dupCount = $derived(store?.duplicateCount ?? 0);
  let invalidCount = $derived(store?.invalidCount ?? 0);
  let includedCount = $derived(store?.includedCount ?? 0);

  // Column-role options for the editable mapping dropdowns
  const dateFormats = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
</script>

<Modal bind:open title={m.import_tx_title()}>
  {#if !store}
    <!-- Phase: select -->
    <div class="space-y-4">
      <label class="block">
        <span class="text-sm text-dim">{m.import_tx_select_account()}</span>
        <select bind:value={selectedAccountId} class="mt-1 w-full bg-ink border border-line rounded-md px-3 py-2 text-sm text-ledger">
          <option value="">—</option>
          {#each activeAccounts as acc}
            <option value={acc.id}>{acc.name}</option>
          {/each}
        </select>
      </label>

      <label class="block">
        <span class="text-sm text-dim">{m.import_tx_select_file()}</span>
        <input type="file" accept=".csv,text/csv" onchange={onFileChosen}
          class="mt-1 block w-full text-sm text-dim file:mr-3 file:rounded-md file:border-0 file:bg-phosphor file:px-3 file:py-1.5 file:text-ink" />
      </label>

      {#if errorMsg}
        <p class="text-sm text-debit">{errorMsg}</p>
      {/if}

      <div class="flex justify-end">
        <Button onclick={onLoad} disabled={!selectedAccountId || !fileText || loading}>
          {m.import_tx_load()}
        </Button>
      </div>
    </div>
  {:else if store.phase === 'mapping'}
    <!-- Phase: editable mapping -->
    <div class="space-y-4">
      <h3 class="text-sm text-ledger font-medium">{m.import_tx_mapping_heading()}</h3>

      <!-- Sign convention toggle -->
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_sign()}</span>
          <select bind:value={store.mapping.signConvention} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            <option value="signed">{m.import_tx_mapping_sign_signed()}</option>
            <option value="debit_credit_separate">{m.import_tx_mapping_sign_separate()}</option>
          </select>
        </label>
      </div>

      <!-- Column role dropdowns -->
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_date()}</span>
          <select bind:value={store.mapping.date} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            <option value={null}>{m.import_tx_mapping_ignore()}</option>
            {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
          </select>
        </label>

        {#if store.mapping.signConvention === 'signed'}
          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_amount()}</span>
            <select bind:value={store.mapping.amount} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>
        {:else}
          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_debit()}</span>
            <select bind:value={store.mapping.debit} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>

          <label class="block">
            <span class="text-xs text-dim">{m.import_tx_mapping_credit()}</span>
            <select bind:value={store.mapping.credit} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
              <option value={null}>{m.import_tx_mapping_ignore()}</option>
              {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
            </select>
          </label>
        {/if}

        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_payee()}</span>
          <select bind:value={store.mapping.payee} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            <option value={null}>{m.import_tx_mapping_ignore()}</option>
            {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
          </select>
        </label>

        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_notes()}</span>
          <select bind:value={store.mapping.notes} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            <option value={null}>{m.import_tx_mapping_ignore()}</option>
            {#each store.rows[0].raw as header, i}<option value={i}>{header || `Column ${i + 1}`}</option>{/each}
          </select>
        </label>
      </div>

      <!-- Format overrides -->
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_date_format()}</span>
          <select bind:value={store.mapping.dateFormat} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            {#each dateFormats as f}<option value={f}>{f}</option>{/each}
          </select>
        </label>

        <label class="block">
          <span class="text-xs text-dim">{m.import_tx_mapping_amount_locale()}</span>
          <select bind:value={store.mapping.amountLocale} class="mt-1 w-full bg-ink border border-line rounded-md px-2 py-1.5 text-sm text-ledger">
            <option value="en">{m.import_tx_mapping_amount_locale_en()}</option>
            <option value="vi">{m.import_tx_mapping_amount_locale_vi()}</option>
          </select>
        </label>
      </div>

      <p class="text-xs text-dim">
        {m.import_tx_summary({ count: newCount, duplicates: dupCount, invalid: invalidCount })}
      </p>

      <div class="flex justify-between">
        <Button variant="ghost" onclick={reset}>{m.import_tx_back()}</Button>
        <Button onclick={() => store.goToPreview()} disabled={newCount === 0}>
          {m.import_tx_preview_next()}
        </Button>
      </div>
    </div>
  {:else if store.phase === 'preview'}
    <!-- Phase: preview -->
    <div class="space-y-4">
      <p class="text-sm text-dim">
        {m.import_tx_summary({ count: newCount, duplicates: dupCount, invalid: invalidCount })}
      </p>

      <div class="max-h-96 overflow-y-auto border border-line rounded-md">
        <table class="w-full text-sm">
          <thead class="bg-ink sticky top-0">
            <tr class="text-left text-xs text-dim">
              <th class="p-2">{m.import_tx_col_include()}</th>
              <th class="p-2">{m.import_tx_col_date()}</th>
              <th class="p-2">{m.import_tx_col_payee()}</th>
              <th class="p-2 text-right">{m.import_tx_col_amount()}</th>
              <th class="p-2">{m.import_tx_col_status()}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            {#each store.rows as row, i}
              <tr class="{row.status === 'duplicate' ? 'opacity-50' : ''} {row.status === 'invalid' ? 'bg-debit/10' : ''}">
                <td class="p-2">
                  <input type="checkbox" bind:checked={store.rows[i].included}
                    disabled={row.status === 'invalid'} />
                </td>
                <td class="p-2 text-ledger">{row.date ?? '—'}</td>
                <td class="p-2 text-ledger">{row.payee ?? '—'}</td>
                <td class="p-2 text-right figures {row.kind === 'expense' ? 'text-debit' : 'text-phosphor'}">
                  {#if row.amount != null}{formatCurrency(row.amount, settings.currency, settings.locale)}{/if}
                </td>
                <td class="p-2 text-xs">
                  {#if row.status === 'new'}{m.import_tx_status_new()}
                  {:else if row.status === 'duplicate'}{m.import_tx_status_duplicate()}
                  {:else}{m.import_tx_status_invalid()}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="flex justify-between">
        <Button variant="ghost" onclick={() => store.backToMapping()}>{m.import_tx_back()}</Button>
        <Button onclick={onCommit} disabled={includedCount === 0 || loading}>
          {m.import_tx_commit({ count: includedCount })}
        </Button>
      </div>
    </div>
  {:else if store.phase === 'done'}
    <p class="text-sm text-ledger">{m.import_tx_done()}</p>
    <div class="flex justify-end mt-4">
      <Button onclick={() => { open = false; reset(); }}>{m.import_tx_done()}</Button>
    </div>
  {/if}
</Modal>
```

- [x] **Step 2: Wire trigger + modal into the transactions page**

Modify `src/routes/transactions/+page.svelte`. In the `<script>` block, add the import and a state flag:

```svelte
	import ImportTransactionsModal from '$lib/components/modals/ImportTransactionsModal.svelte';
	// ...
	let showImport = $state(false);
```

In the header area (after the `<h1>` line ~line 70, within the existing layout), add an Import button next to the search row. Replace this block:

```svelte
	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder={m.transactions_search_placeholder()} bind:value={search} />
		</div>
		<Button size="sm" onclick={onSearch}>{m.common_search()}</Button>
	</div>
```

with:

```svelte
	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder={m.transactions_search_placeholder()} bind:value={search} />
		</div>
		<Button size="sm" variant="secondary" onclick={() => showImport = true}>{m.import_tx_title()}</Button>
		<Button size="sm" onclick={onSearch}>{m.common_search()}</Button>
	</div>
```

Then at the end of the template (after the closing of the main container div, before `</script>`'s sibling — i.e., as the last element inside the page's root `<div class="space-y-4">`), mount the modal:

```svelte
	<ImportTransactionsModal bind:open={showImport} />
```

- [x] **Step 3: Typecheck**

Run: `pnpm check`
Expected: No errors. If `m.import_tx_*` calls error, confirm Task 7 ran and Paraglide regenerated.

- [x] **Step 4: Run unit tests (regression — the store + repo are still covered)**

Run: `pnpm test`
Expected: All pass

- [x] **Step 5: Commit**

```bash
git add src/lib/components/modals/ImportTransactionsModal.svelte src/routes/transactions/+page.svelte
git commit -m "feat(csv-import): add import modal with editable mapping and preview"
```

---

### Task 9: E2E Test

**Files:**
- Create: `src/tests/e2e/csv-import.spec.ts`

**Interfaces:**
- Consumes: `onboardedPage` fixture (pre-onboarded app with "Test Checking" account + VND currency), `getByRole`/`getByLabel` selectors
- Produces: E2E test covering select → load → preview → commit with duplicate detection

- [x] **Step 1: Write E2E test for import with a duplicate row**

```typescript
// src/tests/e2e/csv-import.spec.ts
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('CSV import', () => {
  test('imports new rows and skips a duplicate matching an existing transaction', async ({ onboardedPage: page }) => {
    // Seed an existing transaction that the CSV will duplicate.
    // addTransaction uses the dashboard FAB; amount '100' → 100 VND (0 fraction digits).
    await addTransaction(page, { kind: 'expense', amount: '100' });

    // Navigate to the Transactions page where the Import button lives.
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

    // Open the import modal. import_tx_title() → "Import Transactions".
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal = page.getByRole('dialog');

    // Select the onboarded account "Test Checking".
    await modal.getByLabel('Select account').selectOption('Test Checking');

    // Upload a CSV: row 1 duplicates the seeded 100 VND expense on today's date.
    // Use the seeded transaction's date (today) + amount 100 so dedup matches.
    // addTransaction defaults the date to today in local timezone, so the CSV must use local date too.
    // Note: Use local date, not UTC, to avoid timezone mismatch at midnight boundaries.
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const csv = `date,amount,payee\n${todayStr},100,Duplicate Payee\n${todayStr},200,New Payee`;
    const fileInput = modal.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv)
    });

    // Load the file → advances to the mapping phase.
    await modal.getByRole('button', { name: 'Load file' }).click();

    // Continue to preview (auto-inferred mapping should be correct for this file).
    await modal.getByRole('button', { name: 'Continue to preview' }).click();

    // Preview summary: 1 new, 1 duplicate, 0 invalid.
    await expect(modal.getByText(/1 new/)).toBeVisible();
    await expect(modal.getByText(/1 duplicate/)).toBeVisible();

    // Commit — button label is import_tx_commit({count}) → "Import 1".
    await modal.getByRole('button', { name: /Import \d+/ }).click();

    // Modal closes.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The new payee appears in the transactions list; the duplicate does not double.
    await expect(page.getByText('New Payee')).toBeVisible();
  });

  test('re-importing the same file writes zero new rows', async ({ onboardedPage: page }) => {
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Select account').selectOption('Test Checking');

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const csv = `date,amount,payee\n${todayStr},300,Once Only`;
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await modal.getByRole('button', { name: 'Load file' }).click();
    await modal.getByRole('button', { name: 'Continue to preview' }).click();
    await modal.getByRole('button', { name: /Import \d+/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Re-import the identical file.
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal2 = page.getByRole('dialog');
    await modal2.getByLabel('Select account').selectOption('Test Checking');
    await modal2.locator('input[type="file"]').setInputFiles({
      name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await modal2.getByRole('button', { name: 'Load file' }).click();
    await modal2.getByRole('button', { name: 'Continue to preview' }).click();

    // All rows are now duplicates → commit disabled (0 included).
    await expect(modal2.getByText(/1 duplicate/)).toBeVisible();
    await expect(modal2.getByRole('button', { name: /Import/ })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run the E2E test**

Run: `pnpm test:e2e src/tests/e2e/csv-import.spec.ts`
Expected: PASS. If the "Select account" label isn't found, scope the select by the visible text or the container — the modal uses a wrapping `<label>` with the i18n string as its text. Adjust the locator to `modal.locator('select').first()` if the accessible label doesn't attach.

- [x] **Step 3: Commit**

```bash
git add src/tests/e2e/csv-import.spec.ts
git commit -m "test(csv-import): add E2E for import with duplicate detection"
```

---

### Task 10: Final Verification

**Files:** None (verification only)

- [x] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: All pass

- [x] **Step 2: Run all E2E tests**

Run: `pnpm test:e2e`
Expected: All pass

- [x] **Step 3: Typecheck**

Run: `pnpm check`
Expected: No errors

- [x] **Step 4: Production build**

Run: `pnpm build`
Expected: Succeeds

- [x] **Step 5: Manual smoke test in desktop app**

Run: `pnpm tauri dev`
Expected: App launches. On the Transactions page, click "Import Transactions", select the account, load a real bank CSV, verify mapping is editable, preview shows correct new/duplicate/invalid counts, commit writes the rows. Re-import the same file → all duplicate, commit disabled.

---

## Summary

**Tasks:** 10 · **New files:** 11 · **Modified files:** 5

**Key decisions (from spec + self-review fixes):**
- Four pure utils (added `parse_csv_amount` — `parseAmount` can't handle EU `1.234,56` format; CSV import gets its own locale-aware parser, leaving `parseAmount` untouched per the gotcha).
- Strict dedup on (account, date, amount-magnitude); kind ignored so a sign-flipped re-export still matches.
- **Intra-file dedup:** `classifyAllRows` accumulates each newly-classified 'new' row into the `seen` set, so a second identical row in the same file is flagged duplicate of the first pending row (spec edge case).
- **Editable mapping:** the modal binds dropdowns to `store.mapping.*`; a `$derived` watcher calls `store.reclassify()` on every mapping change so preview stays live (spec invariant: "Mapping edits re-classify live").
- Atomic batch insert in one SAVEPOINT; CHECK-constraint violation rolls back the whole batch.
- No schema changes — writes to the existing `transactions` table. The schema-version-call-site gotcha does not apply.
- Trigger lives on the Transactions page header (specific, not "somewhere in the UI").
- Cross-window refresh reuses the existing `transaction:saved` channel (Tauri `emit` in desktop, `window` event in web/E2E).

**Ready to execute.**
