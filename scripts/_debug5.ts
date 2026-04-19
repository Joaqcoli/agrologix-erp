import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Mermas/Rindes en Abril
console.log("═══ Stock movements Merma/Rinde en Abril ═══");
const merma = await pool.query(`
  SELECT notes, COUNT(*) AS n,
         SUM(quantity::numeric * COALESCE(unit_cost::numeric, 0)) AS pesos
  FROM stock_movements
  WHERE created_at >= '2026-04-01' AND created_at < '2026-05-01'
    AND (notes ILIKE '%Merma%' OR notes ILIKE '%Rinde%')
  GROUP BY notes
  ORDER BY pesos DESC
  LIMIT 10
`);
console.log(`Total registros: ${merma.rowCount}`);
merma.rows.forEach(r => console.log(`  "${r.notes}" n=${r.n} pesos=$${Number(r.pesos).toFixed(0)}`));

// ─── Dashboard stats completo simulado
console.log("\n═══ Dashboard stats: mermaTotal/rindeTotal ═══");
const mr = await pool.query(`
  SELECT
    COALESCE(SUM(CASE WHEN sm.notes ILIKE '%Merma%' THEN sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0) ELSE 0 END), 0) AS merma,
    COALESCE(SUM(CASE WHEN sm.notes ILIKE '%Rinde%' THEN sm.quantity::numeric * COALESCE(sm.unit_cost::numeric, 0) ELSE 0 END), 0) AS rinde
  FROM stock_movements sm
  WHERE sm.created_at >= '2026-04-01' AND sm.created_at < '2026-05-01'
    AND (sm.notes ILIKE '%Merma%' OR sm.notes ILIKE '%Rinde%')
`);
console.log(`  mermaTotal = $${Number(mr.rows[0].merma).toFixed(0)}`);
console.log(`  rindeTotal = $${Number(mr.rows[0].rinde).toFixed(0)}`);

// ─── Aprobar pedido de Paula Casero (VA-000116)
console.log("\n═══ Aprobando VA-000116 (PAULA CASERO 13/04) ═══");
const update = await pool.query(`
  UPDATE orders
  SET status = 'approved', approved_by = 1, approved_at = now()
  WHERE id = 579 AND status = 'draft'
  RETURNING id, folio, status, total
`);
if (update.rowCount && update.rowCount > 0) {
  const r = update.rows[0];
  console.log(`  ✓ Aprobado: id=${r.id} ${r.folio} status=${r.status} total=$${r.total}`);
} else {
  console.log("  ✗ No se pudo aprobar (ya estaba aprobado o no existe)");
}

// ─── Verificar CC de Paula post-aprobación
console.log("\n═══ CC Paula Casero post-aprobación ═══");
const cc = await pool.query(`
  SELECT o.folio, o.status, o.order_date::date, o.total
  FROM orders o
  WHERE o.customer_id = 69
  ORDER BY o.order_date DESC LIMIT 6
`);
cc.rows.forEach(r =>
  console.log(`  ${r.folio} ${String(r.order_date).slice(0,10)} ${r.status} $${r.total}`)
);

await pool.end();
