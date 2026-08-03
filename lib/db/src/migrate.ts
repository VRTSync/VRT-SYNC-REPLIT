import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Run Drizzle versioned migrations against the given pool.
 * Returns the number of migrations that were applied.
 *
 * The caller must supply the absolute path to the migrations folder because
 * this file is bundled by esbuild and __dirname becomes the dist output dir.
 *
 * Pre-population guard: if the tracker table is empty but the schema is
 * already present (i.e. previously applied via `drizzle push` without a
 * tracker), we backfill the tracker so that migrate() skips migrations that
 * are already applied rather than re-running them and crashing on duplicate
 * enum values, columns, etc.
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

  // Detect the push-without-tracker scenario: tracker is empty but the
  // asset_type enum already contains 'master_valve' (added by migration 0001).
  // In this case the schema was applied via drizzle push and we must backfill
  // the tracker to prevent migrate() from re-running destructive-free-but-
  // duplicate DDL that crashes on "enum label already exists".
  if (beforeCount === 0) {
    const schemaAlreadyApplied = await detectPushWithoutTracker(pool);
    if (schemaAlreadyApplied) {
      await backfillMigrationTracker(pool, migrationsFolder);
      try {
        const recount = await pool.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations'
        );
        beforeCount = parseInt(recount.rows[0].count, 10);
      } catch {
        beforeCount = 0;
      }
    }
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

/**
 * Returns true when the asset_type enum already contains 'master_valve'
 * (a value first added in migration 0001). This is the reliable sentinel for
 * "schema was applied via drizzle push; tracker is unaware."
 */
async function detectPushWithoutTracker(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'asset_type' AND e.enumlabel = 'master_valve'
      ) AS exists
    `);
    return result.rows[0]?.exists === true;
  } catch {
    return false;
  }
}

/**
 * Populate drizzle.__drizzle_migrations for every migration listed in the
 * journal, using the correct SHA-256 hash of each SQL file (same algorithm
 * Drizzle uses internally).  Entries already present are skipped.
 */
async function backfillMigrationTracker(pool: Pool, migrationsFolder: string): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal: { entries: Array<{ idx: number; tag: string; when: number }> } =
    JSON.parse(fs.readFileSync(journalPath, "utf8"));

  // Ensure the schema + table exist before we insert.
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const content = fs.readFileSync(sqlPath, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    await pool.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
       )`,
      [hash, entry.when]
    );
  }
}
