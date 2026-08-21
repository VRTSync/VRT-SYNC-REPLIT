/**
 * scripts/src/import-master-bill.ts
 *
 * CLI entry-point for importing High Plains Property Maintenance master-bill
 * Excel workbooks. All parsing and import logic lives in the shared module:
 *   artifacts/api-server/src/masterBillImporter.ts
 *
 * Usage:
 *   pnpm run import-master-bill <path-to-xlsx> <billing-period> [--confirm]
 *
 * Always dry-run first, verify output, then --confirm:
 *   pnpm run import-master-bill ./bills/may-2026.xlsx master_bill_2026_05
 *   pnpm run import-master-bill ./bills/may-2026.xlsx master_bill_2026_05 --confirm
 *
 * Accepted billing periods: master_bill_2026_05, master_bill_2026_06, master_bill_2026_07
 */

import { readFileSync } from "fs";
import pg from "pg";
import {
  parseMasterBill,
  previewMasterBill,
  commitMasterBill,
  PERIOD_BASELINE,
  AGGREGATE,
  IMPORT_ORIGIN,
} from "../../artifacts/api-server/src/masterBillImporter.js";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { xlsxPath: string; batchLabel: string; confirm: boolean } {
  const args = process.argv.slice(2);
  const confirm   = args.includes("--confirm");
  const positional = args.filter(a => !a.startsWith("--"));

  if (positional.length < 2) {
    console.error("Usage: import-master-bill <path-to-xlsx> <billing-period> [--confirm]");
    console.error("  billing-period — one of: " + Object.keys(PERIOD_BASELINE).join(", "));
    process.exit(1);
  }

  const [xlsxPath, batchLabel] = positional;
  if (!batchLabel || !(batchLabel in PERIOD_BASELINE)) {
    console.error(
      `ERROR: "${batchLabel}" is not a validated billing period.\n` +
      `Accepted values: ${Object.keys(PERIOD_BASELINE).join(", ")}`,
    );
    process.exit(1);
  }

  return { xlsxPath: xlsxPath!, batchLabel: batchLabel!, confirm };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { xlsxPath, batchLabel, confirm } = parseArgs();

  console.log(`\n${"=".repeat(72)}`);
  console.log(`  Master Bill Import — ${batchLabel}`);
  console.log(`  Mode: ${confirm ? "CONFIRM (writes to database)" : "DRY RUN (no writes)"}`);
  console.log(`${"=".repeat(72)}\n`);

  // Load workbook
  let buffer: Buffer;
  try {
    buffer = readFileSync(xlsxPath);
  } catch (err) {
    console.error(`ERROR: Cannot read "${xlsxPath}": ${(err as NodeJS.ErrnoException).message}`);
    process.exit(1);
  }

  // Parse workbook (pure — no DB)
  console.log("── Parsing workbook ".padEnd(72, "─"));
  const parsed = parseMasterBill(buffer, batchLabel);
  console.log(`  Rows parsed    : ${parsed.rows.length}`);
  console.log(`  Skipped rows   : ${parsed.skippedRows.length}`);
  console.log(`  Date-clamped   : ${parsed.clampedRows.length}`);
  console.log();

  // Skipped rows report
  if (parsed.skippedRows.length > 0) {
    console.log("── Skipped rows ".padEnd(72, "─"));
    for (const s of parsed.skippedRows) {
      console.log(`  Row ${String(s.excelRow).padStart(4)}: ${s.reason}`);
    }
    console.log();
  }

  // Generate dry-run preview (resolves communities from DB)
  console.log("── Generating preview ".padEnd(72, "─"));
  const preview = await previewMasterBill(parsed, pool);

  // Community mapping
  console.log("\n── Community mapping ".padEnd(72, "─"));
  for (const c of preview.communityMapping) {
    console.log(`  ${c.code.padEnd(6)} →  ${c.name.padEnd(40)} id: ${c.id}`);
  }
  console.log();

  // Blocking errors
  if (preview.blockingErrors.length > 0) {
    console.error("── BLOCKING ERRORS ".padEnd(72, "─"));
    for (const e of preview.blockingErrors) {
      console.error(`  ⛔ ${e}`);
    }
    console.log();
    if (!confirm) {
      console.log("DRY RUN complete — blocking errors found. Correct them and retry.\n");
    } else {
      console.error("ABORT: Blocking errors prevent commit. Correct them and re-run without --confirm first.\n");
    }
    await pool.end();
    process.exit(confirm ? 1 : 0);
  }

  // Per-branch counts
  console.log("── Per-branch counts ".padEnd(72, "─"));
  console.log(`  ${"Code".padEnd(8)} ${"Invoices".padEnd(12)} ${"Completions".padEnd(14)} Contracts`);
  for (const [code, counts] of Object.entries(preview.perBranchCounts).sort()) {
    console.log(`  ${code.padEnd(8)} ${String(counts.invoices).padEnd(12)} ${String(counts.completions).padEnd(14)} ${counts.contracts}`);
  }
  console.log();

  // Totals
  console.log("── Totals ".padEnd(72, "─"));
  console.log(`  Invoice rows    : ${preview.totals.invoiceRows}`);
  console.log(`  Completion rows : ${preview.totals.completionRows}`);
  console.log(`  Contract-only   : ${preview.totals.contractRows}`);
  console.log(`  Total amount    : $${preview.totals.totalAmount.toFixed(2)}`);
  console.log();
  console.log(`  Expected aggregate across all three bills:`);
  console.log(`    Invoices    : ${AGGREGATE.invoices}`);
  console.log(`    Completions : ${AGGREGATE.completions}`);
  console.log(`    Total amount: $${(AGGREGATE.totalCents / 100).toFixed(2)}`);
  console.log();

  // Service account
  console.log("── Contractor resolution ".padEnd(72, "─"));
  if (preview.serviceAccountResolution.exists) {
    console.log(`  Using existing: "${preview.serviceAccountResolution.displayName}" (${preview.serviceAccountResolution.id})`);
  } else {
    console.log(`  [DRY RUN] No HP contractor found — would create: "${preview.serviceAccountResolution.displayName}"`);
  }
  console.log();

  // Dry run ends here
  if (!confirm) {
    console.log("DRY RUN complete — nothing written.\n");
    console.log("Verify the mapping table, per-branch counts, and totals above.");
    console.log("Then re-run with --confirm to write to production.\n");
    await pool.end();
    return;
  }

  // Confirm mode — commit
  console.log("── Importing (confirm mode) ".padEnd(72, "─"));
  const result = await commitMasterBill(parsed, preview, pool, "cli-import");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`  Import complete — ${batchLabel}`);
  console.log(`${"=".repeat(72)}`);
  console.log(`  Invoice rows inserted : ${result.invoicesInserted}`);
  console.log(`  Invoice rows skipped  : ${result.invoicesSkipped} (idempotent)`);
  console.log(`  Task rows inserted    : ${result.tasksInserted}`);
  console.log(`  Task rows skipped     : ${result.tasksSkipped} (idempotent)`);
  console.log();
  console.log(`  Undo commands for this batch:`);
  console.log(result.undoSQL.split("\n").map(l => `    ${l}`).join("\n"));
  console.log(`${"=".repeat(72)}\n`);

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  pool.end().finally(() => process.exit(1));
});
