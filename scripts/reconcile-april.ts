/**
 * reconcile-april.ts
 *
 * Compara totales Excel vs DB día por día, cliente por cliente.
 * Usa exactamente las mismas funciones de parseo que migrate-data-2026.ts.
 *
 * Uso:
 *   npx tsx scripts/reconcile-april.ts            ← solo muestra diferencias
 *   npx tsx scripts/reconcile-april.ts --fix       ← aplica UPDATE orders.total
 */

import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

// ─── .env ─────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const FIX = process.argv.includes("--fix");
const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

// ─── Aliases (igual que migrate-data-2026.ts + extras para reconciliación) ────
const CLIENT_ALIASES: Record<string, string> = {
  "MARQUESA":           "LA MARQUESA",
  "PAULA":              "PAULA CASERO",
  "PAULA CASEROS":      "PAULA CASERO",
  "FV S.A":             "FV",
  "FV S.A.":            "FV",
  "LUSQTOFF - IRALA":   "LUSQTOFF - SEDE IRALA",
  "LUSQTOFF - MORENO":  "LUSQTOFF - SEDE MORENO",
  "UNIVERSIDAD DE MORENO": "UNIVERSIDAD MORENO",
  "RAKUS":              "RAKUS CAFE",
  "RAKUS CAFE - PADUA": "RAKUS CAFE",
  "CATERING":           "S&T CATERING",
  "ST CATERING":        "S&T CATERING",
  "CARLOTA VIANDAS":    "CARLOTA CARAF VIANDAS",
  "CARLOTA CARAF VIANDAS": "CARLOTA CARAF",   // DB usa nombre corto
  "FABRIC - MORENO":    "FABRIC SUSHI - GORRITI",
  "FABRIC SUSHI":       "FABRIC SUSHI - GORRITI",
  "CAFE MARTINEZ":                  "CAFE MARTINEZ - CAAMAÑO",
  "CAFE MARTINEZ - MORENO CENTRO":  "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - CAAMAÑO",
  "COLEGIO ST CATHERINES MOORLANDS - CARBAJAL 3250": "COLEGIO ST CATHERINES MOORLANDS",
  "COLEGIOS":    "BLACK POT",
  "A.U.P.A.":   "AUPA",
};

// ─── Helpers de parseo (copiados exactos de migrate-data-2026.ts) ─────────────

