import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Verificar si o.total ≠ SUM(oi.price_per_unit * oi.quantity) en pedidos nuevos
console.log("═══ Discrepancias total orden vs suma items (14-17/04) ═══");
const mismatch = await pool.query(`
  SELECT o.id, o.folio, c.name, o.total::numeric AS total_header,
         SUM(oi.price_per_unit::numeric * oi.quantity::numeric) AS total_items,
         o.total::numeric - SUM(oi.price_per_unit::numeric * oi.quantity::numeric) AS diff
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-14'
  GROUP BY o.id, c.name, o.total
  HAVING ABS(o.total::numeric - SUM(oi.price_per_unit::numeric * oi.quantity::numeric)) > 1
  ORDER BY diff DESC
`);
console.log(`Órdenes con discrepancia: ${mismatch.rowCount}`);
mismatch.rows.forEach(r =>
  console.log(`  ${r.folio} "${r.name}" total_header=$${Number(r.total_header).toFixed(0)} suma_items=$${Number(r.total_items).toFixed(0)} diff=$${Number(r.diff).toFixed(0)}`)
);

// ─── Resumen: dashboard calcula precio*qty; o.total es lo del Excel
console.log("\n═══ Total desde o.total vs precio*qty para Abril (aprobados, no históricos) ═══");
const compare = await pool.query(`
  SELECT
    SUM(o.total::numeric) AS sum_order_total,
    SUM(oi.price_per_unit::numeric * oi.quantity::numeric) AS sum_item_calc
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND oi.price_per_unit::numeric > 0
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
`);
const c = compare.rows[0];
console.log(`  SUM(o.total) = $${Number(c.sum_order_total).toLocaleString("es-AR",{maximumFractionDigits:0})}`);
console.log(`  SUM(price×qty) = $${Number(c.sum_item_calc).toLocaleString("es-AR",{maximumFractionDigits:0})}`);
console.log(`  Diferencia = $${(Number(c.sum_order_total)-Number(c.sum_item_calc)).toLocaleString("es-AR",{maximumFractionDigits:0})}`);

// ─── Cuántos pedidos de abril del panel de carga (no importados) tienen costo bien seteado
console.log("\n═══ Pedidos 01-13/04: items con costo=0 (sin incluir importados) ═══");
const oldZeroCost = await pool.query(`
  SELECT COUNT(*) AS items_sin_costo,
         SUM(oi.price_per_unit::numeric * oi.quantity::numeric) AS ventas_sin_costo
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date < '2026-04-14'
    AND o.order_date >= '2026-04-01'
    AND oi.price_per_unit::numeric > 0
    AND oi.cost_per_unit::numeric = 0
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
`);
const oc = oldZeroCost.rows[0];
console.log(`  Items con costo=0 en 01-13/04: ${oc.items_sin_costo}`);
console.log(`  Ventas de esos items: $${Number(oc.ventas_sin_costo).toLocaleString("es-AR",{maximumFractionDigits:0})}`);

await pool.end();
