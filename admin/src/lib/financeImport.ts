import type { FinanceTransactionType } from './types';

export interface FinanceImportRow {
  source_row: number;
  transaction_type: FinanceTransactionType;
  occurred_on: string;
  title: string;
  amount: number;
  account_name?: string;
  from_account_name?: string;
  to_account_name?: string;
  category_name?: string;
  payment_method?: 'upi' | 'cash' | 'bank_transfer' | 'card' | 'other';
  notes?: string;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n') {
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  const amount = Number(cleaned);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function parseDisplayedDate(value: string): string | null {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function prepareSheetImport(
  text: string,
  kind: 'income' | 'expense',
  incomeCategory = 'Other income',
): { rows: FinanceImportRow[]; errors: string[] } {
  const parsed = parseCsv(text);
  if (parsed.length < 2) return { rows: [], errors: ['The CSV has no data rows.'] };
  const headers = parsed[0].map(normalizedHeader);
  const indexOf = (name: string) => headers.indexOf(name);
  const titleIndex = indexOf('title');
  const dateIndex = indexOf('date');
  const amountIndex = indexOf('amount');
  const accountIndex = indexOf(kind === 'income' ? 'payee' : 'payor');
  const categoryIndex = indexOf('category');
  const required = [titleIndex, dateIndex, amountIndex, accountIndex];
  if (required.some((index) => index < 0)) {
    return {
      rows: [],
      errors: [`Expected ${kind === 'income' ? 'Title, Date, Payee, Amount' : 'Title, Date, Payor, Amount, Category'} columns.`],
    };
  }
  if (kind === 'expense' && categoryIndex < 0) {
    return { rows: [], errors: ['Expected a Category column.'] };
  }

  const rows: FinanceImportRow[] = [];
  const errors: string[] = [];
  for (let index = 1; index < parsed.length; index++) {
    const sourceRow = index + 1;
    const raw = parsed[index];
    const title = raw[titleIndex]?.trim();
    const occurredOn = parseDisplayedDate(raw[dateIndex] || '');
    const amount = parseAmount(raw[amountIndex] || '');
    const accountName = raw[accountIndex]?.trim();
    const rawCategory = kind === 'expense' ? raw[categoryIndex]?.trim() : incomeCategory;
    const categoryName = rawCategory === 'Miscellanous' ? 'Miscellaneous' : rawCategory;

    if (!title || !occurredOn || !amount || !accountName || !categoryName) {
      errors.push(`Row ${sourceRow}: check the title, date, amount, account, and category.`);
      continue;
    }
    const isInternalSettlement = categoryName.toLowerCase() === 'internal settlement'
      || title.toLowerCase().includes('internal settlement');
    if (isInternalSettlement) {
      errors.push(`Row ${sourceRow}: internal settlements must be recorded as transfers, not operating income or expenses.`);
      continue;
    }
    rows.push({
      source_row: sourceRow,
      transaction_type: kind,
      occurred_on: occurredOn,
      title,
      amount,
      account_name: accountName,
      category_name: categoryName,
      payment_method: 'other',
    });
  }
  return { rows, errors };
}
