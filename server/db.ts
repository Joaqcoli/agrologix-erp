import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

console.log('ENV vars disponibles:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('DATABASE')));
console.log('DATABASE_URL valor:', process.env.DATABASE_URL ? 'PRESENTE' : 'AUSENTE');

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está configurada");
}

const needsSsl = /neon|supabase/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
export { pool };
