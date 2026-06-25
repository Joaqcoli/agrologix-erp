import { storage, matchSocioByLeyenda } from "./server/storage";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const socios = (await pool.query(`SELECT id, nombre FROM socios WHERE activo=true`)).rows;
const mpRetBefore = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE movimiento_ref LIKE 'mp:%'`)).rows[0].n;
const manRetBefore = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE origen='manual'`)).rows[0].n;
const galRetBefore = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE movimiento_ref LIKE 'galicia:%'`)).rows[0].n;
console.log("RETIROS al inicio → MP:", mpRetBefore, "| manuales:", manRetBefore, "| galicia:", galRetBefore);

// ===== AUTOMÁTICO =====
console.log("\n===== AUTOMÁTICO (match real + creación + idempotencia) =====");
const fede = (await pool.query(`SELECT id, leyendas, debito::float monto, fecha FROM galicia_movements WHERE category='Retiro' ORDER BY fecha`)).rows;
console.log("a) Match leyenda→socio (función REAL matchSocioByLeyenda):");
for (const r of fede) console.log(`   "${r.leyendas?.slice(0,28)}…" → socioId ${matchSocioByLeyenda(r.leyendas, socios)} (esperado 2=Federico)`);

const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Simular que los 3 son NUEVOS: borrarlos + replicar EXACTO la lógica retiro del import
  for (const r of fede) {
    const sourceId = 'galicia:'+r.id;
    await client.query(`DELETE FROM retiros WHERE movimiento_ref=$1`, [sourceId]);  // por si hubiera
    const socioId = matchSocioByLeyenda(r.leyendas, socios);
    if (socioId != null) {
      await client.query(`INSERT INTO retiros (socio_id, monto, fecha, origen, movimiento_ref, notas)
        VALUES ($1,$2,$3,'movimiento',$4,$5) ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING`,
        [socioId, r.monto.toFixed(2), r.fecha, sourceId, r.leyendas]);
    }
  }
  let created = (await client.query(`SELECT socio_id, monto::float, movimiento_ref FROM retiros WHERE movimiento_ref LIKE 'galicia:%' ORDER BY monto`)).rows;
  console.log("b) Filas retiros creadas:", created.length, "(esperado 3)");
  for (const c of created) console.log(`   socio ${c.socio_id} | $${c.monto.toLocaleString("es-AR")} | ${c.movimiento_ref.slice(0,40)}`);
  // Idempotencia: re-insertar (como re-cargar) → ON CONFLICT, no duplica
  for (const r of fede) { const sid='galicia:'+r.id; const s=matchSocioByLeyenda(r.leyendas,socios);
    await client.query(`INSERT INTO retiros (socio_id,monto,fecha,origen,movimiento_ref,notas) VALUES ($1,$2,$3,'movimiento',$4,$5) ON CONFLICT (movimiento_ref) WHERE movimiento_ref IS NOT NULL DO NOTHING`,[s,r.monto.toFixed(2),r.fecha,sid,r.leyendas]); }
  const after2 = (await client.query(`SELECT count(*)::int n, sum(monto::float)::float t FROM retiros WHERE movimiento_ref LIKE 'galicia:%'`)).rows[0];
  console.log("c) Tras re-insertar (idempotencia):", after2.n, "filas (sigue 3), total $"+after2.t.toLocaleString("es-AR"), after2.n===3?"✅ no duplica":"❌");
  await client.query("ROLLBACK");
  console.log("   ROLLBACK — nada persistido.");
} finally { client.release(); }

// ===== MANUAL (función real setGaliciaCategory dryRun) =====
console.log("\n===== MANUAL (setGaliciaCategory dryRun, función REAL) =====");
const noRet = (await pool.query(`SELECT id, category FROM galicia_movements WHERE category='Pago a proveedor' AND descripcion LIKE '%Echeq%' LIMIT 1`)).rows[0];
console.log("Movimiento de prueba:", noRet.id.slice(0,40), "| categoría original:", noRet.category);
const ev = await storage.setGaliciaCategory(noRet.id, "Retiro", { dryRun: true, socioId: 2 });
console.log("BEFORE:    retiros=", ev.before.retiroCount, "| cat:", ev.before.galiciaCategory);
console.log("AFTER(→Retiro socio 2): retiros=", ev.after.retiroCount, JSON.stringify(ev.after.retiroRows), "| cat:", ev.after.galiciaCategory);
console.log("ROUNDTRIP(→original):   retiros=", ev.roundtrip.retiroCount, "| cat:", ev.roundtrip.galiciaCategory);
console.log("CHECKS:");
console.log("  crea retiro al poner Retiro+socio:", ev.after.retiroCount===1 && ev.after.retiroRows[0]?.socio_id===2 ? "✅" : "❌");
console.log("  borra retiro al salir de Retiro:  ", ev.roundtrip.retiroCount===0 ? "✅" : "❌");

// ===== MP intacto + base intacta =====
const mpRetAfter = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE movimiento_ref LIKE 'mp:%'`)).rows[0].n;
const manRetAfter = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE origen='manual'`)).rows[0].n;
const galRetAfter = (await pool.query(`SELECT count(*)::int n FROM retiros WHERE movimiento_ref LIKE 'galicia:%'`)).rows[0].n;
console.log("\n===== MP / base intactos =====");
console.log("MP retiros:", mpRetBefore, "→", mpRetAfter, mpRetBefore===mpRetAfter?"✅ sin tocar":"❌");
console.log("manuales:", manRetBefore, "→", manRetAfter, manRetBefore===manRetAfter?"✅":"❌");
console.log("galicia retiros:", galRetBefore, "→", galRetAfter, galRetBefore===galRetAfter?"✅ sin cambios reales (todo fue dryRun/rollback)":"❌");
const afe = (await pool.query(`SELECT afecta_egresos FROM bank_categories WHERE name='Retiro'`)).rows[0];
console.log("'Retiro' afecta_egresos:", afe?.afecta_egresos, "→ excluido del gráfico de egresos:", afe?.afecta_egresos===false?"✅":"❌");
await pool.end();
