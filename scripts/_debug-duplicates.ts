/**
 * Analiza el estado de todos los días de abril:
 * - Qué hay en el Excel (con totales)
 * - Qué hay en la DB (con totales y si tienen items)
 * - Detecta duplicados y pedidos sin match
 */
import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

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

function cellNum(sheet: any, col: number, row: number): number {
  const addr = (XLSX as any).utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseMoney(cell.v);
}

function isRowEmpty(sheet: any, row: number): boolean {
  for (let c = 0; c <= 10; c++) {
    const addr = (XLSX as any).utils.encode_cell({ c, r: row });
    if (sheet[addr] && String(sheet[addr].v ?? "").trim() !== "") return false;
  }
  return true;
}

function parseDateFromSheetName(name: string): string | null {
  const m = name.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Cuenta clientes únicos en un sheet
function countBlocks(sheet: any): { name: string; total: number }[] {
  const range = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const results: { name: string; total: number }[] = [];
  let r = 0;
  const isRto = (s: string) => /rto\s*[:\-]?\s*\d+/i.test(s);
  const isBareInt = (s: string) => /^\s*\d+\s*$/.test(s);

  while (r <= maxRow) {
    const colA = cellStr(sheet, 0, r);
    const colC = cellStr(sheet, 2, r);
    const colD = cellStr(sheet, 3, r);
    const colE = cellStr(sheet, 4, r);
    const colAIsNumeric = !isNaN(parseFloat(colA.replace(",", ".")));
    const rtoCol =
      isRto(colD) ? colD : isRto(colE) ? colE : isRto(colC) ? colC :
      isBareInt(colD) ? colD : isBareInt(colE) ? colE : isBareInt(colC) ? colC : "";

    const isClientHeader =
      colA !== "" && colA.toUpperCase() !== "CANTIDAD" && !colAIsNumeric && rtoCol !== "";
    const isClientHeaderNoRto =
      !isClientHeader && colA !== "" && colA.toUpperCase() !== "CANTIDAD" && !colAIsNumeric &&
      (() => {
        for (let t = r + 1; t <= Math.min(r + 5, maxRow); t++) {
          if (/cantidad/i.test(cellStr(sheet, 0, t))) return true;
        }
        return false;
      })();

    if (!isClientHeader && !isClientHeaderNoRto) { r++; continue; }

    const colB = cellStr(sheet, 1, r);
    const sedeMatch = colB.match(/^SEDE:\s*(.+)/i);
    const customerName = sedeMatch ? `${colA.trim()} - ${sedeMatch[1].trim()}` : colA.trim();
    r++;

    let titleRow = -1;
    for (let t = r; t <= Math.min(r + 3, maxRow); t++) {
      if (/cantidad/i.test(cellStr(sheet, 0, t))) { titleRow = t; break; }
    }
    if (titleRow === -1) { r++; continue; }
    r = titleRow + 1;

    let blockTotal = 0;
    let itemsTotal = 0;
    while (r <= maxRow) {
      if (isRowEmpty(sheet, r)) break;
      const a = cellStr(sheet, 0, r);
      if (a === "" && cellNum(sheet, 4, r) !== 0 && cellStr(sheet, 2, r) === "" && cellStr(sheet, 1, r) === "") {
        blockTotal = cellNum(sheet, 4, r); r++; continue;
      }
      if (/^(total|subtotal|suma)/i.test(a)) {
        blockTotal = cellNum(sheet, 4, r); r++; continue;
      }
      const qty = parseFloat(a.replace(",", "."));
      if (!isNaN(qty) && qty > 0 && cellStr(sheet, 2, r) !== "") {
        itemsTotal += cellNum(sheet, 4, r);
      }
      r++;
    }
    while (r <= maxRow && isRowEmpty(sheet, r)) r++;

    const total = blockTotal > 0 ? blockTotal : itemsTotal;
    if (total > 0) results.push({ name: customerName, total });
  }
  return results;
}

async function main() {
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const daySheets = wb.SheetNames.filter((n: string) => parseDateFromSheetName(n) !== null);

  // DB: totales por día y cliente
  const dbR = await pool.query(`
    SELECT TO_CHAR(o.order_date::date, 'YYYY-MM-DD') as date, c.name, o.id, o.remito_num,
           o.total::numeric as total,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date::date >= '2026-04-01'
      AND o.order_date::date < '2026-05-01'
      AND o.status = 'approved'
    ORDER BY o.order_date, c.name, o.id
  `);

  // Agrupar DB por fecha
  const dbByDate: Map<string, { name: string; id: number; remito: number | null; total: number; itemCount: number }[]> = new Map();
  for (const row of dbR.rows) {
    const d = String(row.date);
    if (!dbByDate.has(d)) dbByDate.set(d, []);
    dbByDate.get(d)!.push({
      name: row.name, id: row.id,
      remito: row.remito_num ? parseInt(row.remito_num) : null,
      total: parseFloat(row.total),
      itemCount: parseInt(row.item_count),
    });
  }

  console.log("═".repeat(80));
  console.log("RECONCILIACIÓN COMPLETA ABRIL 2026 — Excel vs DB");
  console.log("═".repeat(80));
  console.log();

  let totalXlsDiff = 0;

  for (const sheetName of daySheets) {
    const date = parseDateFromSheetName(sheetName)!;
    const sheet = wb.Sheets[sheetName];
    const xlsBlocks = countBlocks(sheet);
    const dbOrders = dbByDate.get(date) ?? [];

    const xlsTotal = xlsBlocks.reduce((s, b) => s + b.total, 0);
    const dbTotal = dbOrders.reduce((s, o) => s + o.total, 0);
    const diff = Math.round(Math.abs(xlsTotal - dbTotal));

    const icon = diff <= 1 ? "✓" : "✗";
    console.log(`${icon} ${date}  Excel: ${xlsBlocks.length} pedidos  $${Math.round(xlsTotal).toLocaleString("es-AR").padStart(12)}   DB: ${dbOrders.length} pedidos  $${Math.round(dbTotal).toLocaleString("es-AR").padStart(12)}${diff > 1 ? `   DIFF=$${diff.toLocaleString("es-AR")}` : ""}`);

    // Detalle si hay diferencia o pedidos sin remito en DB
    const hasNoRemito = dbOrders.some(o => o.remito === null && o.itemCount > 0);
    if (diff > 1 || hasNoRemito) {
      for (const b of xlsBlocks) {
        console.log(`    XLS: ${b.name.padEnd(42)} $${Math.round(b.total).toLocaleString("es-AR")}`);
      }
      for (const o of dbOrders) {
        const rtoStr = o.remito ? `rto=${o.remito}` : "sin-rto";
        console.log(`    DB:  ${o.name.padEnd(42)} $${Math.round(o.total).toLocaleString("es-AR")}  id=${o.id}  ${rtoStr}  items=${o.itemCount}`);
      }
      totalXlsDiff++;
      console.log();
    }
  }

  console.log();
  console.log(`Días con diferencia: ${totalXlsDiff} de ${daySheets.length}`);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
