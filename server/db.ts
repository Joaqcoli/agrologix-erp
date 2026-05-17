import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

export const connectionString = process.env.SUPABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("ADVERTENCIA: No hay URL de DB configurada. El servidor arranca pero las queries van a fallar.");
}

const needsSsl = /neon|supabase/.test(connectionString ?? "");

const pool = new Pool({
  connectionString: connectionString ?? undefined,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  connectionTimeoutMillis: 10000, // fail after 10s if no connection available
  idleTimeoutMillis: 30000,
});

// Set statement_timeout on each new connection to prevent hung queries
pool.on("connect", (client) => {
  client.query("SET statement_timeout = 60000").catch(() => {}); // 60s max per query
});

export const db = drizzle(pool, { schema });
export { pool };
