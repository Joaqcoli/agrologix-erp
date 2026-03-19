/**
 * migrate-sheets.ts
 *
 * Importa datos históricos desde un Excel (planilla diaria) a Supabase.
 *
 * Uso:
 *   npx tsx scripts/migrate-sheets.ts ./enero.xlsx
 *   npx tsx scripts/migrate-sheets.ts ./enero.xlsx --dry-run
 */

import { createRequire } from "module";
const XLSX: typeof import("xlsx") = createRequire(import.meta.url)("xlsx");
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

// ─── Cargar .env manualmente ─────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");

if (!filePath) {
  console.error("Uso: npx tsx scripts/migrate-sheets.ts <archivo.xlsx> [--dry-run]");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`✗ Archivo no encontrado: ${filePath}`);
  process.exit(1);
}

if (DRY_RUN) console.log("🔍 MODO DRY-RUN — no se insertará nada\n");

// ─── DB ───────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

// ─── Tipos internos ───────────────────────────────────────────────────────────
interface ParsedItem {
  rawName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  subtotal: number;
  costPerUnit: number;
  bolsaType: "bolsa" | "bolsa_propia" | null;
}

interface ParsedBlock {
  customerName: string;
  remitoNum: string | null;
  orderDate: string;            // ISO: "2026-01-05"
  hasIva: boolean;
  items: ParsedItem[];
  blockTotal: number;
}

interface ParsedPayment {
  customerName: string;
  date: string;
  amount: number;
  method: string;
  notes: string;
}

interface ParsedOpeningBalance {
  customerName: string;
  amount: number;
}

// ─── Nombres a ignorar en hoja CC ────────────────────────────────────────────
const CC_SKIP_NAMES = [
  "CONTADO", "TOTAL", "FERIADO CANTINA",
  "1° SEMANA", "2° SEMANA", "3° SEMANA", "4° SEMANA",
  "VENTA DEL MES", "PROMEDIO VENTA X DIA", "PROMEDIO GCIA X DIA",
  "ALUMNI", "ROSSO RISTORANTE", "NORTH SIDE", "ONNEG",
  "LAS BRISAS", "HOWARD JOHNSON", "COLEGIOS", "AL ESTRIBO",
];

// ─── Aliases de clientes ─────────────────────────────────────────────────────
const CLIENT_ALIASES: Record<string, string> = {
  "MARQUESA": "LA MARQUESA",
  "RAKUS CAFE": "RAKUS",
  "RAKUS CAFE - PADUA": "RAKUS",
  "PAULA": "PAULA CASERO",
  "FV S.A": "FV",
  "FV S.A.": "FV",
  "PAULA CASEROS": "PAULA CASERO",
};

// ─── Counters ─────────────────────────────────────────────────────────────────
let ordersCreated = 0;
let customersCreated = 0;
let productsCreated = 0;
let ordersSkipped = 0;
const warnings: string[] = [];
const errors: string[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "$52,000.00" | "52000" | "52.000,00" → 52000 */
function parseMoney(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(/\$/g, "").trim();
  // Si tiene punto como separador de miles y coma decimal: "52.000,00"
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return parseFloat(s.replace(/\./g, "").replace(",", "."));
  }
  // Si tiene coma como separador de miles: "52,000.00"
  const clean = s.replace(/,/g, "");
  return parseFloat(clean) || 0;
}

/** Normalizar unidad a los valores aceptados en DB */
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
  return u;  // devolver tal cual y dejar que DB rechace si es inválido
}

