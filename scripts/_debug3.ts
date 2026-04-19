import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Todos los pedidos DRAFT de Abril
console.log("═══ Pedidos DRAFT en Abril 2026 ═══");
const drafts = await pool.query(`
  SELECT o.id, o.folio, c.name, o.order_date::date, o.total,
         COUNT(oi.id) AS items
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'draft'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
  GROUP BY o.id, c.name
  ORDER BY o.order_date::date, o.id
`);
console.log(`Total drafts Abril: ${drafts.rowCount}`);
drafts.rows.forEach(r =>
  console.log(`  id=${r.id} ${r.folio} ${String(r.order_date).slice(0,10)} "${r.name}" $${r.total} items=${r.items}`)
);

// ─── Items con precio=0 y costo>0 en pedidos aprobados de abril (reducen ganancia)
console.log("\n═══ Items precio=0 con costo>0 en pedidos aprobados Abril ═══");
const zeroPrice = await pool.query(`
  SELECT o.folio, o.order_date::date, c.name, oi.raw_product_name,
         oi.quantity, oi.price_per_unit, oi.cost_per_unit
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND oi.price_per_unit::numeric = 0
    AND COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric > 0
  ORDER BY o.order_date::date, o.folio
  LIMIT 30
`);
console.log(`Total: ${zeroPrice.rowCount}`);
zeroPrice.rows.forEach(r =>
  console.log(`  ${r.folio} ${String(r.order_date).slice(0,10)} "${r.name}" "${r.raw_product_name}" qty=${r.quantity} precio=$${r.price_per_unit} costo=$${r.cost_per_unit}`)
);

// ─── Impacto de precio=0 en ganancia
const impact = await pool.query(`
  SELECT
    COALESCE(SUM(oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric), 0) AS costo_price0
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND oi.price_per_unit::numeric = 0
    AND COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric > 0
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
`);
console.log(`\n  Costo total de ítems con precio=0: $${Number(impact.rows[0].costo_price0).toLocaleString("es-AR",{maximumFractionDigits:0})}`);
console.log(`  (Este monto reduce la ganancia_bruta sin ser incluido en ventas)`);

// ─── Ganancia si ignoramos costo de ítems precio=0
const gananciaAlternativa = await pool.query(`
  SELECT
    COALESCE(SUM(
      CASE WHEN oi.price_per_unit::numeric > 0 THEN
        oi.quantity::numeric * oi.price_per_unit::numeric
        - oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric
      ELSE 0 END
    ), 0) AS ganancia_items_con_precio
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
`);
console.log(`\n  Ganancia sin restar costo de bonificaciones: $${Number(gananciaAlternativa.rows[0].ganancia_items_con_precio).toLocaleString("es-AR",{maximumFractionDigits:0})}`);

// ─── Órdenes con items sin costo (cost=0) — posible dato incompleto
console.log("\n═══ Pedidos 14-17/04 con items de costo=0 ═══");
const zeroCost = await pool.query(`
  SELECT o.folio, o.order_date::date, c.name, oi.raw_product_name,
         oi.quantity, oi.price_per_unit, oi.cost_per_unit
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-14'
    AND oi.cost_per_unit::numeric = 0
    AND oi.price_per_unit::numeric > 0
  LIMIT 20
`);
console.log(`Total ítems con costo=0 en 14-17/04: ${zeroCost.rowCount}`);
zeroCost.rows.forEach(r =>
  console.log(`  ${r.folio} ${String(r.order_date).slice(0,10)} "${r.name}" "${r.raw_product_name}" precio=$${r.price_per_unit}`)
);

await pool.end();
