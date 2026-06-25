import { storage } from "./server/storage";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const snap = async () => {
  const cm = (await pool.query(`SELECT count(*)::int n FROM caja_movements`)).rows[0].n;
  const mp = (await pool.query(`SELECT count(*)::int n FROM caja_movements WHERE source_id LIKE 'mp:%'`)).rows[0].n;
  const emit = (await pool.query(`SELECT count(*)::int n, coalesce(sum(monto),0)::float t FROM cheques WHERE tipo='emitido' AND estado='en_cartera'`)).rows[0];
  const oblPend = (await pool.query(`SELECT count(*)::int n FROM obligaciones WHERE estado='pendiente'`)).rows[0].n;
  return { caja_movements: cm, mp, emitidoEnCartera_n: emit.n, emitidoEnCartera_total: emit.t, oblPendientes: oblPend };
};

console.log("ANTES:", await snap());
const r = await storage.reconcileChequesEmitidos({ dryRun: true });
console.log("\n=== DRY-RUN (rollback) ===");
console.log("ECHEQ en extracto:", r.echeqsExtracto, "| matches:", r.matches, "| conciliados (cambian):", r.conciliados, "| ya cobrados (solo vínculo):", r.yaCobrados);
console.log("\nDetalle de los matches:");
for (const d of r.detalle) console.log(`  Nº${d.numero.padEnd(5)} $${d.monto.toLocaleString("es-AR").padStart(11)} | ${d.contraparte.padEnd(28)} | antes:${d.estadoAntes.padEnd(10)} | ${d.fuenteNumero.padEnd(22)} | ${d.accion}`);
console.log("\nSIN match (quedan 'Pago a proveedor', intactos):");
for (const s of r.sinMatch) console.log(`  Nº${s.numero} $${s.monto.toLocaleString("es-AR")}`);
console.log("Dudosos (número ✓ monto ✗, NO se concilian):", r.dudosos.length, r.dudosos);
console.log("\nCheques emitidos ANTES:  $" + r.totalEmitidoAntes.toLocaleString("es-AR"));
console.log("Baja:                    $" + r.baja.toLocaleString("es-AR"));
console.log("Cheques emitidos DESPUÉS: $" + r.totalEmitidoDespues.toLocaleString("es-AR"));
console.log("¿Suman gasto? (debe ser 0):", r.sumanGasto);
console.log("\nDESPUÉS (debe ser idéntico a ANTES, fue rollback):", await snap());
await pool.end();