/** Detectar fecha desde nombre de hoja "05-01-2026" → "2026-01-05" */
function parseDateFromSheetName(name: string): string | null {
  const m = name.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Obtener celda como string limpio */
function cellStr(sheet: XLSX.WorkSheet, col: number, row: number): string {
  const addr = XLSX.utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

/** Obtener celda como número */
function cellNum(sheet: XLSX.WorkSheet, col: number, row: number): number {
  const addr = XLSX.utils.encode_cell({ c: col, r: row });
  const cell = sheet[addr];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  return parseMoney(cell.v);
}

/** ¿La fila está completamente vacía? (cols A-K) */
function isRowEmpty(sheet: XLSX.WorkSheet, row: number): boolean {
  for (let c = 0; c <= 10; c++) {
    const addr = XLSX.utils.encode_cell({ c, r: row });
    if (sheet[addr] && String(sheet[addr].v ?? "").trim() !== "") return false;
  }
  return true;
}

// ─── Parser de hoja ───────────────────────────────────────────────────────────

function parseSheet(sheet: XLSX.WorkSheet, sheetDate: string): ParsedBlock[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const blocks: ParsedBlock[] = [];
  let r = 0;

  while (r <= maxRow) {
    // Buscar fila de encabezado de cliente:
    // col A = nombre cliente (no vacío, no "CANTIDAD"), col D contiene "rto"
    const colA = cellStr(sheet, 0, r);
    const colD = cellStr(sheet, 3, r);

    const isClientHeader =
      colA !== "" &&
      colA.toUpperCase() !== "CANTIDAD" &&
      /rto/i.test(colD);

    if (!isClientHeader) {
      r++;
      continue;
    }

    // ── Encabezado encontrado ────────────────────────────────────────────────
    const customerName = colA.trim();
    const remitoMatch = colD.match(/rto\s*[:\-]?\s*(\S+)/i);
    const remitoNum = remitoMatch ? remitoMatch[1] : null;
    r++;

    // Fila de títulos: buscar la fila con CANTIDAD en col A
    let titleRow = -1;
    for (let t = r; t <= Math.min(r + 3, maxRow); t++) {
      if (/cantidad/i.test(cellStr(sheet, 0, t))) {
        titleRow = t;
        break;
      }
    }
    if (titleRow === -1) {
      warnings.push(`Hoja ${sheetDate}: sin fila de títulos para cliente "${customerName}" (fila ${r + 1})`);
      r++;
      continue;
    }

    // Detectar si tiene columna TOTAL+IVA (col F, índice 5)
    const hasTivaCol = /total.*iva/i.test(cellStr(sheet, 5, titleRow));

    r = titleRow + 1;

    // ── Parsear filas de productos ───────────────────────────────────────────
    const items: ParsedItem[] = [];
    let blockTotal = 0;

    while (r <= maxRow) {
      // Detectar fin del bloque: fila vacía O nueva cabecera de cliente
      if (isRowEmpty(sheet, r)) break;

      const a = cellStr(sheet, 0, r); // CANTIDAD o texto de total
      const b = cellStr(sheet, 1, r); // UNIDAD
      const c = cellStr(sheet, 2, r); // PRODUCTO
      const g = cellStr(sheet, 6, r); // BOLSA / BOLSA PROPIA

      // Fila de totales del bloque: col A tiene "TOTAL" o "SUBTOTAL"
      if (/^(total|subtotal|suma)/i.test(a)) {
        blockTotal = cellNum(sheet, 4, r);
        r++;
        continue;
      }

      // Si col A no parece número → no es fila de producto
      const qty = parseFloat(a.replace(",", "."));
      if (isNaN(qty) || qty <= 0) {
        r++;
        continue;
      }

      // Detectar bolsa_type ANTES de validar producto (para bolsa lines con C vacío)
      let bolsaType: "bolsa" | "bolsa_propia" | null = null;
      if (/bolsa\s*propia/i.test(g)) bolsaType = "bolsa_propia";
      else if (/bolsa/i.test(g)) bolsaType = "bolsa";

      // Si col C (producto) está vacía:
      // - Si es línea de bolsa → usar placeholder "BOLSA FV"
      // - Si no → skip
      if (c === "" && bolsaType === null) {
        r++;
        continue;
      }
      const productName = c !== "" ? c.trim() : "BOLSA FV";

      const unit = normalizeUnit(b || "KG");
      const pricePerUnit = parseMoney(cellStr(sheet, 3, r)); // col D = PRECIO
      const subtotal = parseMoney(cellStr(sheet, 4, r));     // col E = TOTAL
      const costPerUnit = parseMoney(cellStr(sheet, 8, r));  // col I = precio compra

      items.push({
        rawName: productName,
        quantity: qty,
        unit,
        pricePerUnit,
        subtotal,
        costPerUnit,
        bolsaType,
      });

      r++;
    }

    // Saltar filas vacías entre bloques
    while (r <= maxRow && isRowEmpty(sheet, r)) r++;

    // Debug log para FV en cada hoja
    if (/^fv$/i.test(customerName) || /^fv\s/i.test(customerName)) {
      console.log(`  [FV DEBUG] hoja ${sheetDate}: ${items.length} líneas detectadas para "${customerName}"`);
      items.forEach((it, idx) => console.log(`    [FV] línea ${idx + 1}: qty=${it.quantity} unit=${it.unit} producto="${it.rawName}" bolsaType=${it.bolsaType}`));
    }

    if (items.length === 0) {
      warnings.push(`Hoja ${sheetDate}: cliente "${customerName}" sin productos, bloque ignorado`);
      continue;
    }

    // Si blockTotal nunca fue seteado, sumar subtotales
    if (blockTotal === 0) blockTotal = items.reduce((s, i) => s + i.subtotal, 0);

    blocks.push({
      customerName,
      remitoNum,
      orderDate: sheetDate,
      hasIva: hasTivaCol,
      items,
      blockTotal,
    });
  }

  return blocks;
}

// ─── Parser hoja CUENTAS CORRIENTES ──────────────────────────────────────────

/**
 * Estructura tabular: fila 2 = headers, filas 3+ = una por cliente
 * Cols: A=cliente  B=saldo_anterior  C=facturación(ignorar)  D=cobranza  E=retenciones  F=saldo(ignorar)
 */
function parseCCSheet(sheet: XLSX.WorkSheet, firstSheetDate: string): { payments: ParsedPayment[]; openingBalances: ParsedOpeningBalance[] } {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const maxRow = range.e.r;
  const payments: ParsedPayment[] = [];
  const openingBalances: ParsedOpeningBalance[] = [];

  // Derivar fechas desde la fecha de la primera hoja (ej. "2026-01-05")
  const year  = parseInt(firstSheetDate.slice(0, 4));
  const month = parseInt(firstSheetDate.slice(5, 7));
  // Último día del mes anterior (saldo anterior)
  const prevMonthEnd = new Date(year, month - 1, 0); // mes es 1-based, día 0 = último del mes anterior
  const saldoDate    = prevMonthEnd.toISOString().slice(0, 10);
  // Último día del mes actual (cobranza / retenciones)
  const currMonthEnd = new Date(year, month, 0);
  const cobranzaDate = currMonthEnd.toISOString().slice(0, 10);

  console.log(`  📅 Fechas CC: saldo_anterior=${saldoDate}  cobranza/retención=${cobranzaDate}`);

  // ── Debug: dump primeras 10 filas ────────────────────────────────────────
  console.log("\n  📋 Primeras 10 filas de CUENTAS CORRIENTES:");
  for (let r = 0; r <= Math.min(9, maxRow); r++) {
    const cols: string[] = [];
    for (let c = 0; c <= 6; c++) {
      const v = cellStr(sheet, c, r);
      cols.push(`[${v || " "}]`);
    }
    console.log(`    fila ${String(r + 1).padStart(3)}: ${cols.join(" ")}`);
  }
  console.log();

  // ── Parsear filas de datos (desde fila índice 2 = fila 3 en Excel) ───────
  for (let r = 2; r <= maxRow; r++) {
    const colA = cellStr(sheet, 0, r).trim();
    const colB = cellNum(sheet, 1, r);  // saldo anterior
    // colC = facturación → ignorar
    const colD = cellNum(sheet, 3, r);  // cobranza
    const colE = cellNum(sheet, 4, r);  // retenciones
    // colF = saldo final → ignorar

    // Saltear filas vacías
    if (!colA) continue;
    // Saltear nombres reservados / filas de resumen
    const colAUp = colA.toUpperCase();
    if (CC_SKIP_NAMES.some((s) => colAUp.startsWith(s.toUpperCase()))) continue;
    // Saltear headers genéricos
    if (/^(subtotal|cliente[s]?)\b/i.test(colA)) continue;
    // Saltear si todos los valores relevantes son 0
    if (colB === 0 && colD === 0 && colE === 0) continue;

    const customerName = colA.toUpperCase();
    console.log(`  👤 ${customerName}: saldo_ant=$${colB}  cobranza=$${colD}  retenciones=$${colE}`);

    if (colB !== 0) {
      openingBalances.push({
        customerName,
        amount: Math.abs(colB),
      });
    }

    if (colD !== 0) {
      payments.push({
        customerName,
        date: cobranzaDate,
        amount: Math.abs(colD),
        method: "TRANSFERENCIA",
        notes: "Cobranza",
      });
    }

    if (colE !== 0) {
      payments.push({
        customerName,
        date: cobranzaDate,
        amount: Math.abs(colE),
        method: "RETENCION",
        notes: "Retención",
      });
    }
  }

  console.log(`  Total pagos parseados: ${payments.length}  (saldos iniciales: ${openingBalances.length})`);
  return { payments, openingBalances };
}

// ─── Caché de clientes y productos ───────────────────────────────────────────
const customerCache = new Map<string, number>(); // lower(name) → id
const productCache = new Map<string, number>();   // lower(name) → id

// ─── Generador de folio de pedido ─────────────────────────────────────────────
let folioCounter = 0;  // se inicializa en main() con el max actual de la DB

async function initFolioCounter() {
  const res = await pool.query(
    `SELECT COALESCE(MAX(CAST(REPLACE(folio,'PV-','') AS INTEGER)),0) AS max
     FROM orders WHERE folio LIKE 'PV-%'`
  );
  folioCounter = Number(res.rows[0].max);
  console.log(`  Folio counter iniciado en PV-${String(folioCounter).padStart(5,"0")}`);
}

function nextFolio(): string {
  folioCounter++;
  return `PV-${String(folioCounter).padStart(5, "0")}`;
}

async function findOrCreateCustomer(
  name: string,
  hasIva: boolean,
  bolsaFv: boolean
): Promise<number> {
  name = CLIENT_ALIASES[name.toUpperCase()] ?? name;
  const key = name.toLowerCase();
  if (customerCache.has(key)) return customerCache.get(key)!;

  // Buscar en DB
  const res = await pool.query(
    "SELECT id FROM customers WHERE lower(name) = lower($1) LIMIT 1",
    [name]
  );
  if (res.rows.length > 0) {
    customerCache.set(key, res.rows[0].id);
    return res.rows[0].id;
  }

  // Crear
  if (DRY_RUN) {
    console.log(`  [DRY] Customer INSERT: "${name}" hasIva=${hasIva} bolsaFv=${bolsaFv}`);
    const fakeId = -(customerCache.size + 1);
    customerCache.set(key, fakeId);
    customersCreated++;
    return fakeId;
  }

  const ins = await pool.query(
    `INSERT INTO customers (name, has_iva, bolsa_fv, cc_type, active)
     VALUES ($1, $2, $3, 'por_saldo', true)
     RETURNING id`,
    [name, hasIva, bolsaFv]
  );
  const id = ins.rows[0].id;
  customerCache.set(key, id);
  customersCreated++;
  console.log(`  ✓ Cliente creado: "${name}"`);
  return id;
}

async function findOrCreateProduct(rawName: string): Promise<number> {
  const key = rawName.toLowerCase().trim();
  if (productCache.has(key)) return productCache.get(key)!;

  const res = await pool.query(
    "SELECT id FROM products WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1",
    [rawName]
  );
  if (res.rows.length > 0) {
    productCache.set(key, res.rows[0].id);
    return res.rows[0].id;
  }

  // Crear
  console.log(`  ⚠  Producto nuevo: "${rawName}"`);
  if (DRY_RUN) {
    const fakeId = -(productCache.size + 1);
    productCache.set(key, fakeId);
    productsCreated++;
    return fakeId;
  }

  // Generar SKU automático a partir del nombre
  const sku = rawName.slice(0, 6).toUpperCase().replace(/\s+/g, "_") + "_" + Date.now() % 10000;
  const ins = await pool.query(
    `INSERT INTO products (name, sku, category, active, average_cost, current_stock)
     VALUES ($1, $2, 'Verdura', true, 0, 0)
     RETURNING id`,
    [rawName, sku]
  );
  const id = ins.rows[0].id;
  productCache.set(key, id);
  productsCreated++;
  return id;
}

// ─── Importar bloque ──────────────────────────────────────────────────────────

async function importBlock(block: ParsedBlock): Promise<void> {
  const customerId = await findOrCreateCustomer(
    block.customerName,
    block.hasIva,
    block.customerName.toUpperCase() === "FV"
  );

  // Verificar si ya existe el pedido para este cliente + fecha
  if (!DRY_RUN) {
    const exists = await pool.query(
      `SELECT id FROM orders
       WHERE customer_id = $1
         AND order_date::date = $2::date
       LIMIT 1`,
      [customerId, block.orderDate]
    );
    if (exists.rows.length > 0) {
      ordersSkipped++;
      warnings.push(`Pedido duplicado: ${block.customerName} en ${block.orderDate} (ya existe order id=${exists.rows[0].id})`);
      return;
    }
  }

  // Calcular total
  const total = block.blockTotal || block.items.reduce((s, i) => s + i.subtotal, 0);

  if (DRY_RUN) {
    console.log(
      `  [DRY] Order INSERT: customer="${block.customerName}" date=${block.orderDate} ` +
      `remito=${block.remitoNum} items=${block.items.length} total=${total.toFixed(2)}`
    );
    ordersCreated++;
    return;
  }

  // Insertar pedido
  const folio = nextFolio();
  console.log(`  Insertando order para "${block.customerName}" fecha ${block.orderDate} folio=${folio}...`);

  const orderRes = await pool.query(
    `INSERT INTO orders (folio, customer_id, order_date, status, total, notes, created_by, approved_by, approved_at)
     VALUES ($1, $2, $3, 'approved', $4, $5, 1, 1, now())
     RETURNING id`,
    [
      folio,
      customerId,
      block.orderDate,
      total,
      block.remitoNum ? `Remito ${block.remitoNum}` : null,
    ]
  );
  const orderId = orderRes.rows[0].id;
  ordersCreated++;
  console.log(`  Order insertada con id=${orderId}`);

  // Insertar items
  console.log(`  Insertando ${block.items.length} items para order ${orderId}...`);
  for (const item of block.items) {
    let productId: number;
    try {
      productId = await findOrCreateProduct(item.rawName);
    } catch (e: any) {
      const msg = `Orden ${orderId} "${block.customerName}" ${block.orderDate}: producto "${item.rawName}" — ${e.message}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO order_items
           (order_id, product_id, quantity, unit, price_per_unit, cost_per_unit,
            subtotal, raw_product_name, bolsa_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          productId > 0 ? productId : null,
          item.quantity,
          item.unit,
          item.pricePerUnit || null,
          item.costPerUnit || 0,
          item.subtotal,
          item.rawName,
          item.bolsaType,
        ]
      );
    } catch (e: any) {
      const msg = `Orden ${orderId} item "${item.rawName}": ${e.message}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📂 Leyendo: ${path.resolve(filePath!)}\n`);

  // Verificar conexión DB
  try {
    await pool.query("SELECT 1");
    console.log("✓ Conexión a Supabase OK\n");
  } catch (e: any) {
    console.error("✗ No se pudo conectar a Supabase:", e.message);
    process.exit(1);
  }

  if (!DRY_RUN) await initFolioCounter();

  const workbook = XLSX.readFile(filePath!, { cellDates: false, raw: false });
  const sheetNames = workbook.SheetNames;

  const SKIP_SHEETS = ["CUENTAS CORRIENTES", "JUAN COMISIONES"];
  const CC_SHEET = "CUENTAS CORRIENTES";

  let totalProducts = 0;

  // ── Hojas de fechas ─────────────────────────────────────────────────────────
  for (const sheetName of sheetNames) {
    if (SKIP_SHEETS.some((s) => sheetName.toUpperCase().includes(s.toUpperCase()))) continue;

    const sheetDate = parseDateFromSheetName(sheetName.trim());
    if (!sheetDate) {
      warnings.push(`Hoja "${sheetName}": nombre no tiene formato de fecha (DD-MM-YYYY), ignorada`);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    let blocks: ParsedBlock[];
    try {
      blocks = parseSheet(sheet, sheetDate);
    } catch (e: any) {
      errors.push(`Hoja "${sheetName}": error al parsear — ${e.message}`);
      continue;
    }

    const sheetProducts = blocks.reduce((s, b) => s + b.items.length, 0);
    totalProducts += sheetProducts;

    console.log(`📅 Hoja ${sheetName}: ${blocks.length} clientes, ${sheetProducts} líneas`);

    for (const block of blocks) {
      try {
        await importBlock(block);
      } catch (e: any) {
        const msg = `Hoja "${sheetName}" cliente "${block.customerName}": ${e.message}`;
        console.error(`  ✗ ${msg}`);
        errors.push(msg);
      }
    }
  }

  // ── Hoja CUENTAS CORRIENTES ─────────────────────────────────────────────────
  const ccSheetName = sheetNames.find((n) =>
    n.toUpperCase().includes("CUENTAS CORRIENTES")
  );
  if (ccSheetName) {
    console.log(`\n💳 Procesando hoja "${ccSheetName}"...`);
    const ccSheet = workbook.Sheets[ccSheetName];

    // Derivar fecha de la primera hoja de datos para calcular fechas de CC
    const firstDateSheet = sheetNames.find((n) => parseDateFromSheetName(n.trim()));
    const firstSheetDate = firstDateSheet
      ? parseDateFromSheetName(firstDateSheet.trim())!
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

    let payments: ParsedPayment[] = [];
    let openingBalances: ParsedOpeningBalance[] = [];
    try {
      ({ payments, openingBalances } = parseCCSheet(ccSheet, firstSheetDate));
    } catch (e: any) {
      const msg = `Hoja "${ccSheetName}": error al parsear — ${e.message}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
    }

    // ── Saldos iniciales (opening_balance) ──────────────────────────────────
    console.log(`\n  Procesando ${openingBalances.length} saldos iniciales...`);
    let balancesUpdated = 0;
    for (const ob of openingBalances) {
      let cid: number;
      try {
        cid = await findOrCreateCustomer(ob.customerName, false, false);
      } catch (e: any) {
        errors.push(`Saldo inicial: no se pudo obtener cliente "${ob.customerName}": ${e.message}`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [DRY] opening_balance "${ob.customerName}" = $${ob.amount}`);
        balancesUpdated++;
        continue;
      }
      try {
        await pool.query(
          `UPDATE customers SET opening_balance = $1 WHERE id = $2`,
          [ob.amount, cid]
        );
        console.log(`  ✓ opening_balance "${ob.customerName}" = $${ob.amount}`);
        balancesUpdated++;
      } catch (e: any) {
        errors.push(`opening_balance "${ob.customerName}": ${e.message}`);
      }
    }
    console.log(`  ✓ ${balancesUpdated} saldos iniciales actualizados`);

    // ── Pagos regulares (cobranza + retenciones) ─────────────────────────────
    console.log(`\n  Procesando ${payments.length} pagos detectados...`);
    let paymentsCreated = 0;
    let paymentsSkipped = 0;

    for (const p of payments) {
      // Usar findOrCreateCustomer para clientes de CC que no aparecieron en pedidos
      let cid: number;
      try {
        cid = await findOrCreateCustomer(p.customerName, false, false);
      } catch (e: any) {
        const msg = `CC: no se pudo obtener cliente "${p.customerName}": ${e.message}`;
        console.error(`  ✗ ${msg}`);
        errors.push(msg);
        continue;
      }

      if (cid < 0) {
        // ID falso de dry-run
        console.log(`  [DRY] Payment INSERT: "${p.customerName}" ${p.date} $${p.amount} ${p.method}`);
        paymentsCreated++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY] Payment INSERT: "${p.customerName}" ${p.date} $${p.amount} ${p.method}`);
        paymentsCreated++;
        continue;
      }

      // Verificar duplicado: mismo cliente + fecha + monto + método
      const dup = await pool.query(
        `SELECT id FROM payments WHERE customer_id=$1 AND date=$2 AND amount=$3 AND method=$4 LIMIT 1`,
        [cid, p.date, p.amount, p.method]
      );
      if (dup.rows.length > 0) {
        paymentsSkipped++;
        continue;
      }

      try {
        await pool.query(
          `INSERT INTO payments (customer_id, date, amount, method, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, 1)`,
          [cid, p.date, p.amount, p.method, p.notes || null]
        );
        paymentsCreated++;
      } catch (e: any) {
        const msg = `Pago "${p.customerName}" ${p.date}: ${e.message}`;
        console.error(`  ✗ ${msg}`);
        errors.push(msg);
      }
    }
    console.log(`  ✓ ${paymentsCreated} pagos insertados, ${paymentsSkipped} duplicados omitidos`);
  }

  // ── Resumen ─────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(55));
  console.log("📊 RESUMEN" + (DRY_RUN ? " (DRY-RUN)" : ""));
  console.log("─".repeat(55));
  console.log(`  Pedidos importados : ${ordersCreated}`);
  console.log(`  Pedidos omitidos   : ${ordersSkipped} (ya existían)`);
  console.log(`  Clientes creados   : ${customersCreated}`);
  console.log(`  Productos nuevos   : ${productsCreated}`);
  console.log(`  Líneas de producto : ${totalProducts}`);
  console.log(`  Errores            : ${errors.length}`);
  console.log(`  Advertencias       : ${warnings.length}`);

  if (warnings.length > 0) {
    console.log("\n⚠  ADVERTENCIAS:");
    warnings.forEach((w) => console.log("  ⚠  " + w));
  }

  if (errors.length > 0) {
    console.log("\n✗ ERRORES:");
    errors.forEach((e) => console.log("  ✗  " + e));
  }

  console.log("─".repeat(55) + "\n");
  await pool.end();
}

main().catch((e) => {
  console.error("✗ Error fatal:", e.message);
  process.exit(1);
});
