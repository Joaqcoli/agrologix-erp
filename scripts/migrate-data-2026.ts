/**
 * migrate-data-2026.ts
 *
 * Importa datos históricos 2026 desde attached_assets/info 2026.xlsx
 *
 * Uso:
 *   npx tsx scripts/migrate-data-2026.ts --dry-run   ← solo muestra qué haría
 *   npx tsx scripts/migrate-data-2026.ts             ← ejecuta la migración
 */

import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Pool } from "pg";

// ─── Cargar .env ──────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Args ─────────────────────────────────────────────────────────────────────
const DRY_RUN    = process.argv.includes("--dry-run");
const CC_ONLY    = process.argv.includes("--cc-only");
const DIA_ONLY   = process.argv.includes("--dia-only");
const FIX_REMITO = process.argv.includes("--fix-remito");
const FILE_PATH = path.resolve(process.cwd(), "attached_assets/info 2026.xlsx");

// ─── DB ───────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ParsedItem {
  rawName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  subtotal: number;
  costPerUnit: number;
}

interface ParsedBlock {
  customerName: string;
  remitoNum: number | null;
  orderDate: string;       // ISO: "2026-04-01"
  hasIva: boolean;
  items: ParsedItem[];
  blockTotal: number;
}

interface ParsedPayment {
  customerName: string;
  date: string;            // ISO: "2026-01-31"
  amount: number;
  method: string;          // TRANSFERENCIA | RETENCION
  notes: string;
}

interface ParsedOpeningBalance {
  customerName: string;
  amount: number;
}

interface ParsedHistoricalOrder {
  customerName: string;
  date: string;       // "2026-01-31" / "2026-02-28" / "2026-03-31"
  amount: number;     // facturación del mes
  monthCode: string;  // "ENE" | "FEB" | "MAR"
}

// ─── Constantes ───────────────────────────────────────────────────────────────

// Nombres a saltear en hojas CC (filas de resumen / totales / inactivos)
const CC_SKIP_NAMES = [
  "CONTADO", "TOTAL", "FERIADO CANTINA",
  "1° SEMANA", "2° SEMANA", "3° SEMANA", "4° SEMANA", "5° SEMANA",
  "VENTA DEL MES", "PROMEDIO VENTA X DIA", "PROMEDIO GCIA X DIA",
  "VENTA ACUMULADA", "GANANCIA ACUMULADA",
  "ROSSO RISTORANTE", "NORTH SIDE",
  "LAS BRISAS", "HOWARD JOHNSON", "AL ESTRIBO",
];

// Aliases para normalizar nombres de clientes entre hojas.
// Clave = nombre en MAYÚSCULAS tal como aparece en el Excel.
// Valor = nombre exacto en la DB (o nombre canónico a crear).
const CLIENT_ALIASES: Record<string, string> = {
  // ── Variantes generales ───────────────────────────────────────────────────
  "MARQUESA":           "LA MARQUESA",
  "PAULA":              "PAULA CASERO",
  "PAULA CASEROS":      "PAULA CASERO",
  "FV S.A":             "FV",
  "FV S.A.":            "FV",
  // ── Lusqtoff: sedes en DB tienen prefijo "SEDE:" en col B del Excel ────────
  // El parser ya construye "LUSQTOFF - IRALA" / "LUSQTOFF - MORENO" desde col B.
  // CC usa "LUSQTOFF - IRALA" → mapear a la sede correcta en DB
  "LUSQTOFF - IRALA":   "LUSQTOFF - SEDE IRALA",
  "LUSQTOFF - MORENO":  "LUSQTOFF - SEDE MORENO",
  // "LUSQTOFF" a secas (sin sede) → cliente padre
  // no hay alias: si aparece solo, resuelve directamente a id=89
  // ── Universidad: pedidos dicen "DE MORENO", DB no ────────────────────────
  "UNIVERSIDAD DE MORENO": "UNIVERSIDAD MORENO",
  // ── Rakus: DB tiene "RAKUS CAFE", normalizar todas las variantes ──────────
  "RAKUS":              "RAKUS CAFE",
  "RAKUS CAFE - PADUA": "RAKUS CAFE",
  // ── Catering (Excel dice solo "CATERING") ────────────────────────────────
  "CATERING":           "S&T CATERING",
  // ── Carlota: dos variantes en Excel → un solo cliente nuevo ──────────────
  "CARLOTA VIANDAS":    "CARLOTA CARAF VIANDAS",
  // ── Fabric: dos variantes en Excel → mismo local en DB ───────────────────
  "FABRIC - MORENO":    "FABRIC SUSHI - GORRITI",
  "FABRIC SUSHI":       "FABRIC SUSHI - GORRITI",
  // ── Café Martínez: variantes de dirección en Excel → nombre canónico DB ──
  "CAFE MARTINEZ - MORENO CENTRO":  "CAFE MARTINEZ - MORENO",
  "CAFE MARTINEZ - MORENO GORRITI": "CAFE MARTINEZ - CAAMAÑO",
  // ── Colegios BLACK POT: Excel lleva dirección, DB solo el nombre corto ────
  // (los que ya se resuelven vía matchBlackPotChild() no necesitan alias;
  //  este alias normaliza el nombre del único colegio que se creará nuevo)
  "COLEGIO ST CATHERINES MOORLANDS - CARBAJAL 3250": "COLEGIO ST CATHERINES MOORLANDS",
  // ── CC sheets: filas especiales ──────────────────────────────────────────────
  "COLEGIOS":    "BLACK POT",      // fila resumen BLACK POT en hojas CC
  "ST CATERING": "S&T CATERING",  // variante sin ampersand
  "A.U.P.A.":   "AUPA",           // Excel usa puntos; DB tiene "AUPA" (id=66)
};

const MONTH_MAP: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4,
  MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8,
  SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

// Fecha tope para April en progreso (hoy)
const APRIL_CUT_DATE = "2026-04-09";

// Nombres canónicos de clientes nuevos que deben crearse como hijos de BLACK POT
const BLACKPOT_NEW_CHILDREN = new Set([
  "COLEGIO ST CATHERINES MOORLANDS",
]);

// ─── Caché de hijos de BLACK POT (cargado al inicio) ─────────────────────────
let blackPotChildren: { id: number; name: string }[] = [];
let blackPotParentId: number | null = null;

// ─── Todos los clientes activos de DB (para fuzzy matching) ───────────────────
let allDbCustomers: { id: number; name: string }[] = [];

