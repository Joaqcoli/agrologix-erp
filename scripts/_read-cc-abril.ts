/**
 * Lee la pestaña "cuentas corrientes abril" del Excel y muestra
 * el saldo de marzo (saldo que trae) por cliente.
 */
import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as fs from "fs";
import * as path from "path";

const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");

function parseMoney(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(/\$/g, "").trim();
  if (s === "-" || s === "$ -" || s === "$  -" || s === "") return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return parseFloat(s.replace(/\./g, "").replace(",", "."));
  }
  const clean = s.replace(/,/g, "");
  return parseFloat(clean) || 0;
}

function cellStr(sheet: any, col: number, row: number): string {
  const addr = (XLSX as any).utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

function cellRaw(sheet: any, col: number, row: number): string {
  const addr = (XLSX as any).utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return "";
  return `t=${cell.t} v=${JSON.stringify(cell.v)} w=${JSON.stringify(cell.w)}`;
}

async function main() {
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });

  console.log("Todas las pestañas del Excel:");
  for (const name of wb.SheetNames) {
    console.log(`  "${name}"`);
  }

  // Buscar pestaña CC
  const ccSheet = wb.SheetNames.find((n: string) =>
    /cc|cuentas?\s*corrientes?/i.test(n) && /abril/i.test(n)
  ) ?? wb.SheetNames.find((n: string) =>
    /cc|cuentas?\s*corrientes?/i.test(n)
  );

  if (!ccSheet) {
    console.log("\n⚠ No se encontró pestaña de CC/cuentas corrientes");
    return;
  }

  console.log(`\nUsando pestaña: "${ccSheet}"\n`);

  const sheet = wb.Sheets[ccSheet];
  const range = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const maxCol = range.e.c;

  console.log(`Dimensiones: ${maxRow + 1} filas x ${maxCol + 1} columnas\n`);

  // Dump primeras 10 filas para entender la estructura
  console.log("=== Primeras 15 filas (estructura) ===");
  for (let r = 0; r <= Math.min(14, maxRow); r++) {
    const cells: string[] = [];
    for (let c = 0; c <= Math.min(maxCol, 8); c++) {
      const v = cellStr(sheet, c, r);
      if (v) cells.push(`[${c}]"${v}"`);
    }
    if (cells.length > 0) console.log(`  r${r + 1}: ${cells.join("  ")}`);
  }

  console.log("\n=== Todas las filas con contenido ===");
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= Math.min(maxCol, 8); c++) {
      const v = cellStr(sheet, c, r);
      if (v) cells.push(`[${c}]"${v}"`);
    }
    if (cells.length > 0) console.log(`  r${r + 1}: ${cells.join("  ")}`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
