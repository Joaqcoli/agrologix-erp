/**
 * Replica EXACTAMENTE el cálculo del sistema (con rollup padre←hijos)
 * y compara con el Excel CUENTAS CORRIENTES ABRIL col SALDO.
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

const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

// Nombres del Excel → nombre del padre en DB
const XLS_TO_DB_PARENT: Record<string, string> = {
  "A.U.P.A.": "AUPA",
  "FV S.A.": "FV", "FV S.A": "FV",
  "PAULA CASEROS": "PAULA CASERO",
  "FABRIC - MORENO": "FABRIC SUSHI - GORRITI",
  "CARLOTA VIANDAS": "CARLOTA CARAF",
  "CARLOTA CARAF VIANDAS": "CARLOTA CARAF",
  // LUSQTOFF: el Excel muestra IRALA y MORENO separados, pero el sistema los combina bajo LUSQTOFF
  "LUSQTOFF - IRALA": "LUSQTOFF",
  "LUSQTOFF - MORENO": "LUSQTOFF",   // MORENO va al mismo padre → se suma
  "UNIVERSIDAD DE MORENO": "UNIVERSIDAD MORENO",
  "CAFE MARTINEZ - MORENO CENTRO": "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - GORRITI",
  "RAKUS CAFE - PADUA": "RAKUS CAFE",
};

const SKIP = new Set(["FERIADO CANTINA","CONTADO","LAS BRISAS","HOGAR SAN MARINO",
  "HOWARD JOHNSON","NORTH SIDE","ROSSO RISTORANTE","AL ESTRIBO","CLIENTE"]);

function cellStr(s: any, c: number, r: number): string {
  const cell = s[(XLSX as any).utils.encode_cell({ c, r })];
  return cell ? String(cell.v ?? "").trim() : "";
}
function cellNum(s: any, c: number, r: number): number {
  const cell = s[(XLSX as any).utils.encode_cell({ c, r })];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseFloat(String(cell.v ?? "").replace(/\$|,/g, "")) || 0;
}

async function main() {
  await pool.query("SELECT 1");

  // ─── Leer Excel ────────────────────────────────────────────────────────────
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames.find((n: string) => /CUENTAS CORRIENTES ABRIL/i.test(n))!;
  const sheet = wb.Sheets[sheetName];
  const maxRow = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1").e.r;

  // Acumular saldos Excel por nombre de PADRE en DB
  const xlsByParent = new Map<string, number>(); // parentName(upper) → saldo
  for (let r = 0; r <= maxRow; r++) {
    const name = cellStr(sheet, 0, r);
    if (!name || SKIP.has(name.toUpperCase())) continue;
    if (!isNaN(parseFloat(name))) continue;
    if (/venta|ganancia|semana|promedio|total/i.test(name)) continue;
    const saldo = cellNum(sheet, 5, r);
    const dbParent = (XLS_TO_DB_PARENT[name.toUpperCase()] ?? name).toUpperCase();
    xlsByParent.set(dbParent, (xlsByParent.get(dbParent) ?? 0) + saldo);
  }

  // ─── Calcular saldo del sistema por PADRE (igual que storage.ts) ──────────
  // Traer todos los clientes activos
  const custR = await pool.query(`
    SELECT id, name, opening_balance::numeric as ob, parent_customer_id
    FROM customers WHERE active = true
  `);
  const allCusts = custR.rows.map(r => ({
    id: +r.id, name: r.name as string,
    ob: parseFloat(r.ob), parentId: r.parent_customer_id ? +r.parent_customer_id : null,
  }));

  // effectiveId: si tiene padre, usar id del padre
  const effectiveId = (id: number) => allCusts.find(c => c.id === id)?.parentId ?? id;

  // Todos los pedidos aprobados (all-time, solo hasta fines de abril)
  const ordersR = await pool.query(`
    SELECT o.customer_id::int, o.total::numeric as total
    FROM orders o
    WHERE o.status='approved'
      AND o.order_date::date <= '2026-04-30'
  `);
  const factMap = new Map<number, number>();
  for (const row of ordersR.rows) {
    const eid = effectiveId(+row.customer_id);
    factMap.set(eid, (factMap.get(eid) ?? 0) + parseFloat(row.total));
  }

  // Pagos (no retenciones)
  const payR = await pool.query(`
    SELECT customer_id::int, amount::numeric as amount
    FROM payments
    WHERE UPPER(COALESCE(method,'')) NOT LIKE '%RETEN%'
      AND date::date <= '2026-04-30'
  `);
  const cobMap = new Map<number, number>();
  for (const row of payR.rows) {
    const eid = effectiveId(+row.customer_id);
    cobMap.set(eid, (cobMap.get(eid) ?? 0) + parseFloat(row.amount));
  }

  // Retenciones (pagos con method RETEN + tabla withholdings)
  const retPayR = await pool.query(`
    SELECT customer_id::int, amount::numeric as amount
    FROM payments
    WHERE UPPER(COALESCE(method,'')) LIKE '%RETEN%'
      AND date::date <= '2026-04-30'
  `);
  const retMap = new Map<number, number>();
  for (const row of retPayR.rows) {
    const eid = effectiveId(+row.customer_id);
    retMap.set(eid, (retMap.get(eid) ?? 0) + parseFloat(row.amount));
  }
  const withR = await pool.query(`
    SELECT customer_id::int, amount::numeric as amount
    FROM withholdings WHERE date::date <= '2026-04-30'
  `);
  for (const row of withR.rows) {
    const eid = effectiveId(+row.customer_id);
    retMap.set(eid, (retMap.get(eid) ?? 0) + parseFloat(row.amount));
  }

  // Calcular saldo por padre (igual que storage.ts)
  const parents = allCusts.filter(c => c.parentId === null);
  const sysMap = new Map<string, { id: number; saldo: number }>();
  let sysTotal = 0;
  for (const p of parents) {
    // ob = ob(parent) + ob(children)
    const ob = p.ob + allCusts.filter(c => c.parentId === p.id).reduce((s, c) => s + c.ob, 0);
    const fact = factMap.get(p.id) ?? 0;
    const cob = cobMap.get(p.id) ?? 0;
    const ret = retMap.get(p.id) ?? 0;
    const saldo = Math.round(ob + fact - cob - ret);
    sysMap.set(p.name.toUpperCase(), { id: p.id, saldo });
    sysTotal += saldo;
  }

  // ─── Comparar ──────────────────────────────────────────────────────────────
  let xlsTotal = 0;
  for (const v of xlsByParent.values()) xlsTotal += v;

  console.log(`Excel total saldo final abril: $${Math.round(xlsTotal).toLocaleString("es-AR")}`);
  console.log(`Sistema total saldo (replica):  $${sysTotal.toLocaleString("es-AR")}`);
  console.log(`Diferencia (sistema - Excel):   $${(sysTotal - Math.round(xlsTotal)).toLocaleString("es-AR")}\n`);

  console.log("═".repeat(90));
  console.log("  " + "CLIENTE (PADRE)".padEnd(38) + "EXCEL SALDO".padStart(16) + "SISTEMA SALDO".padStart(16) + "DIFERENCIA".padStart(14));
  console.log("─".repeat(90));

  const diffs: { id: number; name: string; xlsSaldo: number; sysSaldo: number; diff: number }[] = [];

  // Mostrar todos los padres que tienen algo
  const allKeys = new Set([...xlsByParent.keys(), ...sysMap.keys()]);
  const rows: { nameUpper: string; xls: number; sys: number }[] = [];
  for (const key of allKeys) {
    const xls = xlsByParent.get(key) ?? 0;
    const sysEntry = sysMap.get(key);
    const sys = sysEntry?.saldo ?? 0;
    if (xls === 0 && sys === 0) continue;
    rows.push({ nameUpper: key, xls: Math.round(xls), sys });
  }
  rows.sort((a, b) => a.nameUpper.localeCompare(b.nameUpper));

  for (const row of rows) {
    const diff = row.sys - row.xls;
    const icon = Math.abs(diff) <= 1 ? "✓" : "✗";
    const diffStr = Math.abs(diff) > 1 ? (diff > 0 ? "+" : "") + diff.toLocaleString("es-AR") : "";
    // Mostrar nombre legible
    const sysEntry = sysMap.get(row.nameUpper);
    const displayName = parents.find(p => p.name.toUpperCase() === row.nameUpper)?.name ?? row.nameUpper;
    console.log(
      `  ${icon} ${displayName.padEnd(38)}` +
      `${("$" + row.xls.toLocaleString("es-AR")).padStart(16)}` +
      `${("$" + row.sys.toLocaleString("es-AR")).padStart(16)}` +
      `${diffStr.padStart(14)}`
    );
    if (Math.abs(diff) > 1 && sysEntry) {
      diffs.push({ id: sysEntry.id, name: displayName, xlsSaldo: row.xls, sysSaldo: row.sys, diff });
    }
  }
  console.log("─".repeat(90));

  const totalDiff = sysTotal - Math.round(xlsTotal);
  console.log(`\n  ✗ Difieren: ${diffs.length}   Impacto neto: $${totalDiff.toLocaleString("es-AR")}\n`);

  for (const d of diffs) {
    console.log(`  ${d.name}: sistema $${(d.diff > 0 ? "+" : "") + d.diff.toLocaleString("es-AR")} vs Excel`);
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
