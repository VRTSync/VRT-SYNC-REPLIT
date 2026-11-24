import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db";
import { logger } from "./lib/logger";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// PostgreSQL NOTICE messages are events, not stdout; surface the migration's
// requested deployment evidence without logging unrelated database notices.
pool.on("connect", (client) => {
  client.on("notice", (notice) => {
    if (notice.message?.startsWith("P2 counts:")) logger.info(notice.message);
  });
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export const db = drizzle(pool, { schema });
