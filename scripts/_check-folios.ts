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

const r = await pool.query(`
  SELECT folio, o.customer_id, c.name, order_date::date
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE folio ~ '^VA-\\d+$'
  ORDER BY CAST(REPLACE(folio,'VA-','') AS INTEGER)
  LIMIT 50
`);
console.log(`Total VA folios: ${r.rowCount}`);
r.rows.forEach((row) =>
  console.log(row.folio, `cid=${row.customer_id}`, row.name.slice(0, 30).padEnd(30), String(row.order_date).slice(0, 10))
);

const maxR = await pool.query(`
  SELECT customer_id, c.name, MAX(CAST(REPLACE(folio,'VA-','') AS INTEGER)) AS max_folio, COUNT(*) as cnt
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE folio ~ '^VA-\\d+$'
  GROUP BY o.customer_id, c.name
  ORDER BY o.customer_id
`);
console.log("\nMax folio per customer:");
maxR.rows.forEach((row) =>
  console.log(`  cid=${row.customer_id} max=VA-${String(row.max_folio).padStart(6,"0")} cnt=${row.cnt} "${row.name}"`)
);

await pool.end();
