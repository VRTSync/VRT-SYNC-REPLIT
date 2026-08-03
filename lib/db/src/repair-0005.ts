/**
 * repair-0005.ts — One-time idempotent repair for the 0005_commercial_tier_phase1 migration.
 *
 * BACKGROUND
 * ----------
 * The _journal.json entry for 0005_commercial_tier_phase1 was originally authored with
 * `when = 1754092800000`, a timestamp earlier than migrations 0001–0004. Drizzle's
 * migrator selects MAX(created_at) from its tracking table and only applies journal
 * entries whose `when` is strictly greater than that value. Because 0005's `when` was
 * less than every already-applied migration, Drizzle permanently skipped it.
 *
 * Side-effect: a duplicate tracking row (same hash as 0004) was recorded in
 * drizzle.__drizzle_migrations as a result of the corrupted state.
 *
 * FIX APPLIED IN SOURCE
 * ---------------------
 * - `_journal.json`: 0005's `when` was corrected to 1779226800000 (between 0004 and 0006,
 *   strictly ascending).
 *
 * WHAT THIS SCRIPT DOES (safe to run multiple times)
 * ---------------------------------------------------
 * 1. Removes any tracking row whose hash matches 0004's hash but is a duplicate
 *    (i.e., it is not the first such row — the legitimate 0004 entry is kept).
 * 2. Applies all 0005 schema changes via IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 *    so re-running is always a no-op on a patched database.
 * 3. Ensures 0005 is recorded in drizzle.__drizzle_migrations with the correct hash
 *    (964a97a5…) at timestamp 1779226800000.  Any prior tracking row for 0005 at a
 *    wrong timestamp is corrected in place.
 *
 * VALIDATION QUERIES (run after script to verify)
 * -----------------------------------------------
 *   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
 *   SELECT unnest(enum_range(NULL::user_role));           -- must include 'client_admin'
 *   SELECT unnest(enum_range(NULL::service_type));        -- must include all 6 values
 *   SELECT column_name FROM information_schema.columns
 *     WHERE table_name='tasks'
 *     AND column_name IN ('estimate_cents','approved_at','approved_by');
 *
 * USAGE
 *   DATABASE_URL=<url> pnpm --filter @workspace/db run repair:0005
 */

import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../migrations");

// Known hashes (computed from lib/db/migrations/*.sql via sha256(rawContent))
const HASH_0004 = "66f622ebe673d21a64f24da531139fc0c7aa62fcc3a2fe982b126cdef56671e4";
const HASH_0005 = "964a97a5c63502f520efb96b2dd83a1359208b9a42729e0fdbdd6a61b7f38681";
const WHEN_0005 = 1779226800000; // corrected monotonic timestamp for 0005

