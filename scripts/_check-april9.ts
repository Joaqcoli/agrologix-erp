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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  // DB: todos los pedidos aprobados de abril, stored total vs sum(items)
  const r = await pool.query(`
    SELECT o.id, o.folio, o.remito_num, o.order_date::date as date,
           o.total::numeric as stored_total,
           COALESCE(SUM(oi.subtotal::numeric), 0) as items_sum,
           c.name as customer
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.order_date::date >= '2026-04-01'
      AND o.order_date::date < '2026-05-01'
      AND o.status = 'approved'
    GROUP BY o.id, o.total, c.name
    ORDER BY o.order_date, c.name
  `);

  console.log("=== Pedidos abril: stored_total vs SUM(order_items.subtotal) ===\n");
  let diffs = 0;
  for (const row of r.rows) {
    const stored = Math.round(Number(row.stored_total));
    const items = Math.round(Number(row.items_sum));
    const diff = Math.abs(stored - items);
    if (diff > 1) {
      console.log(`  ${row.date}  id=${String(row.id).padEnd(5)} rto=${String(row.remito_num ?? "-").padEnd(4)}  ${row.customer.padEnd(40)}  stored=$${stored.toLocaleString("es-AR").padStart(10)}  items=$${items.toLocaleString("es-AR").padStart(10)}  DIFF=$${diff.toLocaleString("es-AR")}`);
      diffs++;
    }
  }
  if (diffs === 0) {
    console.log("  Todos los pedidos: stored_total == sum(items). El problema es en otro lado.");
  }
  console.log(`\nTotal pedidos abril: ${r.rows.length}  Con diferencia: ${diffs}`);

  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