async function loadAllDbCustomers(): Promise<void> {
  const res = await pool.query("SELECT id, name FROM customers WHERE active = true ORDER BY id");
  allDbCustomers = res.rows;
  console.log(`  ✓ ${allDbCustomers.length} clientes activos cargados para fuzzy matching\n`);
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function strSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function tokenSimilarity(a: string, b: string): number {
  const tokA = new Set(a.split(/\s+/).filter(Boolean));
  const tokB = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  return union === 0 ? 1 : intersection / union;
}

function bestSimilarity(a: string, b: string): number {
  return Math.max(strSimilarity(a, b), tokenSimilarity(a, b));
}

/** Devuelve { id, name, score } del mejor candidato en la DB, o null si no hay ninguno */
function findBestFuzzyMatch(
  name: string,
): { id: number; name: string; score: number } | null {
  const upper = name.toUpperCase().trim();
  let best: { id: number; name: string; score: number } | null = null;
  for (const c of allDbCustomers) {
    const score = bestSimilarity(upper, c.name.toUpperCase().trim());
    if (!best || score > best.score) best = { id: c.id, name: c.name, score };
  }
  return best;
}

// ─── Readline (interactive prompts) ──────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Prompt interactivo cuando hay un candidato fuzzy con 50-79% de similitud.
 * Retorna: { id, name } del cliente a usar (nuevo o existente), o null para crear nuevo.
 */
async function askFuzzyMatch(
  excelName: string,
  candidate: { id: number; name: string; score: number },
): Promise<{ id: number; name: string } | null> {
  const pct = Math.round(candidate.score * 100);
  console.log(`\n  ⚠  Cliente no reconocido: "${excelName}"`);
  console.log(`     Candidato más parecido: "${candidate.name}" (${pct}% similitud)`);
  console.log(`     Opciones:`);
  console.log(`       1. Usar "${candidate.name}"`);
  console.log(`       2. Crear nuevo cliente "${excelName}"`);
  console.log(`       3. Escribir el nombre correcto manualmente`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ans = (await ask("     → Elegí 1, 2 o 3: ")).trim();
    if (ans === "1") {
      console.log(`     ✓ Usando "${candidate.name}" (id=${candidate.id})`);
      return { id: candidate.id, name: candidate.name };
    } else if (ans === "2") {
      console.log(`     ✓ Se creará nuevo cliente "${excelName}"`);
      return null;
    } else if (ans === "3") {
      const manual = (await ask("     → Escribí el nombre exacto (tal como está en DB): ")).trim();
      // Buscar en DB
      const found = allDbCustomers.find(
        (c) => c.name.toUpperCase().trim() === manual.toUpperCase().trim(),
      );
      if (found) {
        console.log(`     ✓ Usando "${found.name}" (id=${found.id})`);
        return { id: found.id, name: found.name };
      }
      console.log(`     ✗ No se encontró "${manual}" en DB. Intentá de nuevo.`);
    } else {
      console.log(`     ✗ Opción inválida. Ingresá 1, 2 o 3.`);
    }
  }
}

async function initBlackPotChildren(): Promise<void> {
  const parentRes = await pool.query(
    "SELECT id FROM customers WHERE UPPER(trim(name)) = 'BLACK POT' LIMIT 1",
  );
  if (parentRes.rows.length === 0) {
    console.log("  ⚠  Cliente BLACK POT no encontrado en DB — se omite resolución de sedes\n");
    return;
  }
  const parentId = parentRes.rows[0].id;
  blackPotParentId = parentId;
  const childRes = await pool.query(
    "SELECT id, name FROM customers WHERE parent_customer_id = $1 ORDER BY id",
    [parentId],
  );
  blackPotChildren = childRes.rows;
  console.log(`  ✓ BLACK POT (id=${parentId}): ${blackPotChildren.length} sedes cargadas`);
  blackPotChildren.forEach((c) => console.log(`    id=${c.id}  "${c.name}"`));
  console.log();
}

/**
 * Intenta asociar un nombre del Excel con un hijo de BLACK POT en la DB.
 *
 * Estrategia (en orden de prioridad):
 *  1. DB name es prefijo del Excel name  → "COLEGIO SJCB" ⊂ "COLEGIO SJCB - VIRREY DEL PINO"
 *  2. Excel name (sin dirección) es prefijo del DB name → handles typos breves
 *  3. Si hay múltiples candidatos con el mismo prefijo, desambigua por la
 *     palabra de localización que aparece después de " | " en el nombre de DB
 *  4. Palabras clave del DB name (no genéricas) todas presentes en Excel name
 *     → "COLEGIO MASTER COLLAGE" ↔ "MASTER COLLAGE (OHHIGINS)"
 */
function matchBlackPotChild(excelName: string): { id: number; name: string } | null {
  if (blackPotChildren.length === 0) return null;
  const upper = excelName.toUpperCase().trim();

  // 1. Exact match (handled earlier, but cheap check)
  const exact = blackPotChildren.find((c) => c.name.toUpperCase() === upper);
  if (exact) return exact;

  // 2. DB name is a prefix of the Excel name
  //    (e.g. DB="COLEGIO SJCB", Excel="COLEGIO SJCB - VIRREY DEL PINO 3299")
  const prefixMatches = blackPotChildren.filter((c) => {
    const db = c.name.toUpperCase();
    return upper.startsWith(db + " ") || upper.startsWith(db + "-") || upper.startsWith(db + "|");
  });
  if (prefixMatches.length === 1) return prefixMatches[0];

  // 3. Strip address from Excel name (before " - ") and try both-direction prefix
  const stripped = upper.split(" - ")[0].trim();
  const strippedMatches = blackPotChildren.filter((c) => {
    const db = c.name.toUpperCase();
    return db.startsWith(stripped) || stripped.startsWith(db);
  });
  if (strippedMatches.length === 1) return strippedMatches[0];

  // 3b. Ambiguous: multiple DB names share the same prefix → disambiguate by
  //     location keyword (word after " | " in DB name) found in full Excel name
  if (strippedMatches.length > 1) {
    const byLocation = strippedMatches.find((c) => {
      const parts = c.name.toUpperCase().split(" | ");
      if (parts.length < 2) return false;
      const location = parts[parts.length - 1].trim();
      return upper.includes(location);
    });
    if (byLocation) return byLocation;
    return strippedMatches[0]; // fallback: first candidate
  }

  // 4. Significant-word overlap: all non-generic words of the DB name appear
  //    in the Excel name (handles "MASTER COLLAGE (OHHIGINS)" ↔ "COLEGIO MASTER COLLAGE")
  const COMMON = new Set(["COLEGIO", "SAN", "ST", "DE", "DEL", "LA", "LAS", "LOS", "EL"]);
  const wordMatch = blackPotChildren.find((c) => {
    const sig = c.name.toUpperCase().split(/\s+/).filter((w) => w.length > 3 && !COMMON.has(w));
    return sig.length > 0 && sig.every((w) => upper.includes(w));
  });
  return wordMatch ?? null;
}

// ─── Contadores ───────────────────────────────────────────────────────────────
let ordersCreated    = 0;
let ordersSkipped    = 0;
let customersCreated = 0;
let productsCreated  = 0;
let paymentsCreated  = 0;
let paymentsSkipped  = 0;
let balancesUpdated  = 0;
let histOrdersCreated = 0;
let histOrdersSkipped = 0;
let remitoFixed      = 0;
let remitoSkipped    = 0;
const warnings: string[] = [];
const errors:   string[] = [];

// ─── Caché de clientes y productos ───────────────────────────────────────────
const customerCache    = new Map<string, number>();   // lower(name) → id
const productCache     = new Map<string, number>();   // lower(name) → id
const customerFolioMap = new Map<number, number>();   // customerId → max VA folio num (legacy, no usado)
let globalFolioCounter = 0;  // contador global VA (único globalmente)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte cualquier valor monetario a número */
function parseMoney(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(/\$/g, "").trim();
  if (s === "-" || s === "$ -" || s === "$  -" || s === "") return 0;
  // "52.000,00" (punto miles, coma decimal) → 52000
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return parseFloat(s.replace(/\./g, "").replace(",", "."));
  }
  const clean = s.replace(/,/g, "");
  return parseFloat(clean) || 0;
}

