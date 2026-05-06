import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { runMigrations } from "./migrate.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "../migrations");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const start = Date.now();
  await runMigrations(pool, migrationsFolder);
  const elapsed = Date.now() - start;
  console.log(`Migrations applied in ${elapsed}ms`);
} finally {
  await pool.end();
}
