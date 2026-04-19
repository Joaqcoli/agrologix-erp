import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Paula Casero: detalle del pedido draft 13/04
console.log("═══ PAULA CASERO — pedido draft 13/04 ═══");
const paulaDraft = await pool.query(`
  SELECT o.id, o.folio, o.status, o.total, o.order_date::date, o.remito_num,
         COUNT(oi.id) AS items
  FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
  WHERE o.customer_id = 69
  GROUP BY o.id ORDER BY o.order_date DESC
`);
paulaDraft.rows.forEach(r =>
  console.log(`  id=${r.id} ${r.folio} ${String(r.order_date).slice(0,10)} ${r.status} $${r.total} items=${r.items}`)
);

// ─── has_iva de los clientes con pedidos en 14-17/04
console.log("\n═══ has_iva de clientes con pedidos 14-17/04 ═══");
const hasIvaCheck = await pool.query(`
  SELECT DISTINCT c.id, c.name, c.has_iva
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.order_date >= '2026-04-14' AND o.status = 'approved'
  ORDER BY c.name
`);
hasIvaCheck.rows.forEach(r =>
  console.log(`  id=${r.id} has_iva=${r.has_iva} "${r.name}"`)
);

// ─── Dashboard ventas y ganancia recalculado manualmente
console.log("\n═══ Recálculo dashboard Abril (con IVA) ═══");
const dashboardCalc = await pool.query(`
  SELECT
    COALESCE(SUM(
      CASE
        WHEN oi.price_per_unit::numeric = 0 THEN 0
        WHEN c.has_iva = true AND (p.name ILIKE '%huevo%' OR p.name ILIKE '%maple%')
          THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.21
        WHEN c.has_iva = true
          THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.105
        ELSE oi.quantity::numeric * oi.price_per_unit::numeric
      END
    ), 0) AS ventas,
    COALESCE(SUM(
      CASE
        WHEN oi.price_per_unit::numeric = 0 THEN 0
        WHEN c.has_iva = true AND (p.name ILIKE '%huevo%' OR p.name ILIKE '%maple%')
          THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.21
        WHEN c.has_iva = true
          THEN oi.quantity::numeric * oi.price_per_unit::numeric * 1.105
        ELSE oi.quantity::numeric * oi.price_per_unit::numeric
      END
      - oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric
    ), 0) AS ganancia_bruta,
    COUNT(DISTINCT o.id) AS pedidos,
    COUNT(DISTINCT o.order_date::date) AS dias_trabajados
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-01'
    AND o.order_date < '2026-05-01'
    AND (o.notes IS NULL OR o.notes NOT LIKE '%Facturación histórica importada%')
`);
const d = dashboardCalc.rows[0];
console.log(`  Ventas con IVA  : $${Number(d.ventas).toLocaleString("es-AR", {maximumFractionDigits:0})}`);
console.log(`  Ganancia bruta  : $${Number(d.ganancia_bruta).toLocaleString("es-AR", {maximumFractionDigits:0})}`);
console.log(`  Margen          : ${(Number(d.ganancia_bruta)/Number(d.ventas)*100).toFixed(1)}%`);
console.log(`  Pedidos         : ${d.pedidos}`);
console.log(`  Días trabajados : ${d.dias_trabajados}`);

// ─── Desglose por día para 14-17
console.log("\n═══ Desglose por día 14-17/04 ═══");
const byDay = await pool.query(`
  SELECT
    o.order_date::date AS dia,
    COUNT(DISTINCT o.id) AS pedidos,
    COALESCE(SUM(oi.quantity::numeric * oi.price_per_unit::numeric), 0) AS ventas_sin_iva,
    COALESCE(SUM(oi.quantity::numeric * COALESCE(oi.override_cost_per_unit, oi.cost_per_unit)::numeric), 0) AS costo
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status = 'approved'
    AND o.order_date >= '2026-04-14'
    AND o.order_date < '2026-05-01'
    AND oi.price_per_unit::numeric > 0
  GROUP BY o.order_date::date
  ORDER BY o.order_date::date
`);
byDay.rows.forEach(r =>
  console.log(`  ${String(r.dia).slice(0,10)} pedidos=${r.pedidos} ventas_sin_iva=$${Number(r.ventas_sin_iva).toLocaleString("es-AR",{maximumFractionDigits:0})} costo=$${Number(r.costo).toLocaleString("es-AR",{maximumFractionDigits:0})} margen=$${(Number(r.ventas_sin_iva)-Number(r.costo)).toLocaleString("es-AR",{maximumFractionDigits:0})}`)
);

await pool.end();