/** Normaliza texto de unidad a valores aceptados por la DB */
function normalizeUnit(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (["CAJÓN", "CAJON", "CAJA", "CAJAS", "CAJONES"].includes(u)) return "CAJON";
  if (["KG", "KGS", "KILO", "KILOS"].includes(u)) return "KG";
  if (["BOLSA", "BOLSAS", "SACO", "SACOS"].includes(u)) return "BOLSA";
  if (["UNIDAD", "UNIDADES", "UN", "UNI"].includes(u)) return "UNIDAD";
  if (["ATADO", "ATADOS"].includes(u)) return "ATADO";
  if (["LITRO", "LITROS", "LT", "LTS"].includes(u)) return "LITRO";
  if (["TONELADA", "TON", "TONS"].includes(u)) return "TONELADA";
  if (["MAPLE", "MAPLES"].includes(u)) return "MAPLE";
  if (["BANDEJA", "BANDEJAS"].includes(u)) return "BANDEJA";
  if (["PZ", "PZA", "PIEZA", "PIEZAS"].includes(u)) return "PZ";
  return u;
}

/** "01-04-2026 " → "2026-04-01" */
function parseDateFromSheetName(name: string): string | null {
  const m = name.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function cellStr(sheet: XLSX.WorkSheet, col: number, row: number): string {
  const addr = XLSX.utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

function cellNum(sheet: XLSX.WorkSheet, col: number, row: number): number {
  const addr = XLSX.utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseMoney(cell.v);
}

function isRowEmpty(sheet: XLSX.WorkSheet, row: number): boolean {
  for (let c = 0; c <= 10; c++) {
    const addr = XLSX.utils.encode_cell({ c, r: row });
    if (sheet[addr] && String(sheet[addr].v ?? "").trim() !== "") return false;
  }
  return true;
}

// ─── Parser de hoja de día ────────────────────────────────────────────────────
/**
 * Estructura de cada bloque en hojas de día:
 *   fila 1: col A = nombre cliente [+ " - dirección"]  col D = "rto: XX"  col E = fecha
 *   fila 2: CANTIDAD | UNIDAD | PRODUCTO | PRECIO | TOTAL | TOTAL+IVA | … | COSTO
 *   filas 3+: qty | unit | producto | precio | subtotal | … | costo
 *   fila N: vacío o None,None,None,None,total_block
 */
function parseSheet(sheet: XLSX.WorkSheet, sheetDate: string): ParsedBlock[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const blocks: ParsedBlock[] = [];
  let r = 0;

  while (r <= maxRow) {
    const colA = cellStr(sheet, 0, r);
    const colC = cellStr(sheet, 2, r); // formato clientes con IVA (colegios, cafés)
    const colD = cellStr(sheet, 3, r); // formato habitual
    const colE = cellStr(sheet, 4, r); // formato colegios (legacy)

    // "rto: <número>" estricto para evitar falsos positivos (ej. "PORTOBELLO" contiene "rto")
    const isRto     = (s: string) => /rto\s*[:\-]?\s*\d+/i.test(s);
    // Número entero puro en la celda (sin texto "rto:")
    const isBareInt = (s: string) => /^\s*\d+\s*$/.test(s);

    // Detectar encabezado de cliente: col A no vacío, no "CANTIDAD",
    // y "rto: N" (o número puro) aparece en col D, E o C
    const rtoCol =
      isRto(colD)     ? colD :
      isRto(colE)     ? colE :
      isRto(colC)     ? colC :
      isBareInt(colD) ? colD :
      isBareInt(colE) ? colE :
      isBareInt(colC) ? colC : "";

    // col A debe no ser numérica (descarta filas de ítems donde qty queda en col A)
    const colAIsNumeric = !isNaN(parseFloat(colA.replace(",", ".")));

    const isClientHeader =
      colA !== "" &&
      colA.toUpperCase() !== "CANTIDAD" &&
      !colAIsNumeric &&
      rtoCol !== "";

    // Caso especial: cliente sin número de remito (ej. MUNCHIS).
    // Detectamos por lookahead: col A no numérica Y fila CANTIDAD sigue en ≤5 filas.
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

    if (!isClientHeader && !isClientHeaderNoRto) {
      r++;
      continue;
    }

    // Si col B contiene "SEDE: XXXX", construir nombre compuesto
    // Ej. colA="LUSQTOFF"  colB="SEDE: IRALA"  → "LUSQTOFF - IRALA"
    const colB = cellStr(sheet, 1, r);
    const sedeMatch = colB.match(/^SEDE:\s*(.+)/i);
    const customerName = sedeMatch
      ? `${colA.trim()} - ${sedeMatch[1].trim()}`
      : colA.trim();

    // Extraer número de remito: desde "rto: 18" o desde número puro "18"
    const rmitoMatch = rtoCol.match(/rto\s*[:\-]?\s*(\d+)/i);
    const remitoNum: number | null = rmitoMatch
      ? parseInt(rmitoMatch[1])
      : isBareInt(rtoCol) ? parseInt(rtoCol.trim()) : null;
    r++;

    // Buscar fila de títulos (contiene CANTIDAD en col A)
    let titleRow = -1;
    for (let t = r; t <= Math.min(r + 3, maxRow); t++) {
      if (/cantidad/i.test(cellStr(sheet, 0, t))) {
        titleRow = t;
        break;
      }
    }
    if (titleRow === -1) {
      warnings.push(`[${sheetDate}] Sin fila de títulos para "${customerName}" (fila ${r + 1})`);
      r++;
      continue;
    }

    const hasTivaCol = /total.*iva/i.test(cellStr(sheet, 5, titleRow));
    r = titleRow + 1;

    const items: ParsedItem[] = [];
    let blockTotal = 0;

    while (r <= maxRow) {
      if (isRowEmpty(sheet, r)) break;

      const a = cellStr(sheet, 0, r); // cantidad
      const b = cellStr(sheet, 1, r); // unidad
      const c = cellStr(sheet, 2, r); // producto

      // Fila de total del bloque
      if (a === "" && cellNum(sheet, 4, r) !== 0 && c === "" && b === "") {
        blockTotal = cellNum(sheet, 4, r);
        r++;
        continue;
      }

      // Fila de totales con texto "TOTAL / SUBTOTAL"
      if (/^(total|subtotal|suma)/i.test(a)) {
        blockTotal = cellNum(sheet, 4, r);
        r++;
        continue;
      }

      const qty = parseFloat(a.replace(",", "."));
      if (isNaN(qty) || qty <= 0) {
        r++;
        continue;
      }

      // Sin nombre de producto → skip
      if (c === "") {
        r++;
        continue;
      }

      items.push({
        rawName:     c.trim(),
        quantity:    qty,
        unit:        normalizeUnit(b || "KG"),
        pricePerUnit: cellNum(sheet, 3, r),   // col D = PRECIO
        subtotal:    cellNum(sheet, 4, r),    // col E = TOTAL
        costPerUnit: cellNum(sheet, 8, r),    // col I = COSTO
      });
      r++;
    }

    // Avanzar filas vacías entre bloques
    while (r <= maxRow && isRowEmpty(sheet, r)) r++;

    if (items.length === 0) {
      warnings.push(`[${sheetDate}] "${customerName}" sin productos, bloque ignorado`);
      continue;
    }

    if (blockTotal === 0) blockTotal = items.reduce((s, i) => s + i.subtotal, 0);

    blocks.push({ customerName, remitoNum, orderDate: sheetDate, hasIva: hasTivaCol, items, blockTotal });
  }

  return blocks;
}

// ─── Parser de hoja CC ────────────────────────────────────────────────────────
/**
 * Estructura:
 *   fila 1 (r=0): headers  A=CLIENTE  B=SALDOS_MES_ANT  C=FACTURACION  D=COBRANZA  E=RETENCIONES  F=SALDO
 *   fila 2+:      datos
 *
 * Solo de ENERO extrae opening_balance (col B = saldo diciembre).
 * De todos los meses extrae cobranza (col D), retenciones (col E)
 * y facturación histórica (col C).
 */

const MONTH_CODES: Record<number, string> = {
  1: "ENE", 2: "FEB", 3: "MAR", 4: "ABR",
};

function parseCCSheet(
  sheet: XLSX.WorkSheet,
  monthNum: number,
  year: number,
  isFirstMonth: boolean,
): {
  payments: ParsedPayment[];
  openingBalances: ParsedOpeningBalance[];
  historicalOrders: ParsedHistoricalOrder[];
} {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const payments: ParsedPayment[] = [];
  const openingBalances: ParsedOpeningBalance[] = [];
  const historicalOrders: ParsedHistoricalOrder[] = [];

  const monthCode = MONTH_CODES[monthNum] ?? String(monthNum);

  // Fecha: último día del mes (o corte para abril en progreso)
  let monthDate: string;
  if (monthNum === 4 && year === 2026) {
    monthDate = APRIL_CUT_DATE;
  } else {
    const lastDay = new Date(year, monthNum, 0);
    monthDate = lastDay.toISOString().slice(0, 10);
  }

  for (let r = 1; r <= maxRow; r++) {
    const colA = cellStr(sheet, 0, r).trim();
    if (!colA) continue;

    const colAUp = colA.toUpperCase();

    // Saltear filas de resumen / totales / clientes inactivos
    if (CC_SKIP_NAMES.some((s) => colAUp.startsWith(s))) continue;
    if (/^(subtotal|cliente[s]?)\b/i.test(colA)) continue;

    const colB = cellNum(sheet, 1, r); // saldo anterior
    const colC = cellNum(sheet, 2, r); // facturación
    const colD = cellNum(sheet, 3, r); // cobranza
    const colE = cellNum(sheet, 4, r); // retenciones

    if (colB === 0 && colC === 0 && colD === 0 && colE === 0) continue;

    const customerName = colAUp;

    // Saldo inicial: solo de ENERO (saldo diciembre → opening_balance)
    if (isFirstMonth && colB !== 0) {
      openingBalances.push({ customerName, amount: Math.abs(colB) });
    }

    // Facturación histórica → pedido sintético
    if (colC !== 0) {
      historicalOrders.push({
        customerName,
        date: monthDate,
        amount: Math.abs(colC),
        monthCode,
      });
    }

    if (colD !== 0) {
      payments.push({
        customerName,
        date: monthDate,
        amount: Math.abs(colD),
        method: "TRANSFERENCIA",
        notes: "Cobranza",
      });
    }

    if (colE !== 0) {
      payments.push({
        customerName,
        date: monthDate,
        amount: Math.abs(colE),
        method: "RETENCION",
        notes: "Retención",
      });
    }
  }

  return { payments, openingBalances, historicalOrders };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function initFolioCounters(): Promise<void> {
  const res = await pool.query(
    `SELECT MAX(CAST(REPLACE(folio,'VA-','') AS INTEGER)) AS max_folio
     FROM orders WHERE folio ~ '^VA-\\d+$'`,
  );
  globalFolioCounter = Number(res.rows[0]?.max_folio ?? 0);
  console.log(`  Folio counter global: máximo actual VA-${String(globalFolioCounter).padStart(6, "0")}\n`);
}

function nextFolioForCustomer(_customerId: number): string {
  globalFolioCounter++;
  return `VA-${String(globalFolioCounter).padStart(6, "0")}`;
}

/**
 * Busca (y opcionalmente crea) un cliente por nombre.
 * allowCreate=false → warn + return null si no se encuentra (usado en CC_ONLY).
 */
async function findOrCreateCustomer(
  name: string,
  hasIva: boolean,
  allowCreate = true,
): Promise<number | null> {
  const aliased = CLIENT_ALIASES[name.toUpperCase()] ?? name;
  if (aliased !== name) {
    if (!customerCache.has(`__alias__${name.toLowerCase()}`)) {
      console.log(`  [alias] "${name}" → "${aliased}"`);
      customerCache.set(`__alias__${name.toLowerCase()}`, -999);
    }
  }
  name = aliased;
  const key = name.toLowerCase().trim();
  if (customerCache.has(key)) return customerCache.get(key)!;

  const res = await pool.query(
    "SELECT id FROM customers WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1",
    [name],
  );
  if (res.rows.length > 0) {
    console.log(`  [ok]  "${name}" → id=${res.rows[0].id}`);
    customerCache.set(key, res.rows[0].id);
    return res.rows[0].id;
  }

  // Intentar resolución como sede de BLACK POT
  const bpMatch = matchBlackPotChild(name);
  if (bpMatch) {
    console.log(`  [bp]  "${name}" → "${bpMatch.name}" (sede de BLACK POT, id=${bpMatch.id})`);
    customerCache.set(key, bpMatch.id);
    return bpMatch.id;
  }

  // ── Fuzzy matching contra todos los clientes activos ──────────────────────
  if (allDbCustomers.length > 0) {
    const fuzzy = findBestFuzzyMatch(name);
    if (fuzzy) {
      const pct = Math.round(fuzzy.score * 100);
      if (pct >= 80) {
        // Auto-usar
        console.log(`  [fuzzy-auto] "${name}" → "${fuzzy.name}" (id=${fuzzy.id}, ${pct}%)`);
        customerCache.set(key, fuzzy.id);
        return fuzzy.id;
      } else if (pct >= 50) {
        // Interactivo (o dry-run warning)
        if (DRY_RUN) {
          warnings.push(`[fuzzy-interactivo] "${name}" → candidato "${fuzzy.name}" (${pct}%) — se pedirá confirmación en modo real`);
        } else {
          const chosen = await askFuzzyMatch(name, fuzzy);
          if (chosen) {
            customerCache.set(key, chosen.id);
            return chosen.id;
          }
          // chosen=null → caer a crear nuevo
        }
      }
      // <50% → caer a crear nuevo
    }
  }

  if (!allowCreate) {
    warnings.push(`[CC] Cliente no encontrado en DB (skipped): "${name}"`);
    return null;
  }

  // ¿Es un hijo nuevo de BLACK POT?
  const isBPChild = BLACKPOT_NEW_CHILDREN.has(name.toUpperCase());
  const parentNote = isBPChild && blackPotParentId ? ` (hijo de BLACK POT id=${blackPotParentId})` : "";

  warnings.push(`[NUEVO] Cliente no encontrado en DB: "${name}"${parentNote}`);
  customersCreated++;

  if (DRY_RUN) {
    const fakeId = -(customerCache.size + 1);
    customerCache.set(key, fakeId);
    return fakeId;
  }

  const parentId = isBPChild ? blackPotParentId : null;
  const ins = await pool.query(
    `INSERT INTO customers (name, has_iva, bolsa_fv, cc_type, active, parent_customer_id)
     VALUES ($1, $2, false, 'por_saldo', true, $3) RETURNING id`,
    [name, hasIva, parentId],
  );
  const id = ins.rows[0].id;
  customerCache.set(key, id);
  console.log(`  ✓ Cliente creado: "${name}" (id=${id})${parentNote}`);
  return id;
}

async function findOrCreateProduct(rawName: string): Promise<number> {
  const key = rawName.toLowerCase().trim();
  if (productCache.has(key)) return productCache.get(key)!;

  const res = await pool.query(
    "SELECT id FROM products WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1",
    [rawName],
  );
  if (res.rows.length > 0) {
    productCache.set(key, res.rows[0].id);
    return res.rows[0].id;
  }

  warnings.push(`Producto nuevo: "${rawName}"`);
  productsCreated++;

  if (DRY_RUN) {
    const fakeId = -(productCache.size + 1);
    productCache.set(key, fakeId);
    return fakeId;
  }

  const ins = await pool.query(
    `INSERT INTO products (name, category, active, average_cost, current_stock)
     VALUES ($1, 'Verdura', true, 0, 0) RETURNING id`,
    [rawName],
  );
  const id = ins.rows[0].id;
  productCache.set(key, id);
  return id;
}

// ─── Cache has_iva por customer_id ────────────────────────────────────────────
const customerHasIvaCache = new Map<number, boolean>();

async function getCustomerHasIva(customerId: number): Promise<boolean> {
  if (customerId < 0) return false; // ID ficticio en dry-run
  if (customerHasIvaCache.has(customerId)) return customerHasIvaCache.get(customerId)!;
  const res = await pool.query("SELECT has_iva FROM customers WHERE id = $1", [customerId]);
  const v = res.rows[0]?.has_iva ?? false;
  customerHasIvaCache.set(customerId, v);
  return v;
}

// IVA rate del producto "FACTURACIÓN HISTÓRICA" (no es HUEVO → 10.5%)
const HIST_IVA = 1.105;

// ─── Importar pedido de facturación histórica ─────────────────────────────────
let histProductId: number | null = null;

async function getHistProduct(): Promise<number> {
  if (histProductId !== null) return histProductId;
  const res = await pool.query(
    "SELECT id FROM products WHERE lower(trim(name)) = 'facturación histórica' LIMIT 1",
  );
  if (res.rows.length > 0) {
    histProductId = res.rows[0].id;
    return histProductId!;
  }
  if (DRY_RUN) {
    histProductId = -9999;
    return -9999;
  }
  const ins = await pool.query(
    `INSERT INTO products (name, category, active, average_cost, current_stock)
     VALUES ('FACTURACIÓN HISTÓRICA', 'Histórico', true, 0, 0) RETURNING id`,
  );
  histProductId = ins.rows[0].id;
  console.log(`  ✓ Producto creado: "FACTURACIÓN HISTÓRICA" (id=${histProductId})`);
  return histProductId!;
}

async function importHistoricalOrder(order: ParsedHistoricalOrder): Promise<void> {
  const customerId = await findOrCreateCustomer(order.customerName, false, !CC_ONLY);
  if (customerId === null) return;

  // Para clientes con has_iva=true, itemBilling() aplica ×1.105 sobre price_per_unit.
  // El Excel ya incluye IVA → guardamos price_per_unit = amount / 1.105 para que
  // la CC calcule correctamente: (amount/1.105) × 1.105 = amount.
  // Para clientes sin IVA: price_per_unit = amount directamente.
  const hasIva = customerId > 0 ? await getCustomerHasIva(customerId) : false;
  const pricePerUnit = hasIva ? order.amount / HIST_IVA : order.amount;

  const folio = customerId > 0
    ? `PV-HIST-${order.monthCode}-${customerId}`
    : `PV-HIST-${order.monthCode}-fake${Math.abs(customerId)}`;

  const ivaNote = hasIva
    ? `  [IVA adj: price_per_unit=$${pricePerUnit.toFixed(2)} → ×${HIST_IVA} = $${order.amount}]`
    : "";

  if (DRY_RUN) {
    console.log(
      `  [DRY] HIST order: "${order.customerName}" ${order.date}  ` +
      `total=$${order.amount.toLocaleString("es-AR")}  folio=${folio}${ivaNote}`,
    );
    histOrdersCreated++;
    return;
  }

  const dup = await pool.query(
    "SELECT id FROM orders WHERE folio = $1 LIMIT 1",
    [folio],
  );
  if (dup.rows.length > 0) {
    histOrdersSkipped++;
    return;
  }

  const productId = await getHistProduct();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query(
      `INSERT INTO orders
         (folio, customer_id, order_date, status, total, notes, created_by, approved_by, approved_at)
       VALUES ($1, $2, $3, 'approved', $4, 'Facturación histórica importada', 1, 1, now())
       RETURNING id`,
      [folio, customerId, order.date, order.amount],
    );
    const orderId = orderRes.rows[0].id;
    await client.query(
      `INSERT INTO order_items
         (order_id, product_id, quantity, unit, price_per_unit, subtotal, raw_product_name)
       VALUES ($1, $2, 1, 'UNIDAD', $3, $4, 'FACTURACIÓN HISTÓRICA')`,
      [orderId, productId > 0 ? productId : null, pricePerUnit, order.amount],
    );
    await client.query("COMMIT");
    histOrdersCreated++;
  } catch (e: any) {
    await client.query("ROLLBACK");
    errors.push(`HIST order "${order.customerName}" ${order.date}: ${e.message}`);
  } finally {
    client.release();
  }
}

// ─── Importar un bloque de pedido ─────────────────────────────────────────────
async function importBlock(block: ParsedBlock): Promise<void> {
  const customerId = await findOrCreateCustomer(block.customerName, block.hasIva, true);

  if (!DRY_RUN) {
    // Duplicado = mismo cliente + misma fecha + mismo remito_num (o ambos sin remito).
    // Distinto remito el mismo día = pedidos diferentes → NO es duplicado.
    const exists = await pool.query(
      `SELECT id FROM orders
       WHERE customer_id = $1
         AND order_date::date = $2::date
         AND remito_num IS NOT DISTINCT FROM $3
       LIMIT 1`,
      [customerId, block.orderDate, block.remitoNum],
    );
    if (exists.rows.length > 0) {
      ordersSkipped++;
      warnings.push(
        `Pedido duplicado: "${block.customerName}" el ${block.orderDate} remito=${block.remitoNum ?? "–"} (order id=${exists.rows[0].id})`,
      );
      return;
    }
  }

  const total = block.blockTotal || block.items.reduce((s, i) => s + i.subtotal, 0);

  if (DRY_RUN) {
    console.log(
      `  [DRY] Order: "${block.customerName}" ${block.orderDate}  ` +
      `items=${block.items.length}  total=$${total.toFixed(0)}`,
    );
    ordersCreated++;
    return;
  }

  // Insertar dentro de una transacción
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const folio = nextFolioForCustomer(customerId!);
    const orderRes = await client.query(
      `INSERT INTO orders
         (folio, customer_id, order_date, status, total, remito_num, notes, created_by, approved_by, approved_at)
       VALUES ($1, $2, $3, 'approved', $4, $5, $6, 1, 1, now())
       RETURNING id`,
      [folio, customerId, block.orderDate, total, block.remitoNum, null],
    );
    const orderId = orderRes.rows[0].id;

    for (const item of block.items) {
      let productId: number;
      try {
        productId = await findOrCreateProduct(item.rawName);
      } catch (e: any) {
        errors.push(`${folio} "${block.customerName}" producto "${item.rawName}": ${e.message}`);
        continue;
      }

      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, quantity, unit, price_per_unit, cost_per_unit,
            subtotal, raw_product_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          orderId,
          productId > 0 ? productId : null,
          item.quantity,
          item.unit,
          item.pricePerUnit || null,
          item.costPerUnit || 0,
          item.subtotal,
          item.rawName,
        ],
      );
    }

    await client.query("COMMIT");
    ordersCreated++;
  } catch (e: any) {
    await client.query("ROLLBACK");
    // devolver folio si se incrementó
    globalFolioCounter = Math.max(0, globalFolioCounter - 1);
    throw e;
  } finally {
    client.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📂 Archivo : ${FILE_PATH}`);
  if (FIX_REMITO && DRY_RUN) {
    console.log("🔍 MODO FIX-REMITO DRY-RUN — muestra qué remito_num se asignaría a cada pedido\n");
  } else if (FIX_REMITO) {
    console.log("🔧 MODO FIX-REMITO — actualiza remito_num en pedidos existentes desde Excel\n");
  } else if (DRY_RUN && CC_ONLY) {
    console.log("🔍 MODO DRY-RUN + CC-ONLY — solo CC, sin tocar la DB\n");
  } else if (DRY_RUN && DIA_ONLY) {
    console.log("🔍 MODO DRY-RUN + DIA-ONLY — solo días nuevos, sin tocar la DB\n");
  } else if (DRY_RUN) {
    console.log("🔍 MODO DRY-RUN — no se tocará la DB\n");
  } else if (CC_ONLY) {
    console.log("♻️  MODO CC-ONLY — limpiar y reimportar pagos/balances enero-marzo\n");
  } else if (DIA_ONLY) {
    console.log("📅 MODO DIA-ONLY — importar solo hojas de días nuevos\n");
  } else {
    console.log("⚠️  MODO REAL — se escribirá en la DB\n");
  }

  // Verificar conexión
  try {
    await pool.query("SELECT 1");
    console.log("✓ Conexión a DB OK\n");
  } catch (e: any) {
    console.error("✗ No se pudo conectar:", e.message);
    process.exit(1);
  }

  // Cargar sedes de BLACK POT para resolución de colegios
  await initBlackPotChildren();

  // Cargar todos los clientes para fuzzy matching
  await loadAllDbCustomers();

  // Inicializar folio counters solo en modo real
  if (!DRY_RUN) {
    await initFolioCounters();
  }

  const workbook = XLSX.readFile(FILE_PATH, { cellDates: false, raw: false });
  const sheetNames = workbook.SheetNames;

  // Separar hojas CC vs hojas de día
  const ccSheets  = sheetNames.filter((n) => n.toUpperCase().includes("CUENTAS CORRIENTES"));
  const daySheets = sheetNames.filter((n) => parseDateFromSheetName(n) !== null);

  console.log(`📋 Hojas totales: ${sheetNames.length}`);
  console.log(`   CC    : ${ccSheets.length} → ${ccSheets.join(" | ")}`);
  console.log(`   Días  : ${daySheets.length} → ${daySheets.map((s) => s.trim()).join(" | ")}`);
  console.log();

  // ════════════════════════════════════════════════════════════
  // MODO FIX-REMITO: actualizar remito_num en pedidos existentes
  // ════════════════════════════════════════════════════════════
  if (FIX_REMITO) {
    console.log("══ FIX-REMITO ══════════════════════════════════════\n");
    for (const sheetName of daySheets) {
      const sheetDate = parseDateFromSheetName(sheetName)!;
      const sheet = workbook.Sheets[sheetName];
      let blocks: ParsedBlock[];
      try {
        blocks = parseSheet(sheet, sheetDate);
      } catch (e: any) {
        errors.push(`Hoja "${sheetName}": error al parsear — ${e.message}`);
        continue;
      }

      for (const block of blocks) {
        if (block.remitoNum === null) {
          warnings.push(`[${sheetDate}] "${block.customerName}": sin remito_num en Excel, omitido`);
          remitoSkipped++;
          continue;
        }

        const customerId = await findOrCreateCustomer(block.customerName, block.hasIva, false);
        if (!customerId || customerId < 0) {
          warnings.push(`[${sheetDate}] "${block.customerName}": cliente no encontrado, omitido`);
          remitoSkipped++;
          continue;
        }

        // Buscar pedido existente: mismo cliente + fecha
        const res = await pool.query(
          `SELECT id, remito_num FROM orders
           WHERE customer_id = $1 AND order_date::date = $2::date
             AND (notes IS NULL OR notes NOT LIKE '%histórica%')
           ORDER BY id LIMIT 1`,
          [customerId, sheetDate],
        );

        if (res.rows.length === 0) {
          warnings.push(`[${sheetDate}] "${block.customerName}": pedido no encontrado en DB, omitido`);
          remitoSkipped++;
          continue;
        }

        const row = res.rows[0];
        const orderId: number = row.id;
        const currentRemito: number | null = row.remito_num;

        if (currentRemito === block.remitoNum) {
          remitoSkipped++;
          continue;
        }

        if (DRY_RUN) {
          console.log(
            `  [DRY] UPDATE order id=${orderId} "${block.customerName}" ${sheetDate}: ` +
            `remito_num ${currentRemito ?? "NULL"} → ${block.remitoNum}`,
          );
          remitoFixed++;
          continue;
        }

        try {
          await pool.query(
            "UPDATE orders SET remito_num = $1 WHERE id = $2",
            [block.remitoNum, orderId],
          );
          console.log(
            `  ✓ order id=${orderId} "${block.customerName}" ${sheetDate}: ` +
            `remito_num ${currentRemito ?? "NULL"} → ${block.remitoNum}`,
          );
          remitoFixed++;
        } catch (e: any) {
          errors.push(`UPDATE remito order id=${orderId}: ${e.message}`);
        }
      }
    }

    console.log("\n" + "═".repeat(55));
    console.log(`📊 RESUMEN FIX-REMITO${DRY_RUN ? " (DRY-RUN)" : ""}`);
    console.log("═".repeat(55));
    console.log(`  Remitos actualizados : ${remitoFixed}`);
    console.log(`  Omitidos             : ${remitoSkipped}`);
    console.log(`  Errores              : ${errors.length}`);
    console.log(`  Advertencias         : ${warnings.length}`);
    if (warnings.length > 0) {
      console.log("\n⚠️  ADVERTENCIAS:");
      warnings.forEach((w) => console.log("  ⚠  " + w));
    }
    if (errors.length > 0) {
      console.log("\n✗ ERRORES:");
      errors.forEach((e) => console.log("  ✗  " + e));
    }
    console.log("═".repeat(55) + "\n");
    rl.close();
    await pool.end();
    return;
  }

  // ════════════════════════════════════════════════════════════
  // 1. CUENTAS CORRIENTES
  // ════════════════════════════════════════════════════════════
  const allOpeningBalances:  ParsedOpeningBalance[]   = [];
  const allCCPayments:       ParsedPayment[]           = [];
  const allHistoricalOrders: ParsedHistoricalOrder[]   = [];

  if (DIA_ONLY) {
    console.log("(Modo DIA-ONLY: CC omitida)\n");
  } else {
  console.log("══ CUENTAS CORRIENTES ══════════════════════════════\n");

  // En modo CC_ONLY: limpiar DB antes de reimportar
  if (CC_ONLY && !DRY_RUN) {
    console.log("🗑  Limpiando datos enero-marzo 2026...");
    const del = await pool.query(
      "DELETE FROM payments WHERE date >= '2026-01-01' AND date < '2026-04-01'",
    );
    console.log(`   Pagos eliminados: ${del.rowCount}`);
    // Eliminar pedidos históricos de ene-mar (order_items primero por FK)
    const histIds = await pool.query(
      `SELECT id FROM orders WHERE folio LIKE 'PV-HIST-%'
       AND order_date >= '2026-01-01' AND order_date < '2026-04-01'`,
    );
    if (histIds.rows.length > 0) {
      const ids = histIds.rows.map((r: any) => r.id);
      await pool.query(`DELETE FROM order_items WHERE order_id = ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM orders WHERE id = ANY($1::int[])`, [ids]);
      console.log(`   Pedidos históricos eliminados: ${ids.length}`);
    }
    const rst = await pool.query("UPDATE customers SET opening_balance = 0");
    console.log(`   opening_balance reseteado en ${rst.rowCount} clientes\n`);
  }

  // Ordenar por mes; en CC_ONLY procesar solo ENERO-MARZO (no ABRIL)
  const CC_MONTHS_ONLY = ["ENERO", "FEBRERO", "MARZO"];
  const ccSorted = [...ccSheets]
    .filter((n) => !CC_ONLY || CC_MONTHS_ONLY.some((m) => n.toUpperCase().includes(m)))
    .sort((a, b) => {
      const monthOf = (name: string) => {
        for (const [k, v] of Object.entries(MONTH_MAP)) {
          if (name.toUpperCase().includes(k)) return v;
        }
        return 99;
      };
      return monthOf(a) - monthOf(b);
    });

  for (let i = 0; i < ccSorted.length; i++) {
    const sheetName = ccSorted[i];
    const sheetUpper = sheetName.toUpperCase();

    let monthNum = 0;
    for (const [k, v] of Object.entries(MONTH_MAP)) {
      if (sheetUpper.includes(k)) { monthNum = v; break; }
    }
    if (monthNum === 0) {
      warnings.push(`CC: hoja "${sheetName}" sin mes reconocido, ignorada`);
      continue;
    }

    const isFirstMonth = (i === 0); // ENERO → extrae opening_balance
    const sheet = workbook.Sheets[sheetName];
    const { payments, openingBalances, historicalOrders } = parseCCSheet(sheet, monthNum, 2026, isFirstMonth);

    const monthName = Object.keys(MONTH_MAP).find((k) => MONTH_MAP[k] === monthNum) ?? String(monthNum);
    console.log(`💳 ${monthName}:`);
    console.log(`   Saldos iniciales : ${openingBalances.length}`);
    console.log(`   Pagos            : ${payments.filter((p) => p.method === "TRANSFERENCIA").length} cobranzas + ${payments.filter((p) => p.method === "RETENCION").length} retenciones`);
    console.log(`   Facturación hist : ${historicalOrders.length} clientes`);
    console.log();

    allOpeningBalances.push(...openingBalances);
    allCCPayments.push(...payments);
    allHistoricalOrders.push(...historicalOrders);
  }

  // ── Aplicar saldos iniciales ──
  console.log(`📊 Saldos iniciales (opening_balance de Diciembre 2025): ${allOpeningBalances.length}\n`);
  for (const ob of allOpeningBalances) {
    let cid: number | null;
    try {
      cid = await findOrCreateCustomer(ob.customerName, false, !CC_ONLY);
    } catch (e: any) {
      errors.push(`opening_balance "${ob.customerName}": ${e.message}`);
      continue;
    }
    if (cid === null) continue;

    if (DRY_RUN) {
      console.log(`  [DRY] UPDATE opening_balance: "${ob.customerName}" = $${ob.amount.toLocaleString("es-AR")}`);
      balancesUpdated++;
      continue;
    }

    try {
      await pool.query(
        "UPDATE customers SET opening_balance = $1 WHERE id = $2",
        [ob.amount, cid],
      );
      balancesUpdated++;
    } catch (e: any) {
      errors.push(`opening_balance "${ob.customerName}": ${e.message}`);
    }
  }

  // ── Aplicar pagos CC ──
  console.log(`\n💵 Pagos CC (cobranzas + retenciones): ${allCCPayments.length}\n`);
  for (const p of allCCPayments) {
    let cid: number | null;
    try {
      cid = await findOrCreateCustomer(p.customerName, false, !CC_ONLY);
    } catch (e: any) {
      errors.push(`Pago CC "${p.customerName}": ${e.message}`);
      continue;
    }
    if (cid === null) continue;

    if (DRY_RUN) {
      console.log(
        `  [DRY] INSERT payment: "${p.customerName}" ${p.date}  ` +
        `$${p.amount.toLocaleString("es-AR")}  ${p.method}`,
      );
      paymentsCreated++;
      continue;
    }

    if (cid < 0) {
      // ID ficticio de dry-run en cliente nuevo → skip real insert
      paymentsCreated++;
      continue;
    }

    // Evitar duplicados
    const dup = await pool.query(
      "SELECT id FROM payments WHERE customer_id=$1 AND date=$2 AND amount=$3 AND method=$4 LIMIT 1",
      [cid, p.date, p.amount, p.method],
    );
    if (dup.rows.length > 0) {
      paymentsSkipped++;
      continue;
    }

    try {
      await pool.query(
        "INSERT INTO payments (customer_id, date, amount, method, notes, created_by) VALUES ($1,$2,$3,$4,$5,1)",
        [cid, p.date, p.amount, p.method, p.notes || null],
      );
      paymentsCreated++;
    } catch (e: any) {
      errors.push(`Pago "${p.customerName}" ${p.date}: ${e.message}`);
    }
  }
  } // end if (!DIA_ONLY) for CC

  // ════════════════════════════════════════════════════════════
  // 2. PEDIDOS DE ABRIL
  // ════════════════════════════════════════════════════════════
  let totalLines = 0;

  if (!DIA_ONLY) {
    // ── Agregar pedidos del mismo cliente+mes antes de importar ──
    // (ocurre cuando dos filas del Excel mapean al mismo cliente DB)
    const histMergeMap = new Map<string, ParsedHistoricalOrder>();
    for (const ho of allHistoricalOrders) {
      const aliased = (CLIENT_ALIASES[ho.customerName.toUpperCase()] ?? ho.customerName).toUpperCase();
      const key = `${ho.date}__${aliased}`;
      if (histMergeMap.has(key)) {
        histMergeMap.get(key)!.amount += ho.amount;
      } else {
        histMergeMap.set(key, { ...ho, customerName: aliased });
      }
    }
    const mergedHistOrders = Array.from(histMergeMap.values());
    if (mergedHistOrders.length < allHistoricalOrders.length) {
      console.log(`  (${allHistoricalOrders.length - mergedHistOrders.length} filas combinadas por cliente duplicado)\n`);
    }

    // ── Importar pedidos de facturación histórica ──
    console.log(`\n🧾 Facturación histórica: ${mergedHistOrders.length} pedidos\n`);
    for (const ho of mergedHistOrders) {
      try {
        await importHistoricalOrder(ho);
      } catch (e: any) {
        errors.push(`HIST "${ho.customerName}" ${ho.date}: ${e.message}`);
      }
    }
  }

  if (CC_ONLY) {
    // Saltar pedidos de día en modo CC_ONLY
    console.log("\n(Modo CC_ONLY: hojas de pedidos omitidas)\n");
  } else {
  console.log("\n══ PEDIDOS DE ABRIL ════════════════════════════════\n");

  for (const sheetName of daySheets) {
    const sheetDate = parseDateFromSheetName(sheetName)!;

    // En DIA_ONLY: saltar fechas que ya tienen pedidos aprobados en la DB
    if (DIA_ONLY) {
      const existsRes = await pool.query(
        `SELECT COUNT(*) FROM orders
         WHERE order_date::date = $1::date
           AND status = 'approved'
           AND (notes IS NULL OR notes NOT LIKE '%Facturación histórica importada%')`,
        [sheetDate],
      );
      if (Number(existsRes.rows[0].count) > 0) {
        console.log(`📅 ${sheetName.trim()}: ya existe en DB (${existsRes.rows[0].count} pedidos) → OMITIDA`);
        continue;
      }
    }

    const sheet = workbook.Sheets[sheetName];

    let blocks: ParsedBlock[];
    try {
      blocks = parseSheet(sheet, sheetDate);
    } catch (e: any) {
      errors.push(`Hoja "${sheetName}": error al parsear — ${e.message}`);
      continue;
    }

    const sheetLines = blocks.reduce((s, b) => s + b.items.length, 0);
    totalLines += sheetLines;

    console.log(`📅 ${sheetName.trim()}: ${blocks.length} clientes, ${sheetLines} líneas`);

    for (const block of blocks) {
      try {
        await importBlock(block);
      } catch (e: any) {
        errors.push(`"${sheetName.trim()}" "${block.customerName}": ${e.message}`);
      }
    }
  }
  } // end else (CC_ONLY)

  // ════════════════════════════════════════════════════════════
  // 3. RESUMEN
  // ════════════════════════════════════════════════════════════
  console.log("\n" + "═".repeat(55));
  console.log(`📊 RESUMEN${DRY_RUN ? " (DRY-RUN)" : ""}`);
  console.log("═".repeat(55));
  console.log(`  Pedidos importados     : ${ordersCreated}`);
  console.log(`  Pedidos omitidos       : ${ordersSkipped}  (ya existían)`);
  console.log(`  Clientes nuevos        : ${customersCreated}`);
  console.log(`  Productos nuevos       : ${productsCreated}`);
  console.log(`  Líneas de pedido       : ${totalLines}`);
  console.log(`  Saldos iniciales set   : ${balancesUpdated}`);
  console.log(`  Pagos insertados       : ${paymentsCreated}`);
  console.log(`  Pagos duplicados       : ${paymentsSkipped}`);
  console.log(`  Pedidos históricos     : ${histOrdersCreated}`);
  console.log(`  Pedidos hist. omitidos : ${histOrdersSkipped}`);
  console.log(`  Errores                : ${errors.length}`);
  console.log(`  Advertencias           : ${warnings.length}`);

  if (warnings.length > 0) {
    console.log("\n⚠️  ADVERTENCIAS:");
    warnings.forEach((w) => console.log("  ⚠  " + w));
  }

  if (errors.length > 0) {
    console.log("\n✗ ERRORES:");
    errors.forEach((e) => console.log("  ✗  " + e));
  }

  console.log("═".repeat(55) + "\n");
  rl.close();
  await pool.end();
}

main().catch((e) => {
  console.error("✗ Error fatal:", e.message, e.stack);
  process.exit(1);
});
