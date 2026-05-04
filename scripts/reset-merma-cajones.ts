/**
 * reset-merma-cajones.ts
 *
 * Deja en $0:
 *   - unit_cost de stock_movements de Merma/Rinde (histórico sucio)
 *   - empty_cost de purchase_items (cajones/depósitos)
 *
 * A partir de mañana se empiezan a registrar correctamente.
 *
 * Uso:
 *   npx tsx scripts/reset-merma-cajones.ts            ← dry-run (muestra qué haría)
 *   npx tsx scripts/reset-merma-cajones.ts --apply    ← aplica los cambios
 */

import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const APPLY = process.argv.includes("--apply");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  await pool.query("SELECT 1");
  console.log("✓ DB conectada\n");

  // ─── Merma / Rinde ──────────────────────────────────────────────────────────
  const smCount = await pool.query(`
    SELECT COUNT(*) as n,
           COALESCE(SUM(quantity::numeric * unit_cost::numeric), 0) AS total
    FROM stock_movements
    WHERE (notes ILIKE '%Merma%' OR notes ILIKE '%Rinde%')
      AND unit_cost::numeric > 0
  `);
  const smN = Number(smCount.rows[0].n);
  const smTotal = Math.round(Number(smCount.rows[0].total));
  console.log(`Merma/Rinde: ${smN} registros  →  impacto $${smTotal.toLocaleString("es-AR")}`);

  // ─── Cajones (empty_cost) ────────────────────────────────────────────────────
  const piCount = await pool.query(`
    SELECT COUNT(*) as n,
           COALESCE(SUM(empty_cost::numeric * COALESCE(purchase_qty, quantity)::numeric), 0) AS total
    FROM purchase_items
    WHERE empty_cost::numeric > 0
  `);
  const piN = Number(piCount.rows[0].n);
  const piTotal = Math.round(Number(piCount.rows[0].total));
  console.log(`Cajones vacíos: ${piN} líneas de compra  →  total $${piTotal.toLocaleString("es-AR")}`);

  if (!APPLY) {
    console.log("\n⚠  DRY-RUN — para aplicar: npx tsx scripts/reset-merma-cajones.ts --apply");
    await pool.end();
    return;
  }

  // ─── Aplicar ────────────────────────────────────────────────────────────────
  console.log("\nAplicando...");

  const r1 = await pool.query(`
    UPDATE stock_movements
    SET unit_cost = 0
    WHERE (notes ILIKE '%Merma%' OR notes ILIKE '%Rinde%')
      AND unit_cost::numeric > 0
  `);
  console.log(`  ✓ stock_movements: ${r1.rowCount} filas actualizadas (unit_cost → 0)`);

  const r2 = await pool.query(`
    UPDATE purchase_items
    SET empty_cost = 0
    WHERE empty_cost::numeric > 0
  `);
  console.log(`  ✓ purchase_items: ${r2.rowCount} filas actualizadas (empty_cost → 0)`);

  // ─── Verificación post ────────────────────────────────────────────────────
  const check1 = await pool.query(`
    SELECT COUNT(*) as n FROM stock_movements
    WHERE (notes ILIKE '%Merma%' OR notes ILIKE '%Rinde%') AND unit_cost::numeric > 0
  `);
  const check2 = await pool.query(`
    SELECT COUNT(*) as n FROM purchase_items WHERE empty_cost::numeric > 0
  `);

  console.log(`\n✓ Merma/Rinde con costo > 0 restantes: ${check1.rows[0].n}`);
  console.log(`✓ Cajones con empty_cost > 0 restantes: ${check2.rows[0].n}`);
  console.log("\n✅ Listo. El dashboard mostrará $0 en merma/rinde y vacíos hasta que se registren nuevos.");

  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
