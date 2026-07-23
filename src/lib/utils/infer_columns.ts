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
