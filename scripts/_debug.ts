import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

console.log("═══ PAULA CASERO — clientes similares en DB ═══");
const similar = await pool.query(`
  SELECT id, name, active FROM customers
  WHERE name ILIKE '%paula%' OR name ILIKE '%casero%'
  ORDER BY id
`);
similar.rows.forEach((r) => console.log(`  id=${r.id} active=${r.active} "${r.name}"`));

console.log("\n═══ Pedidos por cliente con 'paula' ═══");
const orders = await pool.query(`
  SELECT o.id, o.folio, c.id AS cid, c.name, o.order_date::date, o.status, o.total
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE c.name ILIKE '%paula%' OR c.name ILIKE '%casero%'
  ORDER BY o.order_date DESC
  LIMIT 30
`);
orders.rows.forEach((r) =>
  console.log(`  ${r.folio} cid=${r.cid} "${r.name}" ${String(r.order_date).slice(0,10)} ${r.status} $${r.total}`)
);

console.log("\n═══ Dashboard: órdenes aprobadas del mes de abril (sin históricos) ═══");
const aprilOrders = await pool.query(`
  SELECT o.id, o.folio, o.order_date::date, o.total,
         COALESCE(SUM(oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric), 0) AS costo_total,
         COUNT(oi.id) AS items
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
  GROUP BY o.id, o.order_date, o.total
  ORDER BY o.order_date, o.id
  LIMIT 20
`);
console.log(`Total pedidos abril: ${aprilOrders.rowCount}`);
aprilOrders.rows.slice(0,10).forEach((r) =>
  console.log(`  id=${r.id} ${r.folio} ${String(r.order_date).slice(0,10)} total=$${r.total} costo=$${Number(r.costo_total).toFixed(0)} items=${r.items}`)
);

// ─── Chequear costo_per_unit de los pedidos nuevos importados
console.log("\n═══ Cost_per_unit en pedidos 14-17/04 (primeros 20 ítems) ═══");
const newItems = await pool.query(`
  SELECT o.folio, o.order_date::date, oi.raw_product_name, oi.quantity, oi.price_per_unit,
         oi.cost_per_unit, oi.override_cost_per_unit
  FROM orders o JOIN order_items oi ON oi.order_id = o.id
  WHERE o.order_date >= '2026-04-14'
    AND o.status = 'approved'
  LIMIT 20
`);
newItems.rows.forEach((r) =>
  console.log(`  ${r.folio} ${String(r.order_date).slice(0,10)} "${r.raw_product_name}" qty=${r.quantity} precio=${r.price_per_unit} costo=${r.cost_per_unit} override=${r.override_cost_per_unit}`)
);

// ─── Dashboard aggregate April
console.log("\n═══ Totales Abril dashboard ═══");
const totals = await pool.query(`
  SELECT
    COALESCE(SUM(oi.quantity::numeric * oi.price_per_unit::numeric), 0) AS ventas_sin_iva,
    COALESCE(SUM(oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric), 0) AS costo_total,
    COUNT(DISTINCT o.id) AS pedidos
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
    AND oi.price_per_unit::numeric > 0
`);
const t = totals.rows[0];
console.log(`  Ventas sin IVA : $${Number(t.ventas_sin_iva).toLocaleString("es-AR")}`);
console.log(`  Costo total    : $${Number(t.costo_total).toLocaleString("es-AR")}`);
console.log(`  Ganancia bruta : $${(Number(t.ventas_sin_iva) - Number(t.costo_total)).toLocaleString("es-AR")}`);
console.log(`  Pedidos        : ${t.pedidos}`);

await pool.end();