/** Compute SHA-256 hash of a migration SQL file — same algorithm as Drizzle. */
function computeFileHash(tag: string): string {
  const content = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function repair() {
  const client = await pool.connect();
  try {
    // ── Sanity-check computed hashes match known values ──────────────────────
    const actual0004 = computeFileHash("0004_add_capture_metadata_to_assets");
    const actual0005 = computeFileHash("0005_commercial_tier_phase1");
    if (actual0004 !== HASH_0004) throw new Error(`Hash mismatch for 0004: got ${actual0004}`);
    if (actual0005 !== HASH_0005) throw new Error(`Hash mismatch for 0005: got ${actual0005}`);
    console.log("✓ File hashes verified against known values");

    // ── Step 1: Remove duplicate 0004-hash rows ──────────────────────────────
    // Keep the row with the lowest id that has HASH_0004; delete any others.
    const dupResult = await client.query<{ id: number }>(
      `SELECT id FROM drizzle.__drizzle_migrations WHERE hash = $1 ORDER BY id`,
      [HASH_0004]
    );
    if (dupResult.rows.length > 1) {
      const keepId = dupResult.rows[0].id;
      const deleteIds = dupResult.rows.slice(1).map((r) => r.id);
      await client.query(
        `DELETE FROM drizzle.__drizzle_migrations WHERE id = ANY($1::int[])`,
        [deleteIds]
      );
      console.log(`✓ Removed ${deleteIds.length} duplicate tracking row(s) for 0004 hash (kept id=${keepId})`);
    } else {
      console.log("✓ No duplicate 0004-hash rows found");
    }

    // ── Step 2: Apply 0005 schema changes (all idempotent) ───────────────────
    await client.query(`
      -- client_admin enum value (PG 9.6+: IF NOT EXISTS)
      ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'client_admin';

      -- organizations table
      CREATE TABLE IF NOT EXISTS "organizations" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "kind" varchar NOT NULL DEFAULT 'commercial',
        "contact_name" text,
        "contact_email" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      );

      -- additive columns on communities
      ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "organization_id" varchar REFERENCES "organizations"("id") ON DELETE SET NULL;
      ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "code" varchar;
      ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "address" text;
      ALTER TABLE "communities" ADD COLUMN IF NOT EXISTS "city" text;

      -- indexes on communities
      CREATE INDEX IF NOT EXISTS "communities_organization_id_idx" ON "communities" ("organization_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "communities_org_code_unique"
        ON "communities" ("organization_id", "code")
        WHERE organization_id IS NOT NULL AND code IS NOT NULL;

      -- branch_groups table
      CREATE TABLE IF NOT EXISTS "branch_groups" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "color" varchar,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp DEFAULT now() NOT NULL
      );

      -- branch_group_members table
      CREATE TABLE IF NOT EXISTS "branch_group_members" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "group_id" varchar NOT NULL REFERENCES "branch_groups"("id") ON DELETE CASCADE,
        "community_id" varchar NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "branch_group_members_group_community_idx"
        ON "branch_group_members" ("group_id", "community_id");

      -- organization_id on users
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" varchar
        REFERENCES "organizations"("id") ON DELETE SET NULL;

      -- work-order approval columns on tasks
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimate_cents" integer;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approved_by" varchar
        REFERENCES "users"("id") ON DELETE SET NULL;
    `);
    console.log("✓ 0005 schema applied (all statements used IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)");

    // ── Step 3: Ensure 0005 tracking row exists with correct hash/timestamp ──
    const existing0005 = await client.query<{ id: number; created_at: string }>(
      `SELECT id, created_at FROM drizzle.__drizzle_migrations WHERE hash = $1`,
      [HASH_0005]
    );
    if (existing0005.rows.length === 0) {
      // Not tracked yet — insert
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [HASH_0005, WHEN_0005]
      );
      console.log(`✓ Inserted 0005 tracking row (hash=${HASH_0005.slice(0, 12)}…, created_at=${WHEN_0005})`);
    } else {
      const row = existing0005.rows[0];
      if (Number(row.created_at) !== WHEN_0005) {
        // Tracked at wrong timestamp — correct it
        await client.query(
          `UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2`,
          [WHEN_0005, row.id]
        );
        console.log(`✓ Corrected 0005 tracking row id=${row.id}: created_at ${row.created_at} → ${WHEN_0005}`);
      } else {
        console.log(`✓ 0005 tracking row already correct (id=${row.id}, created_at=${WHEN_0005})`);
      }
    }

    // ── Validation output ────────────────────────────────────────────────────
    const trackerRows = await client.query(
      `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`
    );
    console.log("\nFinal tracking table (ordered by created_at):");
    for (const row of trackerRows.rows) {
      console.log(`  id=${row.id}  created_at=${row.created_at}  hash=${row.hash.slice(0, 12)}…`);
    }

    const roleValues = await client.query<{ unnest: string }>(
      `SELECT unnest(enum_range(NULL::user_role))`
    );
    console.log("\nuser_role values:", roleValues.rows.map((r) => r.unnest).join(", "));

    const taskCols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tasks'
       AND column_name IN ('estimate_cents', 'approved_at', 'approved_by')
       ORDER BY column_name`
    );
    console.log("tasks 0005 columns:", taskCols.rows.map((r) => r.column_name).join(", "));

    console.log("\n✓ Repair complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

repair().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
