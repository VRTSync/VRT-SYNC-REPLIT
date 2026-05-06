import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

/**
 * Run Drizzle versioned migrations against the given pool.
 * Returns the number of migrations that were applied.
 *
 * The caller must supply the absolute path to the migrations folder because
 * this file is bundled by esbuild and __dirname becomes the dist output dir.
 */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<number> {
  const db = drizzle(pool);

  // Count already-applied migrations before running (table may not exist on first boot).
  let beforeCount = 0;
  try {
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations'
    );
    beforeCount = parseInt(result.rows[0].count, 10);
  } catch {
    // Table does not exist yet — first run on a clean database.
    beforeCount = 0;
  }

  await migrate(db, {
    migrationsFolder,
    migrationsSchema: "drizzle",
  });

  const afterResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations'
  );
  const afterCount = parseInt(afterResult.rows[0].count, 10);
  return afterCount - beforeCount;
}
