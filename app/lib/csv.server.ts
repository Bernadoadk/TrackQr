/**
 * Quote a value for CSV. Cells that a spreadsheet would read as a formula
 * (=, +, -, @, tab, CR) are prefixed with an apostrophe — some values come
 * from visitors (referer, ?ref=…) and must never execute in Excel/Sheets.
 */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; label: string }[]): string {
  const head = columns.map(c => csvCell(c.label)).join(",");
  const body = rows.map(r => columns.map(c => csvCell(r[c.key])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export { parseCsv } from "./csv-parse";
