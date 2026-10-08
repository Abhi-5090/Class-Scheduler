/*
 * Spreadsheet in and out, loaded only when someone imports or exports.
 *
 *   download(rows, columns, name, 'xlsx' | 'csv')   rows are plain objects
 *   readFile(file) → [{ column: value, … }]           CSV or Excel, first sheet
 *
 * Formula injection: a CSV cell starting with = + - @ (or tab / CR) is run as
 * a formula when the file is opened in Excel, so such CSV cells are prefixed
 * with an apostrophe — except plain numbers like "+91 98765 43210" or "-5",
 * which cannot run. Excel (.xlsx) cells are written explicitly as text, which
 * Excel never evaluates, so they need no prefix. On import, a leading
 * apostrophe added this way is removed again.
 */
const RISKY = /^[=+\-@\t\r]/;
const NUMBERISH = /^[+-]?[\d\s().]+$/;
const safeCsv = v => (typeof v === 'string' && RISKY.test(v) && !NUMBERISH.test(v) ? `'${v}` : v);
const unguard = v => (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const MAX_FILE = 4 * 1024 * 1024;       // 4 MB is far beyond any real timetable

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* the local date — toISOString would give yesterday before 05:30 in India */
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* columns: [{ key, label }] — the order and headers of the sheet */
export async function download(rows, columns, name, format = 'xlsx') {
  const filename = `${name.replace(/[^\w.-]+/g, '_')}_${stamp()}.${format}`;
  if (format === 'csv') {
    const { default: Papa } = await import('papaparse');
    const csv = Papa.unparse({
      fields: columns.map(c => c.label),
      data: rows.map(r => columns.map(c => safeCsv(r[c.key] ?? ''))),
    });
    /* BOM so Excel reads UTF-8 names (· – é) correctly */
    save(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), filename);
    return;
  }
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const header = columns.map(c => ({ value: c.label, fontWeight: 'bold' }));
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key];
    if (typeof v === 'number') return { type: Number, value: v };
    if (typeof v === 'boolean') return { type: String, value: v ? 'Yes' : 'No' };
    return { type: String, value: String(v ?? '') };
  }));
  const blob = await writeExcelFile([header, ...body], {
    columns: columns.map(c => ({ width: Math.min(48, Math.max(10, c.label.length + 2, ...rows.slice(0, 200).map(r => String(r[c.key] ?? '').length + 2))) })),
  }).toBlob();
  save(blob, filename);
}

/* several sheets in one .xlsx: [{ name, rows, columns }] */
export async function downloadBook(sheets, name) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const data = sheets.map(sh => [
    sh.columns.map(c => ({ value: c.label, fontWeight: 'bold' })),
    ...sh.rows.map(r => sh.columns.map(c => (typeof r[c.key] === 'number' ? { type: Number, value: r[c.key] } : { type: String, value: String(r[c.key] ?? '') }))),
  ]);
  const blob = await writeExcelFile(data, {
    sheets: sheets.map(sh => sh.name.slice(0, 31)),
    columns: sheets.map(sh => sh.columns.map(c => ({ width: Math.min(40, Math.max(10, c.label.length + 2)) }))),
  }).toBlob();
  save(blob, `${name.replace(/[^\w.-]+/g, '_')}_${stamp()}.xlsx`);
}

/* → array of row objects keyed by the header row; blank rows dropped */
export async function readFile(file) {
  if (!file) throw new Error('Choose a file');
  if (file.size > MAX_FILE) throw new Error('That file is larger than 4 MB — split it and import in parts');
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const { default: Papa } = await import('papaparse');
    const text = await file.text();
    const out = Papa.parse(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() });
    if (out.errors.length && !out.data.length) throw new Error(`Could not read the CSV: ${out.errors[0].message}`);
    return out.data
      .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, unguard(v)])))
      .filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''));
  }
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const sheet = await readSheet(file);
    const [head = [], ...rest] = sheet;
    const keys = head.map(h => String(h ?? '').trim());
    return rest
      .map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : unguard(r[i] ?? '')])))
      .filter(r => Object.values(r).some(v => String(v ?? '').trim() !== ''));
  }
  throw new Error('Use a .csv or .xlsx file (older .xls files: save as .xlsx first)');
}
