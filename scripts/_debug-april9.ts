/**
 * Muestra detalle completo del 9/04: qué lee el Excel y qué hay en la DB.
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

function cellRaw(sheet: any, col: number, row: number): string {
  const addr = (XLSX as any).utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return "";
  return JSON.stringify({ t: cell.t, v: cell.v, w: cell.w });
}

async function main() {
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });

  // Buscar hoja 09-04-2026
  const sheetName = wb.SheetNames.find((n: string) => n.trim() === "09-04-2026");
  if (!sheetName) {
    console.log("No se encontró hoja '09-04-2026'. Hojas disponibles:");
    console.log(wb.SheetNames.join(", "));
    await pool.end();
    return;
  }

  const sheet = wb.Sheets[sheetName];
  const range = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;

  console.log(`=== EXCEL hoja "${sheetName}" (${maxRow + 1} filas) ===\n`);

  // Dump de filas con contenido
  for (let r = 0; r <= maxRow; r++) {
    const a = cellStr(sheet, 0, r);
    const b = cellStr(sheet, 1, r);
    const c = cellStr(sheet, 2, r);
    const d = cellStr(sheet, 3, r);
    const e = cellStr(sheet, 4, r);
    const eRaw = cellRaw(sheet, 4, r);
    if (a === "" && b === "" && c === "" && d === "" && e === "") continue;
    console.log(`  r${String(r + 1).padStart(3)}: A="${a}"  B="${b}"  C="${c}"  D="${d}"  E="${e}" [${eRaw}]`);
  }

  console.log("\n=== DB - 09/04/2026 ===\n");
  const dbR = await pool.query(`
    SELECT o.id, o.remito_num, o.total::numeric as total,
           c.name as customer
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.order_date::date = '2026-04-09' AND o.status='approved'
    ORDER BY c.name
  `);
  for (const row of dbR.rows) {
    console.log(`  id=${row.id}  rto=${row.remito_num ?? "-"}  ${row.customer.padEnd(40)}  $${Math.round(Number(row.total)).toLocaleString("es-AR")}`);
  }

  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
