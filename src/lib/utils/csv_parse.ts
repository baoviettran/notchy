import { AppError } from '$lib/errors';

export interface CsvParseOptions {
  delimiter?: string;
}

export interface CsvParseResult {
  rows: string[][];
  delimiter: string;
}

export function parseCsv(text: string, opts?: CsvParseOptions): CsvParseResult {
  // Strip UTF-8 BOM if present (common in Windows-exported CSV files)
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

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
