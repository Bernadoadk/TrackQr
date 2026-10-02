/**
 * Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). The
 * separator is "," or ";" (European spreadsheet exports), detected on the
 * header line. Returns rows of trimmed cells; empty lines are skipped.
 * Client-safe: the bulk import previews the file in the browser.
 */
export function parseCsv(text: string, maxRows = 1000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  const header = input.split(/\r?\n/, 1)[0] ?? "";
  const sep = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === sep) { row.push(cell.trim()); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(c => c !== "")) rows.push(row);
      row = []; cell = "";
      if (rows.length >= maxRows + 1) break;
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some(c => c !== "")) rows.push(row);
  return rows;
}
