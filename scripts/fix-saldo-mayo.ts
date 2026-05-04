/**
 * fix-saldo-mayo.ts
 *
 * Replica EXACTA del cálculo getCCSummary('2026-04-01','2026-05-01') de storage.ts
 * y ajusta opening_balance para que el saldo transferido a mayo coincida con Excel.
 *
 * Uso:
 *   npx tsx scripts/fix-saldo-mayo.ts           ← dry-run, muestra diferencias
 *   npx tsx scripts/fix-saldo-mayo.ts --apply   ← aplica ajustes
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

const APPLY = process.argv.includes("--apply");
const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

// ─── Excel alias map → DB parent name ───────────────────────────────────────
const XLS_TO_DB: Record<string, string> = {
  "A.U.P.A.": "AUPA",
  "FV S.A.": "FV", "FV S.A": "FV",
  "PAULA CASEROS": "PAULA CASERO",
  "FABRIC - MORENO": "FABRIC SUSHI - GORRITI",
  "FABRIC SUSHI": "FABRIC SUSHI - GORRITI",
  "CARLOTA VIANDAS": "CARLOTA CARAF",
  "CARLOTA CARAF VIANDAS": "CARLOTA CARAF",
  // LUSQTOFF: Excel tiene IRALA y MORENO separados → mismo padre LUSQTOFF
  "LUSQTOFF - IRALA": "LUSQTOFF",
  "LUSQTOFF - MORENO": "LUSQTOFF",
  "UNIVERSIDAD DE MORENO": "UNIVERSIDAD MORENO",
  "CAFE MARTINEZ - MORENO CENTRO": "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - GORRITI",
  "RAKUS CAFE - PADUA": "RAKUS CAFE",
};

const SKIP = new Set([
  "FERIADO CANTINA", "CONTADO", "LAS BRISAS", "HOGAR SAN MARINO",
  "HOWARD JOHNSON", "NORTH SIDE", "ROSSO RISTORANTE", "AL ESTRIBO", "CLIENTE",
]);

function cellStr(sheet: any, c: number, r: number): string {
  const cell = sheet[(XLSX as any).utils.encode_cell({ c, r })];
  return cell ? String(cell.v ?? "").trim() : "";
}
function cellNum(sheet: any, c: number, r: number): number {
  const cell = sheet[(XLSX as any).utils.encode_cell({ c, r })];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseFloat(String(cell.v ?? "").replace(/\$|,/g, "")) || 0;
}

// IVA rates — same as storage.ts
function ivaRate(productName: string, productCategory: string): number {
  const n = productName.toUpperCase();
  const cat = productCategory.toUpperCase();
  if (n.includes("HUEVO") || n.includes("MAPLE") || cat.includes("HUEVO")) return 0.21;
  return 0.105;
}

async function main() {
  await pool.query("SELECT 1");
  console.log("✓ DB conectada\n");

  // ─── Leer Excel ─────────────────────────────────────────────────────────────
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames.find((n: string) => /CUENTAS CORRIENTES ABRIL/i.test(n));
  if (!sheetName) throw new Error("No se encontró la pestaña CUENTAS CORRIENTES ABRIL");

  const sheet = wb.Sheets[sheetName];
  const maxRow = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1").e.r;

  // Acumular saldos Excel por padre (LUSQTOFF-IRALA + LUSQTOFF-MORENO → LUSQTOFF)
  const xlsByParent = new Map<string, number>(); // UPPER(parentName) → saldo
  for (let r = 0; r <= maxRow; r++) {
    const name = cellStr(sheet, 0, r);
    if (!name || SKIP.has(name.toUpperCase())) continue;
    if (!isNaN(parseFloat(name))) continue;
    if (/venta|ganancia|semana|promedio|total/i.test(name)) continue;
    const saldo = cellNum(sheet, 5, r);
    const dbParent = (XLS_TO_DB[name.toUpperCase()] ?? name).toUpperCase();
    xlsByParent.set(dbParent, (xlsByParent.get(dbParent) ?? 0) + saldo);
  }

  // ─── Cargar clientes ─────────────────────────────────────────────────────
  const custR = await pool.query(`
    SELECT id, name, opening_balance::numeric AS ob, parent_customer_id, has_iva
    FROM customers WHERE active = true
  `);
  const allCusts = custR.rows.map(r => ({
    id: +r.id,
    name: r.name as string,
    ob: parseFloat(r.ob),
    parentId: r.parent_customer_id ? +r.parent_customer_id : null,
    hasIva: r.has_iva as boolean,
  }));
  const custById = new Map(allCusts.map(c => [c.id, c]));
  const childToParent = new Map<number, number>();
  for (const c of allCusts) {
    if (c.parentId != null) childToParent.set(c.id, c.parentId);
  }
  const effectiveId = (id: number) => childToParent.get(id) ?? id;

  // ─── Cargar order items (exacto como _getApprovedItems) ──────────────────
  // Items en abril
  const itemsInR = await pool.query(`
    SELECT o.customer_id::int AS "customerId",
           oi.quantity::numeric AS qty,
           oi.price_per_unit::numeric AS ppu,
           COALESCE(p.name, oi.raw_product_name, '') AS "productName",
           COALESCE(p.category, '') AS "productCategory"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'approved'
      AND o.order_date >= '2026-04-01'::date
      AND o.order_date < '2026-05-01'::date
  `);

  // Items antes de abril
  const itemsBeforeR = await pool.query(`
    SELECT o.customer_id::int AS "customerId",
           oi.quantity::numeric AS qty,
           oi.price_per_unit::numeric AS ppu,
           COALESCE(p.name, oi.raw_product_name, '') AS "productName",
           COALESCE(p.category, '') AS "productCategory"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'approved'
      AND o.order_date < '2026-04-01'::date
  `);

  // Calcular billing por effectiveId
  const billingIn = new Map<number, number>();
  const billingBefore = new Map<number, number>();

  for (const row of itemsInR.rows) {
    const cust = custById.get(+row.customerId);
    if (!cust) continue;
    const ppu = parseFloat(row.ppu ?? "0");
    if (!ppu) continue;
    const qty = parseFloat(row.qty);
    const rate = cust.hasIva ? 1 + ivaRate(row.productName, row.productCategory) : 1;
    const b = qty * ppu * rate;
    const eid = effectiveId(cust.id);
    billingIn.set(eid, (billingIn.get(eid) ?? 0) + b);
  }
  for (const row of itemsBeforeR.rows) {
    const cust = custById.get(+row.customerId);
    if (!cust) continue;
    const ppu = parseFloat(row.ppu ?? "0");
    if (!ppu) continue;
    const qty = parseFloat(row.qty);
    const rate = cust.hasIva ? 1 + ivaRate(row.productName, row.productCategory) : 1;
    const b = qty * ppu * rate;
    const eid = effectiveId(cust.id);
    billingBefore.set(eid, (billingBefore.get(eid) ?? 0) + b);
  }

  // ─── Cargar pagos — EXACTO como getCCSummary (method='RETENCION') ────────
  // method != 'RETENCION' = cobros normales
  // method = 'RETENCION'  = retenciones
  const payR = await pool.query(`
    SELECT customer_id::int AS cid,
           SUM(CASE WHEN date < '2026-04-01' AND method != 'RETENCION' THEN amount::numeric ELSE 0 END) AS cob_before,
           SUM(CASE WHEN date >= '2026-04-01' AND date < '2026-05-01' AND method != 'RETENCION' THEN amount::numeric ELSE 0 END) AS cob_in,
           SUM(CASE WHEN date < '2026-04-01' AND method = 'RETENCION' THEN amount::numeric ELSE 0 END) AS ret_before,
           SUM(CASE WHEN date >= '2026-04-01' AND date < '2026-05-01' AND method = 'RETENCION' THEN amount::numeric ELSE 0 END) AS ret_in
    FROM payments
    GROUP BY customer_id
  `);

  const cobBeforeMap = new Map<number, number>();
  const cobInMap = new Map<number, number>();
  const retBeforeMap = new Map<number, number>();
  const retInMap = new Map<number, number>();

  for (const row of payR.rows) {
    const eid = effectiveId(+row.cid);
    cobBeforeMap.set(eid, (cobBeforeMap.get(eid) ?? 0) + parseFloat(row.cob_before));
    cobInMap.set(eid, (cobInMap.get(eid) ?? 0) + parseFloat(row.cob_in));
    retBeforeMap.set(eid, (retBeforeMap.get(eid) ?? 0) + parseFloat(row.ret_before));
    retInMap.set(eid, (retInMap.get(eid) ?? 0) + parseFloat(row.ret_in));
  }

  // ─── Calcular saldo por padre (igual que getCCSummary) ───────────────────
  const parents = allCusts.filter(c => c.parentId === null);
  const sysMap = new Map<string, { id: number; ob: number; saldo: number }>();
  let sysTotal = 0;

  for (const p of parents) {
    const openingBalance = p.ob + allCusts.filter(c => c.parentId === p.id).reduce((s, c) => s + c.ob, 0);
    const facturacionBefore = billingBefore.get(p.id) ?? 0;
    const cobBefore = cobBeforeMap.get(p.id) ?? 0;
    const retBefore = retBeforeMap.get(p.id) ?? 0;
    const saldoMesAnterior = openingBalance + facturacionBefore - cobBefore - retBefore;

    const facturacion = billingIn.get(p.id) ?? 0;
    const cobIn = cobInMap.get(p.id) ?? 0;
    const retIn = retInMap.get(p.id) ?? 0;
    const saldo = Math.round(saldoMesAnterior + facturacion - cobIn - retIn);

    sysMap.set(p.name.toUpperCase(), { id: p.id, ob: p.ob, saldo });
    sysTotal += saldo;
  }

  // ─── Totales ─────────────────────────────────────────────────────────────
  let xlsTotal = 0;
  for (const v of xlsByParent.values()) xlsTotal += v;

  console.log(`Excel total saldo mayo:  $${Math.round(xlsTotal).toLocaleString("es-AR")}`);
  console.log(`Sistema total saldo:     $${sysTotal.toLocaleString("es-AR")}`);
  console.log(`Diferencia (sys-xls):    $${(sysTotal - Math.round(xlsTotal)).toLocaleString("es-AR")}\n`);

  // ─── Comparar cliente a cliente ──────────────────────────────────────────
  console.log("═".repeat(90));
  console.log("  " + "CLIENTE".padEnd(38) + "EXCEL SALDO".padStart(16) + "SISTEMA SALDO".padStart(16) + "DIFERENCIA".padStart(14));
  console.log("─".repeat(90));

  const allKeys = new Set([...xlsByParent.keys(), ...sysMap.keys()]);
  const rows: { key: string; displayName: string; xls: number; sys: number; id: number; currentOb: number }[] = [];

  for (const key of allKeys) {
    const xls = Math.round(xlsByParent.get(key) ?? 0);
    const sysEntry = sysMap.get(key);
    const sys = sysEntry?.saldo ?? 0;
    if (xls === 0 && sys === 0) continue;
    const displayName = parents.find(p => p.name.toUpperCase() === key)?.name ?? key;
    rows.push({ key, displayName, xls, sys, id: sysEntry?.id ?? 0, currentOb: sysEntry?.ob ?? 0 });
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const updates: { id: number; name: string; xlsSaldo: number; sysSaldo: number; diff: number; currentOb: number; newOb: number }[] = [];

  for (const row of rows) {
    const diff = row.sys - row.xls;
    const icon = Math.abs(diff) <= 1 ? "✓" : "✗";
    const diffStr = Math.abs(diff) > 1 ? (diff > 0 ? "+" : "") + diff.toLocaleString("es-AR") : "";
    console.log(
      `  ${icon} ${row.displayName.padEnd(38)}` +
      `${"$" + row.xls.toLocaleString("es-AR")}`.padStart(16) +
      `${"$" + row.sys.toLocaleString("es-AR")}`.padStart(16) +
      diffStr.padStart(14)
    );
    if (Math.abs(diff) > 1 && row.id > 0) {
      // Ajuste: new_ob = current_ob - diff (restar el exceso del sistema)
      const newOb = Math.round((row.currentOb - diff) * 100) / 100;
      updates.push({ id: row.id, name: row.displayName, xlsSaldo: row.xls, sysSaldo: row.sys, diff, currentOb: row.currentOb, newOb });
    }
  }

  console.log("─".repeat(90));
  console.log(`\n  ✗ Difieren: ${updates.length}   Impacto neto: $${(sysTotal - Math.round(xlsTotal)).toLocaleString("es-AR")}\n`);

  if (updates.length === 0) {
    console.log("✅ Todo coincide con Excel. Sin cambios necesarios.");
    await pool.end();
    return;
  }

  console.log("─── AJUSTES A APLICAR ────────────────────────────────────────────────────────");
  for (const u of updates) {
    console.log(
      `  ${u.name.padEnd(42)}` +
      `  ob_actual=$${Math.round(u.currentOb).toLocaleString("es-AR").padStart(12)}` +
      `  ob_nuevo=$${Math.round(u.newOb).toLocaleString("es-AR").padStart(12)}` +
      `  (saldo: $${u.sysSaldo.toLocaleString("es-AR")} → $${u.xlsSaldo.toLocaleString("es-AR")})`
    );
  }

  if (!APPLY) {
    console.log("\n⚠  DRY-RUN — para aplicar: npx tsx scripts/fix-saldo-mayo.ts --apply");
    await pool.end();
    return;
  }

  console.log("\nAplicando...");
  for (const u of updates) {
    await pool.query("UPDATE customers SET opening_balance=$1 WHERE id=$2", [u.newOb, u.id]);
    console.log(`  ✓ ${u.name} → opening_balance=${u.newOb.toFixed(2)}`);
  }

  console.log("\n✅ Listo. Saldo traslado a mayo ahora coincide con Excel.");
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