function parseDateFromSheetName(name: string): string | null {
  const m = name.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseMoney(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(/\$/g, "").trim();
  if (s === "-" || s === "$ -" || s === "$  -" || s === "") return 0;
  // "52.000,00" (punto miles, coma decimal)
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

interface Block {
  customerName: string;
  remitoNum: number | null;
  total: number;
}

const parseWarnings: string[] = [];

// Copia exacta de parseSheet de migrate-data-2026.ts, simplificada para solo leer totales
function parseSheetBlocks(sheet: any, sheetDate: string): Block[] {
  const range = (XLSX as any).utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const blocks: Block[] = [];
  let r = 0;

  const isRto     = (s: string) => /rto\s*[:\-]?\s*\d+/i.test(s);
  const isBareInt = (s: string) => /^\s*\d+\s*$/.test(s);

  while (r <= maxRow) {
    const colA = cellStr(sheet, 0, r);
    const colC = cellStr(sheet, 2, r);
    const colD = cellStr(sheet, 3, r);
    const colE = cellStr(sheet, 4, r);

    const rtoCol =
      isRto(colD)     ? colD :
      isRto(colE)     ? colE :
      isRto(colC)     ? colC :
      isBareInt(colD) ? colD :
      isBareInt(colE) ? colE :
      isBareInt(colC) ? colC : "";

    const colAIsNumeric = !isNaN(parseFloat(colA.replace(",", ".")));

    const isClientHeader =
      colA !== "" &&
      colA.toUpperCase() !== "CANTIDAD" &&
      !colAIsNumeric &&
      rtoCol !== "";

    const isClientHeaderNoRto =
      !isClientHeader &&
      colA !== "" &&
      colA.toUpperCase() !== "CANTIDAD" &&
      !colAIsNumeric &&
      (() => {
        for (let t = r + 1; t <= Math.min(r + 5, maxRow); t++) {
          if (/cantidad/i.test(cellStr(sheet, 0, t))) return true;
        }
        return false;
      })();

    if (!isClientHeader && !isClientHeaderNoRto) { r++; continue; }

    const colB = cellStr(sheet, 1, r);
    const sedeMatch = colB.match(/^SEDE:\s*(.+)/i);
    const customerName = sedeMatch
      ? `${colA.trim()} - ${sedeMatch[1].trim()}`
      : colA.trim();

    const rmitoMatch = rtoCol.match(/rto\s*[:\-]?\s*(\d+)/i);
    const remitoNum: number | null = rmitoMatch
      ? parseInt(rmitoMatch[1])
      : isBareInt(rtoCol) ? parseInt(rtoCol.trim()) : null;
    r++;

    // Buscar fila CANTIDAD
    let titleRow = -1;
    for (let t = r; t <= Math.min(r + 3, maxRow); t++) {
      if (/cantidad/i.test(cellStr(sheet, 0, t))) { titleRow = t; break; }
    }
    if (titleRow === -1) {
      parseWarnings.push(`[${sheetDate}] Sin títulos para "${customerName}" (fila ${r + 1})`);
      r++;
      continue;
    }
    r = titleRow + 1;

    let blockTotal = 0;
    let itemsTotal = 0;

    while (r <= maxRow) {
      if (isRowEmpty(sheet, r)) break;
      const a = cellStr(sheet, 0, r);
      const b = cellStr(sheet, 1, r);
      const c = cellStr(sheet, 2, r);

      if (a === "" && cellNum(sheet, 4, r) !== 0 && c === "" && b === "") {
        blockTotal = cellNum(sheet, 4, r);
        r++; continue;
      }
      if (/^(total|subtotal|suma)/i.test(a)) {
        blockTotal = cellNum(sheet, 4, r);
        r++; continue;
      }

      const qty = parseFloat(a.replace(",", "."));
      if (!isNaN(qty) && qty > 0 && c !== "") {
        itemsTotal += cellNum(sheet, 4, r);
      }
      r++;
    }

    while (r <= maxRow && isRowEmpty(sheet, r)) r++;

    const total = blockTotal > 0 ? blockTotal : itemsTotal;
    if (total > 0) {
      blocks.push({ customerName, remitoNum, total });
    }
  }

  return blocks;
}

// ─── Resolución de nombres (copia exacta de matchBlackPotChild) ───────────────

let allCustomers: { id: number; name: string }[] = [];
let blackPotChildren: { id: number; name: string }[] = [];

async function loadCustomers() {
  const r = await pool.query("SELECT id, name FROM customers WHERE active = true ORDER BY id");
  allCustomers = r.rows;
  const bp = await pool.query("SELECT id FROM customers WHERE UPPER(trim(name))='BLACK POT' LIMIT 1");
  if (bp.rows.length > 0) {
    const bpId = bp.rows[0].id;
    const ch = await pool.query("SELECT id, name FROM customers WHERE parent_customer_id=$1 ORDER BY id", [bpId]);
    blackPotChildren = ch.rows;
  }
}

function matchBlackPotChild(excelName: string): { id: number; name: string } | null {
  if (blackPotChildren.length === 0) return null;
  const upper = excelName.toUpperCase().trim();

  const exact = blackPotChildren.find(c => c.name.toUpperCase() === upper);
  if (exact) return exact;

  const prefixMatches = blackPotChildren.filter(c => {
    const db = c.name.toUpperCase();
    return upper.startsWith(db + " ") || upper.startsWith(db + "-") || upper.startsWith(db + "|");
  });
  if (prefixMatches.length === 1) return prefixMatches[0];

  const stripped = upper.split(" - ")[0].trim();
  const strippedMatches = blackPotChildren.filter(c => {
    const db = c.name.toUpperCase();
    return db.startsWith(stripped) || stripped.startsWith(db);
  });
  if (strippedMatches.length === 1) return strippedMatches[0];

  if (strippedMatches.length > 1) {
    const byLocation = strippedMatches.find(c => {
      const parts = c.name.toUpperCase().split(" | ");
      if (parts.length < 2) return false;
      return upper.includes(parts[parts.length - 1].trim());
    });
    if (byLocation) return byLocation;
    return strippedMatches[0];
  }

  // Palabras significativas (MASTER COLLAGE (OHHIGINS) → COLEGIO MASTER COLLAGE)
  const COMMON = new Set(["COLEGIO", "SAN", "ST", "DE", "DEL", "LA", "LAS", "LOS", "EL"]);
  const wordMatch = blackPotChildren.find(c => {
    const sig = c.name.toUpperCase().split(/\s+/).filter(w => w.length > 3 && !COMMON.has(w));
    return sig.length > 0 && sig.every(w => upper.includes(w));
  });
  return wordMatch ?? null;
}

function resolveCustomer(rawName: string): { id: number; name: string } | null {
  const upper = rawName.toUpperCase().trim();

  // 1. Alias exacto
  const aliased = CLIENT_ALIASES[upper];
  const lookupName = aliased ?? rawName;
  const lookupUpper = lookupName.toUpperCase().trim();

  // 2. Buscar en todos los clientes (exact match)
  const exact = allCustomers.find(c => c.name.toUpperCase().trim() === lookupUpper);
  if (exact) return exact;

  // 3. Intentar BLACK POT child con nombre original (antes de alias)
  const bpChild = matchBlackPotChild(rawName);
  if (bpChild) return bpChild;

  // 4. Alias → BLACK POT child
  if (aliased) {
    const bpChild2 = matchBlackPotChild(aliased);
    if (bpChild2) return bpChild2;
  }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
interface Diff {
  date: string;
  customerRaw: string;
  customerResolved: string;
  customerId: number;
  orderId: number;
  excelTotal: number;
  dbTotal: number;
  diff: number;
}

async function main() {
  await pool.query("SELECT 1");
  console.log("✓ DB conectada\n");
  await loadCustomers();
  console.log(`✓ ${allCustomers.length} clientes, ${blackPotChildren.length} sedes BLACK POT\n`);

  const workbook = (XLSX as any).readFile(FILE_PATH, { cellDates: false, raw: false });
  const daySheets: string[] = workbook.SheetNames.filter((n: string) => parseDateFromSheetName(n) !== null);
  console.log(`📋 ${daySheets.length} hojas de días\n`);

  const diffs: Diff[] = [];
  const notFound: { date: string; raw: string; remitoNum: number | null; excelTotal: number }[] = [];
  const parserAnomalies: { date: string; raw: string; excelTotal: number; dbTotal: number; ratio: number }[] = [];
  let totalOk = 0;

  for (const sheetName of daySheets) {
    const date = parseDateFromSheetName(sheetName)!;
    const sheet = workbook.Sheets[sheetName];
    const blocks = parseSheetBlocks(sheet, date);

    for (const block of blocks) {
      const customer = resolveCustomer(block.customerName);

      if (!customer) {
        notFound.push({ date, raw: block.customerName, remitoNum: block.remitoNum, excelTotal: block.total });
        continue;
      }

      // Buscar en DB: mismo cliente + fecha + remito_num
      let row: { id: number; total: number } | null = null;

      const q1 = await pool.query(
        `SELECT id, total::numeric as total FROM orders
         WHERE customer_id=$1 AND order_date::date=$2::date
           AND remito_num IS NOT DISTINCT FROM $3 AND status='approved'
         ORDER BY id LIMIT 1`,
        [customer.id, date, block.remitoNum ?? null],
      );
      if (q1.rows.length > 0) {
        row = { id: q1.rows[0].id, total: parseFloat(q1.rows[0].total) };
      } else {
        // Fallback: única orden ese día para ese cliente
        const q2 = await pool.query(
          `SELECT id, total::numeric as total FROM orders
           WHERE customer_id=$1 AND order_date::date=$2::date AND status='approved'
           ORDER BY id`,
          [customer.id, date],
        );
        if (q2.rows.length === 1) {
          row = { id: q2.rows[0].id, total: parseFloat(q2.rows[0].total) };
        } else if (q2.rows.length > 1) {
          // Múltiples órdenes sin remito → no podemos saber cuál sin remito_num
          notFound.push({ date, raw: block.customerName, remitoNum: block.remitoNum, excelTotal: block.total });
          continue;
        } else {
          notFound.push({ date, raw: block.customerName, remitoNum: block.remitoNum, excelTotal: block.total });
          continue;
        }
      }

      const diff = Math.round(Math.abs(block.total - row.total));
      if (diff <= 1) {
        totalOk++;
        continue;
      }

      // Detectar anomalías de parseo: Excel < 1% del valor DB → probablemente formato incorrecto
      const ratio = block.total / row.total;
      if (ratio < 0.01) {
        parserAnomalies.push({ date, raw: block.customerName, excelTotal: block.total, dbTotal: row.total, ratio });
        continue;
      }

      diffs.push({
        date,
        customerRaw: block.customerName,
        customerResolved: customer.name,
        customerId: customer.id,
        orderId: row.id,
        excelTotal: block.total,
        dbTotal: row.total,
        diff,
      });
    }
  }

  // ─── Reporte ────────────────────────────────────────────────────────────────
  console.log("═".repeat(72));
  console.log("📊 RECONCILIACIÓN EXCEL vs DB");
  console.log("═".repeat(72));
  console.log(`  ✓ Coinciden         : ${totalOk}`);
  console.log(`  ✗ Difieren (reales) : ${diffs.length}`);
  console.log(`  ⚠ Anomalías parseo  : ${parserAnomalies.length}`);
  console.log(`  ? No encontrados    : ${notFound.length}`);
  console.log();

  if (diffs.length > 0) {
    console.log("─── DIFERENCIAS REALES ──────────────────────────────────────────────");
    let totalImpact = 0;
    for (const d of diffs) {
      const sign = d.excelTotal > d.dbTotal ? "+" : "-";
      console.log(
        `  ${d.date}  ${d.customerResolved.padEnd(38)}` +
        `  Excel:$${String(Math.round(d.excelTotal)).padStart(9)}` +
        `  DB:$${String(Math.round(d.dbTotal)).padStart(9)}` +
        `  (${sign}$${d.diff.toLocaleString("es-AR")})  id=${d.orderId}`,
      );
      totalImpact += (d.excelTotal - d.dbTotal);
    }
    const sign = totalImpact >= 0 ? "+" : "";
    console.log(`\n  Impacto neto: ${sign}$${Math.round(totalImpact).toLocaleString("es-AR")}`);
    console.log();
  }

  if (parserAnomalies.length > 0) {
    console.log("─── ANOMALÍAS DE PARSEO (Excel < 1% del valor DB, ignoradas) ────────");
    for (const a of parserAnomalies) {
      console.log(`  ${a.date}  ${a.raw.padEnd(38)}  Excel:$${Math.round(a.excelTotal)}  DB:$${Math.round(a.dbTotal).toLocaleString("es-AR")}`);
    }
    console.log();
  }

  if (notFound.length > 0) {
    console.log("─── NO ENCONTRADOS EN DB ────────────────────────────────────────────");
    for (const nf of notFound) {
      console.log(`  ${nf.date}  "${nf.raw}"  remito=${nf.remitoNum ?? "–"}  excel=$${Math.round(nf.excelTotal).toLocaleString("es-AR")}`);
    }
    console.log();
  }

  if (parseWarnings.length > 0) {
    console.log("─── WARNINGS PARSER ─────────────────────────────────────────────────");
    for (const w of parseWarnings) console.log(`  ⚠  ${w}`);
    console.log();
  }

  // ─── Aplicar fix ────────────────────────────────────────────────────���───────
  if (FIX && diffs.length > 0) {
    console.log("─── APLICANDO UPDATES ────────────────────────────────────────────────");
    for (const d of diffs) {
      await pool.query("UPDATE orders SET total=$1 WHERE id=$2", [d.excelTotal, d.orderId]);
      console.log(`  ✓ id=${d.orderId}  ${d.customerResolved}  ${d.date}  $${Math.round(d.dbTotal).toLocaleString("es-AR")} → $${Math.round(d.excelTotal).toLocaleString("es-AR")}`);
    }
    const tot = await pool.query(`
      SELECT SUM(total::numeric) as total, COUNT(*) as cnt
      FROM orders
      WHERE order_date >= '2026-04-01' AND order_date < '2026-05-01'
        AND status='approved' AND (notes IS NULL OR notes NOT LIKE '%historica%')
    `);
    console.log(`\n📊 Total abril post-fix: $${Math.round(Number(tot.rows[0].total)).toLocaleString("es-AR")}  (${tot.rows[0].cnt} pedidos)`);
  } else if (!FIX && diffs.length > 0) {
    console.log("→ Para corregir: npx tsx scripts/reconcile-april.ts --fix");
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
