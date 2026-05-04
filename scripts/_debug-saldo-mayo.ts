/**
 * Compara el SALDO FINAL de abril (col F del Excel) vs lo que calcula el sistema.
 * El saldo final = lo que se traslada a mayo.
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

const ALIASES: Record<string, string> = {
  "A.U.P.A.": "AUPA",
  "FV S.A.": "FV", "FV S.A": "FV",
  "PAULA CASEROS": "PAULA CASERO",
  "FABRIC - MORENO": "FABRIC SUSHI - GORRITI",
  "CARLOTA VIANDAS": "CARLOTA CARAF",
  "CARLOTA CARAF VIANDAS": "CARLOTA CARAF",
  "LUSQTOFF - IRALA": "LUSQTOFF - SEDE IRALA",
  "LUSQTOFF - MORENO": "LUSQTOFF - SEDE MORENO",
  "UNIVERSIDAD DE MORENO": "UNIVERSIDAD MORENO",
  "CAFE MARTINEZ - MORENO CENTRO": "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - GORRITI",
  "RAKUS CAFE - PADUA": "RAKUS CAFE",
};

const SKIP = new Set(["FERIADO CANTINA","CONTADO","LAS BRISAS","HOGAR SAN MARINO",
  "HOWARD JOHNSON","NORTH SIDE","ROSSO RISTORANTE","AL ESTRIBO","CLIENTE"]);

function cellStr(sheet: any, c: number, r: number): string {
  const cell = sheet[(XLSX as any).utils.encode_cell({ c, r })];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}
function cellNum(sheet: any, c: number, r: number): number {
  const cell = sheet[(XLSX as any).utils.encode_cell({ c, r })];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseFloat(String(cell.v ?? "").replace(/\$|,/g, "")) || 0;
}

async function main() {
  await pool.query("SELECT 1");

  const wb = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const sheetName = wb.SheetNames.find((n: string) => /CUENTAS CORRIENTES ABRIL/i.test(n))!;
  const sheet = wb.Sheets[sheetName];
  const maxRow = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1").e.r;

  // Leer todas las columnas: A=cliente B=saldoMarzo C=facturacion D=cobranza E=retenciones F=saldo
  interface XlsRow { name: string; saldoMarzo: number; facturacion: number; cobranza: number; retenciones: number; saldo: number }
  const xlsRows: XlsRow[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const name = cellStr(sheet, 0, r);
    if (!name || SKIP.has(name.toUpperCase())) continue;
    if (!isNaN(parseFloat(name))) continue;
    if (/venta|ganancia|semana|promedio|total/i.test(name)) continue;
    xlsRows.push({
      name: name.trim(),
      saldoMarzo: cellNum(sheet, 1, r),
      facturacion: cellNum(sheet, 2, r),
      cobranza: cellNum(sheet, 3, r),
      retenciones: cellNum(sheet, 4, r),
      saldo: cellNum(sheet, 5, r),
    });
  }

  const xlsTotal = xlsRows.reduce((s, x) => s + x.saldo, 0);
  console.log(`Excel total saldo final: $${Math.round(xlsTotal).toLocaleString("es-AR")}`);

  // Sistema: calcular saldo ALL-TIME por cliente (opening + toda facturación - toda cobranza - retenciones)
  const sysR = await pool.query(`
    SELECT c.id, c.name,
           c.opening_balance::numeric AS ob,
           COALESCE(SUM(o.total::numeric), 0) AS fact_total,
           COALESCE((SELECT SUM(p.amount::numeric) FROM payments p
                     WHERE p.customer_id = c.id
                       AND UPPER(COALESCE(p.method,'')) NOT LIKE '%RETEN%'), 0) AS cob_total,
           COALESCE((SELECT SUM(p.amount::numeric) FROM payments p
                     WHERE p.customer_id = c.id
                       AND UPPER(COALESCE(p.method,'')) LIKE '%RETEN%'), 0) AS ret_total,
           COALESCE((SELECT SUM(w.amount::numeric) FROM withholdings w
                     WHERE w.customer_id = c.id), 0) AS with_total
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'approved'
    WHERE c.active = true
    GROUP BY c.id, c.name, c.opening_balance
    ORDER BY c.name
  `);

  const sysMap = new Map<string, { id: number; ob: number; fact: number; cob: number; ret: number; saldo: number }>();
  for (const row of sysR.rows) {
    const ob = +row.ob, fact = +row.fact_total, cob = +row.cob_total, ret = +row.ret_total + +row.with_total;
    sysMap.set(row.name.toUpperCase(), { id: row.id, ob, fact, cob, ret, saldo: Math.round(ob + fact - cob - ret) });
  }

  const sysTotal = [...sysMap.values()].reduce((s, v) => s + v.saldo, 0);
  console.log(`Sistema total saldo: $${Math.round(sysTotal).toLocaleString("es-AR")}`);
  console.log(`Diferencia: $${Math.round(sysTotal - xlsTotal).toLocaleString("es-AR")}\n`);

  // Comparar cliente a cliente
  console.log("═".repeat(110));
  console.log("SALDO FINAL ABRIL (traslado a mayo): Excel vs Sistema");
  console.log("═".repeat(110));
  console.log(
    "  " + "CLIENTE".padEnd(40) +
    "EXCEL SALDO".padStart(14) +
    "SISTEMA SALDO".padStart(16) +
    "DIFERENCIA".padStart(14) +
    "  Excel: fact/cob/ret"
  );
  console.log("─".repeat(110));

  const diffs: { id: number; name: string; xlsSaldo: number; sysSaldo: number; diff: number }[] = [];

  for (const xls of xlsRows) {
    const dbName = ALIASES[xls.name.toUpperCase()] ?? xls.name;
    const sys = sysMap.get(dbName.toUpperCase());
    if (!sys) {
      if (xls.saldo !== 0) console.log(`  ? ${xls.name.padEnd(40)} (no en DB, saldo Excel=$${Math.round(xls.saldo).toLocaleString("es-AR")})`);
      continue;
    }

    const diff = Math.round(sys.saldo - xls.saldo);
    const icon = Math.abs(diff) <= 1 ? "✓" : "✗";
    const diffStr = diff !== 0 ? (diff > 0 ? "+" : "") + diff.toLocaleString("es-AR") : "";
    console.log(
      `  ${icon} ${dbName.padEnd(40)}` +
      `${("$" + Math.round(xls.saldo).toLocaleString("es-AR")).padStart(14)}` +
      `${("$" + sys.saldo.toLocaleString("es-AR")).padStart(16)}` +
      `${diffStr.padStart(14)}` +
      (Math.abs(diff) > 1 ? `  fact=$${Math.round(xls.facturacion).toLocaleString("es-AR")} cob=$${Math.round(xls.cobranza).toLocaleString("es-AR")} ret=$${Math.round(xls.retenciones).toLocaleString("es-AR")}` : "")
    );

    if (Math.abs(diff) > 1) {
      diffs.push({ id: sys.id, name: dbName, xlsSaldo: Math.round(xls.saldo), sysSaldo: sys.saldo, diff });
    }
  }

  console.log("─".repeat(110));
  console.log(`\nClientes con diferencia: ${diffs.length}`);

  if (diffs.length > 0) {
    const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);
    console.log(`Impacto neto: $${totalDiff.toLocaleString("es-AR")}`);
    console.log("\nPara ver detalle de un cliente específico:");
    for (const d of diffs) {
      console.log(`  ${d.name}: sistema tiene $${(d.diff > 0 ? "+" : "")}${d.diff.toLocaleString("es-AR")} vs Excel`);
    }
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
