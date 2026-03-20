import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

const connectionString = process.env.SUPABASE_URL || process.env.DATABASE_URL;

console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'PRESENTE' : 'AUSENTE');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'PRESENTE' : 'AUSENTE');
console.log('connectionString final:', connectionString ? 'PRESENTE' : 'AUSENTE');

if (!connectionString) {
  throw new Error("No hay URL de base de datos configurada (SUPABASE_URL o DATABASE_URL)");
}

const needsSsl = /neon|supabase/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
export { pool };
