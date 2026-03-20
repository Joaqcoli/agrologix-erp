import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

console.log('=== INICIO DEL PROCESO ===');
console.log('Todas las variables de entorno:', JSON.stringify(
  Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, k.toLowerCase().includes('pass') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('url') ? (v ? '[PRESENTE]' : '[AUSENTE]') : v])),
  null, 2
));

const connectionString = process.env.SUPABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("ADVERTENCIA: No hay URL de DB configurada. El servidor arranca pero las queries van a fallar.");
}

const needsSsl = /neon|supabase/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
export { pool };
