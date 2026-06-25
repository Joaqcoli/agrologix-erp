import { storage } from "./server/storage";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const emit = async () => (await pool.query(`SELECT count(*)::int n, coalesce(sum(monto),0)::float t FROM cheques WHERE tipo='emitido' AND estado='en_cartera'`)).rows[0];
const r = await storage.reconcileChequesEmitidos({ dryRun: false });
console.log("Re-corrida real → conciliados:", r.conciliados, "(esperado 0) | baja: $" + r.baja.toLocaleString("es-AR"), "(esperado 0) | ya cobrados:", r.yaCobrados, "(esperado 13)");
console.log("Cheques emitidos en cartera:", await emit(), "(sigue 23 / $39.000.000)");
await pool.end();
