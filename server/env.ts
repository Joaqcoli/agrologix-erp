import { config } from "dotenv";
import { resolve } from "path";

const cwd = process.cwd();
console.log('[ENV] cwd:', cwd);

config({ path: resolve(cwd, ".env") });
config({ path: resolve(cwd, "dist/.env") });

console.log('[ENV] SUPABASE_URL:', !!process.env.SUPABASE_URL);
console.log('[ENV] DATABASE_URL:', !!process.env.DATABASE_URL);
