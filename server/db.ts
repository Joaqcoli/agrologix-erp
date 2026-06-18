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
  // Mantener las conexiones tibias: reabrir una contra el pooler de Supabase cuesta
  // ~850ms (TLS+auth). Subimos el idle timeout (30s → 5min) y activamos keepAlive
  // (TCP keep-alive) para que el pool no recicle conexiones y cada request no pague
  // esa reconexión. No cambia el uso del pooler (puerto 6543) ni ninguna query.
  idleTimeoutMillis: 300000, // 5 min (antes 30s)
  keepAlive: true,
});

// Set statement_timeout on each new connection to prevent hung queries
pool.on("connect", (client) => {
  client.query("SET statement_timeout = 60000").catch(() => {}); // 60s max per query
});

export const db = drizzle(pool, { schema });
export { pool };
