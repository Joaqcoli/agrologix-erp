import { config } from "dotenv";
import { resolve } from "path";

const cwd = process.cwd();
config({ path: resolve(cwd, ".env") });
config({ path: resolve(cwd, "dist/.env") });
