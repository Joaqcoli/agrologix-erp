/**
 * sync-cc-opening-balances.ts
 *
 * Lee la pestaña "CUENTAS CORRIENTES ABRIL" del Excel,
 * compara el "SALDO DE MARZO" por cliente con lo que calcula el sistema,
 * y ajusta opening_balance para que coincidan exactamente.
 *
 * El sistema calcula:
 *   saldo_pre_abril = opening_balance + facturacion_antes_abril - cobranza_antes_abril - retenciones_antes_abril
 *
 * Para que saldo_pre_abril = excel_saldo:
 *   new_opening_balance = excel_saldo - fact_before + cob_before + ret_before
 *
 * Uso:
 *   npx tsx scripts/sync-cc-opening-balances.ts           ← muestra diferencias
 *   npx tsx scripts/sync-cc-opening-balances.ts --apply   ← aplica cambios
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

// ─── Aliases Excel → DB ───────────────────────────────────────────────────────
const ALIASES: Record<string, string> = {
  "A.U.P.A.":                 "AUPA",
  "FV S.A.":                  "FV",
  "FV S.A":                   "FV",
  "PAULA CASEROS":            "PAULA CASERO",
  "FABRIC - MORENO":          "FABRIC SUSHI - GORRITI",
  "FABRIC SUSHI":             "FABRIC SUSHI - GORRITI",
  "CARLOTA VIANDAS":          "CARLOTA CARAF",
  "CARLOTA CARAF VIANDAS":    "CARLOTA CARAF",
  "LUSQTOFF - IRALA":         "LUSQTOFF - SEDE IRALA",
  "LUSQTOFF - MORENO":        "LUSQTOFF - SEDE MORENO",
  "UNIVERSIDAD DE MORENO":    "UNIVERSIDAD MORENO",
  "CAFE MARTINEZ - MORENO CENTRO":  "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - GORRITI",
  "RAKUS CAFE - PADUA":       "RAKUS CAFE",
  "S&T CATERING":             "S&T CATERING",
};

// Clientes que no existen en el sistema (solo en Excel como referencia)
const SKIP_NAMES = new Set([
  "FERIADO CANTINA", "CONTADO", "LAS BRISAS", "HOGAR SAN MARINO",
  "HOWARD JOHNSON", "NORTH SIDE", "ROSSO RISTORANTE", "AL ESTRIBO",
  "CLIENTE", // encabezado
]);

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
  const s = String(cell.v ?? "").replace(/\$|,/g, "").trim();
  return parseFloat(s) || 0;
}

async function main() {
  await pool.query("SELECT 1");
  console.log("✓ DB conectada\n");

  // ─── Leer Excel ─────────────────────────────────────────────────────────────
  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames.find((n: string) => /CUENTAS CORRIENTES ABRIL/i.test(n));
  if (!sheetName) throw new Error("No se encontró la pestaña CUENTAS CORRIENTES ABRIL");

  const sheet = wb.Sheets[sheetName];
  const range = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;

  // Parsear: col A = cliente, col B = saldo marzo
  const xlsEntries: { name: string; saldoMarzo: number }[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const name = cellStr(sheet, 0, r);
    if (!name || SKIP_NAMES.has(name.toUpperCase())) continue;
    // Filas de totales/resumen (col A vacía o numérica)
    if (!isNaN(parseFloat(name))) continue;
    // Filas que no son clientes (VENTA ACUMULADA, etc.)
    if (/venta|ganancia|semana|promedio|total/i.test(name)) continue;

    const saldoMarzo = cellNum(sheet, 1, r);
    xlsEntries.push({ name: name.trim(), saldoMarzo });
  }

  console.log(`Leídos ${xlsEntries.length} clientes del Excel\n`);

  // ─── Cargar clientes de DB ────────────────────────────────────────────────
  const custR = await pool.query(`
    SELECT c.id, c.name, c.opening_balance::numeric as ob,
           COALESCE(SUM(CASE WHEN o.order_date::date < '2026-04-01' THEN o.total::numeric ELSE 0 END),0) AS fact_before,
           COALESCE((SELECT SUM(p2.amount::numeric) FROM payments p2
                     WHERE p2.customer_id = c.id AND p2.date::date < '2026-04-01'
                       AND UPPER(COALESCE(p2.method,'')) NOT LIKE '%RETEN%'), 0) AS cob_before,
           COALESCE((SELECT SUM(p2.amount::numeric) FROM payments p2
                     WHERE p2.customer_id = c.id AND p2.date::date < '2026-04-01'
                       AND UPPER(COALESCE(p2.method,'')) LIKE '%RETEN%'), 0) AS ret_before,
           COALESCE((SELECT SUM(w.amount::numeric) FROM withholdings w
                     WHERE w.customer_id = c.id AND w.date::date < '2026-04-01'), 0) AS with_before
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'approved'
    WHERE c.active = true
    GROUP BY c.id, c.name, c.opening_balance
    ORDER BY c.name
  `);

  const dbMap = new Map<string, { id: number; ob: number; factBefore: number; cobBefore: number; retBefore: number; withBefore: number; saldo: number }>();
  for (const row of custR.rows) {
    const ob = parseFloat(row.ob);
    const fact = parseFloat(row.fact_before);
    const cob = parseFloat(row.cob_before);
    const ret = parseFloat(row.ret_before);
    const wit = parseFloat(row.with_before);
    dbMap.set(row.name.toUpperCase(), {
      id: row.id,
      ob, factBefore: fact, cobBefore: cob, retBefore: ret + wit,
      saldo: Math.round(ob + fact - cob - ret - wit),
    });
  }

  // ─── Comparar y preparar updates ─────────────────────────────────────────
  const updates: { id: number; name: string; excelSaldo: number; sistemaSaldo: number; currentOb: number; newOb: number }[] = [];
  const notFound: string[] = [];
  let matches = 0;

  console.log("═".repeat(100));
  console.log("COMPARACIÓN SALDO MARZO: Excel vs Sistema");
  console.log("═".repeat(100));
  console.log(
    "  CLIENTE".padEnd(42) +
    "EXCEL SALDO MARZO".padStart(20) +
    "SISTEMA SALDO".padStart(18) +
    "DIFERENCIA".padStart(14)
  );
  console.log("─".repeat(100));

  for (const entry of xlsEntries) {
    const aliased = ALIASES[entry.name.toUpperCase()] ?? entry.name;
    const dbRow = dbMap.get(aliased.toUpperCase());

    if (!dbRow) {
      notFound.push(entry.name);
      continue;
    }

    const excelRounded = Math.round(entry.saldoMarzo);
    const diff = excelRounded - dbRow.saldo;

    const icon = Math.abs(diff) <= 1 ? "✓" : "✗";
    console.log(
      `  ${icon} ${aliased.padEnd(40)}` +
      `${String("$" + Math.round(entry.saldoMarzo).toLocaleString("es-AR")).padStart(20)}` +
      `${String("$" + dbRow.saldo.toLocaleString("es-AR")).padStart(18)}` +
      `${diff !== 0 ? String((diff >= 0 ? "+" : "") + diff.toLocaleString("es-AR")).padStart(14) : "".padStart(14)}`
    );

    if (Math.abs(diff) > 1) {
      // new_ob = excel_saldo - fact_before + cob_before + ret_before
      const newOb = entry.saldoMarzo - dbRow.factBefore + dbRow.cobBefore + dbRow.retBefore;
      updates.push({
        id: dbRow.id,
        name: aliased,
        excelSaldo: excelRounded,
        sistemaSaldo: dbRow.saldo,
        currentOb: dbRow.ob,
        newOb: Math.round(newOb * 100) / 100, // 2 decimales
      });
    } else {
      matches++;
    }
  }

  console.log("─".repeat(100));
  console.log(`\n  ✓ Coinciden     : ${matches}`);
  console.log(`  ✗ Difieren      : ${updates.length}`);
  if (notFound.length > 0) console.log(`  ? No encontrados: ${notFound.join(", ")}`);

  if (updates.length === 0) {
    console.log("\n✅ Todo el sistema ya coincide con el Excel. Sin cambios necesarios.");
    await pool.end();
    return;
  }

  console.log("\n─── AJUSTES A APLICAR ────────────────────────────────────────────────────────");
  for (const u of updates) {
    console.log(
      `  ${u.name.padEnd(40)}  ` +
      `ob_actual=$${Math.round(u.currentOb).toLocaleString("es-AR").padStart(12)}  ` +
      `ob_nuevo=$${Math.round(u.newOb).toLocaleString("es-AR").padStart(12)}  ` +
      `(saldo: $${u.sistemaSaldo.toLocaleString("es-AR")} → $${u.excelSaldo.toLocaleString("es-AR")})`
    );
  }

  if (!APPLY) {
    console.log("\n⚠  DRY-RUN — para aplicar: npx tsx scripts/sync-cc-opening-balances.ts --apply");
    await pool.end();
    return;
  }

  console.log("\nAplicando...");
  for (const u of updates) {
    await pool.query("UPDATE customers SET opening_balance=$1 WHERE id=$2", [u.newOb, u.id]);
    console.log(`  ✓ ${u.name} → opening_balance=${u.newOb.toFixed(2)}`);
  }

  console.log("\n✅ Listo. Los saldos de inicio de abril en el sistema coinciden con el Excel.");
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
