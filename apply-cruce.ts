import { storage } from "./server/storage";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const emit = async () => (await pool.query(`SELECT count(*)::int n, coalesce(sum(monto),0)::float t FROM cheques WHERE tipo='emitido' AND estado='en_cartera'`)).rows[0];
const mp = async () => (await pool.query(`SELECT count(*)::int n FROM caja_movements WHERE source_id LIKE 'mp:%'`)).rows[0].n;

console.log("ANTES → cheques emitidos en cartera:", await emit(), "| MP movs:", await mp());
const r = await storage.reconcileChequesEmitidos({ dryRun: false });   // APLICA DE VERDAD
console.log("\nAplicado: conciliados", r.conciliados, "| ya cobrados", r.yaCobrados, "| baja $" + r.baja.toLocaleString("es-AR"));

// Verificación real post-aplicación
console.log("\n=== ESTADO REAL DESPUÉS ===");
console.log("Cheques emitidos en cartera:", await emit(), "(esperado: 23 / $39.000.000)");
console.log("MP movs (no debe cambiar):", await mp(), "(esperado: 578)");
const c133 = (await pool.query(`SELECT id, estado, monto::float FROM cheques WHERE id=15`)).rows[0];
const o133 = (await pool.query(`SELECT id, estado FROM obligaciones WHERE id=60`)).rows[0];
console.log("Cheque #133 (id 15):", c133, "(esperado estado=cobrado)");
console.log("Obligación #133 (id 60):", o133, "(esperado estado=pagado)");
const sinMatch = (await pool.query(`SELECT comprobante, category FROM galicia_movements WHERE comprobante IN ('154','155','161')`)).rows;
console.log("Los 3 sin match (intactos, category 'Pago a proveedor'):", JSON.stringify(sinMatch));
await pool.end();
