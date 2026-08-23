/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CR/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export type Field = 'name' | 'set' | 'number' | 'quantity';

export type ColumnMap = Partial<Record<Field, number>>;

const HEADER_HINTS: Record<Field, string[]> = {
  name: ['name', 'card name', 'product name', 'cardname', 'card', 'title'],
  set: ['set', 'set name', 'edition', 'expansion', 'series', 'setname'],
  number: ['number', 'card number', 'collector number', 'collectornumber', 'cardnumber', 'no', '#'],
  quantity: ['quantity', 'qty', 'count', 'amount', 'have'],
};

/** Guess which column is which from the header row of a collection export. */
export function guessColumns(header: string[]): ColumnMap {
  const cleaned = header.map((h) => h.trim().toLowerCase());
  const map: ColumnMap = {};
  for (const field of Object.keys(HEADER_HINTS) as Field[]) {
    const hints = HEADER_HINTS[field];
    let best = cleaned.findIndex((h) => hints.includes(h));
    if (best < 0) best = cleaned.findIndex((h) => hints.some((hint) => h.includes(hint)));
    if (best >= 0) map[field] = best;
  }
  return map;
}

export function looksLikeHeader(row: string[]): boolean {
  const map = guessColumns(row);
  return map.name !== undefined || map.set !== undefined || map.number !== undefined;
}

export interface ImportRow {
  name: string;
  setName?: string;
  number?: string;
  quantity?: number;
}

export function readRows(rows: string[][], map: ColumnMap, skipFirst: boolean): ImportRow[] {
  const body = skipFirst ? rows.slice(1) : rows;
  const out: ImportRow[] = [];
  for (const row of body) {
    const name = (map.name !== undefined ? row[map.name] : row[0])?.trim();
    if (!name) continue;
    const quantity = map.quantity !== undefined ? Number(row[map.quantity]?.trim()) : undefined;
    out.push({
      name,
      setName: map.set !== undefined ? row[map.set]?.trim() || undefined : undefined,
      number: map.number !== undefined ? row[map.number]?.trim().replace(/^#/, '') || undefined : undefined,
      quantity: Number.isFinite(quantity) ? quantity : undefined,
    });
  }
  return out;
}
