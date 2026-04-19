import * as path from "path";
import * as fs from "fs";
import { Pool } from "pg";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Eliminar pedidos creados en la corrida fallida: VA-000001 y VA-000002 (COLEGIO WASHINGTON 14/04 y 17/04)
const r = await pool.query(
  `SELECT id, folio, customer_id, order_date::date FROM orders WHERE folio IN ('VA-000001','VA-000002')`
);
console.log("Pedidos a eliminar:");
r.rows.forEach((row) => console.log(`  id=${row.id} folio=${row.folio} cid=${row.customer_id} date=${row.order_date}`));

// Eliminar order_items primero (FK), luego orders
const ids = r.rows.map((row) => row.id);
if (ids.length > 0) {
  await pool.query(`DELETE FROM order_items WHERE order_id = ANY($1::int[])`, [ids]);
  const del = await pool.query(`DELETE FROM orders WHERE id = ANY($1::int[])`, [ids]);
  console.log(`\n✓ Eliminados ${del.rowCount} pedidos y sus ítems`);
} else {
  console.log("No se encontraron pedidos con esos folios.");
}

await pool.end();
