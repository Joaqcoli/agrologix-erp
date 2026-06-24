// Helpers compartidos de parsing de extractos (XLSX/CSV). Extraídos de mp-report-sync.ts
// (paso 1 del lector de Galicia) para reusarlos sin duplicar. MP sigue usándolos igual.
import * as XLSX from "xlsx";

/** Normaliza encabezado: mayúsculas, sin acentos, trim. */
export function normHeader(s: string): string {
  return String(s ?? "").toUpperCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Fecha de una celda XLSX/string → YYYY-MM-DD. Soporta Date, ISO y DD/MM/YYYY. */
export function parseXlsxDate(val: any): string {
  if (!val) return "";
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return `${dm[3]}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;
  return s.slice(0, 10);
}

/** Timestamp completo de una celda XLSX — ISO con hora si está disponible, si no YYYY-MM-DD. */
export function parseXlsxTimestamp(val: any): string {
  if (!val) return "";
  if (val instanceof Date) {
    return val.toISOString();
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (dm) return `${dm[3]}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}T${dm[4]}-03:00`;
  const dm2 = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (dm2) return `${dm2[1]}T${dm2[2]}-03:00`;
  return parseXlsxDate(val);
}

/** Número de una celda XLSX (number o string con coma decimal SIN separador de miles). Usado por MP. */
export function parseNum(val: any): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "0").replace(",", ".")) || 0;
}

/**
 * Número en formato ARGENTINO: punto = miles, coma = decimal. "1.234.567,89" → 1234567.89,
 * "800000,00" → 800000. Para extractos de Galicia (CSV/XLSX con formato es-AR).
 */
export function parseNumAr(val: any): number {
  if (typeof val === "number") return val;
  const s = String(val ?? "").trim();
  if (!s) return 0;
  // quita separador de miles (.) y pasa la coma decimal a punto
  const norm = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  return parseFloat(norm) || 0;
}

/**
 * Lee un buffer de archivo (CSV o XLSX) y devuelve { headers, dataRows }.
 * CSV: separador configurable (Galicia usa ';'), maneja utf-8-sig (BOM). XLSX: primera hoja.
 * Detecta XLSX por magic bytes (PK = ZIP) aunque la extensión diga .csv.
 */
export function readSheet(buffer: Buffer, opts?: { csvDelimiter?: string }): { headers: string[]; dataRows: any[][] } {
  const isXlsx = buffer.slice(0, 2).toString("hex") === "504b"; // PK (ZIP/XLSX)
  let allRows: any[][];
  if (isXlsx) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
  } else {
    // CSV: quitar BOM utf-8-sig, parsear por líneas con el separador dado (default ';')
    const delim = opts?.csvDelimiter ?? ";";
    const text = buffer.toString("utf-8").replace(/^﻿/, "");
    allRows = text.split(/\r?\n/).filter(l => l.length > 0).map(line => splitCsvLine(line, delim));
  }
  const headers = (allRows[0] ?? []).map(h => String(h ?? ""));
  const dataRows = allRows.slice(1);
  return { headers, dataRows };
}

/** Split de una línea CSV respetando comillas dobles. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // comilla escapada
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}
