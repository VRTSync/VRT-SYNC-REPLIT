/**
 * scripts/src/import-master-bill.ts
 *
 * Import High Plains Property Maintenance master bill Excel workbooks into the
 * VRTSync invoices + tasks tables.
 *
 * Usage:
 *   pnpm run import-master-bill <path-to-xlsx> <billing-period> [--confirm]
 *
 * Always dry-run first, verify output, then --confirm:
 *   pnpm run import-master-bill ./bills/may-2026.xlsx master_bill_2026_05
 *   pnpm run import-master-bill ./bills/may-2026.xlsx master_bill_2026_05 --confirm
 *
 * Billing period format: master_bill_YYYY_MM
 * Accepted values:       master_bill_2026_05, master_bill_2026_06, master_bill_2026_07
 *
 * ── Validated baselines (from docs/master-bill-data-validation-2026-08-11.md) ──
 *
 *  Aggregate across all three bills:
 *    Invoices   : 139
 *    Completions: 110 (non-Monthly-Landscape-Contract rows only)
 *    Total cost : $53,120.90
 *
 *  Per-branch completion totals (task_completions rows):
 *    FB01=9  FB02=14  FB08=14  FB15=12  FB16=9
 *    FB1B=14 FB36=10  FB45=1   FB4F=6   FB5F=13  FB65=8
 *
 *  Per-period:
 *    May 2026  : 10 contract rows, 10 date-clamped rows (contract lines dated 2026-06-01 → 2026-05-31)
 *    June 2026 : 10 contract rows, 10 date-clamped rows (contract lines dated 2026-07-01 → 2026-06-30)
 *    July 2026 :  9 contract rows,  0 date-clamped rows
 *
 * ── Undo a batch ────────────────────────────────────────────────────────────
 *   DELETE FROM invoices WHERE source_batch = 'master_bill_2026_05';
 *   DELETE FROM tasks WHERE origin = 'master_bill_import'
 *     AND import_fingerprint LIKE 'master_bill_2026_05:%';
 *   -- task_completions CASCADE-deletes from tasks.
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import pg from "pg";

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All 11 PNC branch codes present in the master bills. Hardcoded — do not derive. */
const KNOWN_PNC_CODES = new Set([
  "FB01", "FB02", "FB08", "FB15", "FB16",
  "FB1B", "FB36", "FB45", "FB4F", "FB5F", "FB65",
]);

const MONTHLY_CONTRACT_TYPE = "Monthly Landscape Contract";
const IMPORT_ORIGIN = "master_bill_import";
const CONTRACTOR_DISPLAY_NAME = "High Plains Property Maintenance";
const SERVICE_ACCOUNT_DISPLAY_NAME = "High Plains Property Maintenance \u2014 historical import";
const SERVICE_ACCOUNT_USERNAME = "hp-historical-import";

/** Any value matching this pattern must abort the run before the transaction commits. */
const FIRST_BANK_RE = /first\s*[-_]?bank/i;

// ---------------------------------------------------------------------------
// Validated baselines — source: docs/master-bill-data-validation-2026-08-11.md
// ---------------------------------------------------------------------------

/**
 * Per-period constraints derived from the validated source data.
 * clamps and contracts are fully specified per period; all three are load-bearing.
 */
interface PeriodBaseline {
  clamps:    number;   // rows whose date was clamped to period boundary
  contracts: number;   // Monthly Landscape Contract rows (invoice-only; no task/completion)
}

/**
 * Validated per-period baselines.
 * Any billing label NOT in this map is unconditionally rejected.
 */
const PERIOD_BASELINE: Record<string, PeriodBaseline> = {
  // May 2026 — 10 contract lines dated 2026-06-01 clamped to 2026-05-31
  master_bill_2026_05: { clamps: 10, contracts: 10 },
  // June 2026 — 10 contract lines dated 2026-07-01 clamped to 2026-06-30
  master_bill_2026_06: { clamps: 10, contracts: 10 },
  // July 2026 — 9 contract lines dated correctly (2026-07-31); no clamping
  master_bill_2026_07: { clamps: 0,  contracts: 9  },
};

/**
 * Known aggregate totals across all three bills.
 * Asserted via DB query at the end of every --confirm run.
 * When invoice count reaches 139, per-branch completion counts are also checked.
 */
const AGGREGATE = {
  invoices:    139,
  completions: 110,
  totalCents:  5_312_090,  // $53,120.90 — exact integer cents to avoid float drift
  /** Per-branch non-contract row (task_completion) counts across all three bills. */
  branchCompletions: {
    FB01:  9,
    FB02: 14,
    FB08: 14,
    FB15: 12,
    FB16:  9,
    FB1B: 14,
    FB36: 10,
    FB45:  1,
    FB4F:  6,
    FB5F: 13,
    FB65:  8,
  } as Record<string, number>,
} as const;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { xlsxPath: string; batchLabel: string; confirm: boolean } {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const positional = args.filter(a => !a.startsWith("--"));

  if (positional.length < 2) {
    console.error("Usage: import-master-bill <path-to-xlsx> <billing-period> [--confirm]");
    console.error("  billing-period — one of: " + Object.keys(PERIOD_BASELINE).join(", "));
    process.exit(1);
  }

  const [xlsxPath, batchLabel] = positional;

  // Reject unknown billing periods unconditionally
  if (!batchLabel || !(batchLabel in PERIOD_BASELINE)) {
    console.error(
      `ERROR: "${batchLabel}" is not a validated billing period.\n` +
      `Accepted values: ${Object.keys(PERIOD_BASELINE).join(", ")}\n` +
      `Billing periods outside the validated set cannot be imported.`,
    );
    process.exit(1);
  }

  return { xlsxPath: xlsxPath!, batchLabel: batchLabel!, confirm };
}

// ---------------------------------------------------------------------------
// Billing period helpers
// ---------------------------------------------------------------------------

interface BillingPeriod {
  year: number;
  month: number;
  startISO: string;  // "YYYY-MM-01"
  endISO: string;    // "YYYY-MM-DD" (last day of month)
}

function parseBillingPeriod(label: string): BillingPeriod {
  const m = label.match(/^master_bill_(\d{4})_(\d{2})$/);
  if (!m) throw new Error(`Invalid billing period label: ${label}`);
  const year  = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return {
    year, month,
    startISO: `${year}-${pad2(month)}-01`,
    endISO:   `${year}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

// ---------------------------------------------------------------------------
// Date parsing (mirrors contractImporter.ts approach)
// ---------------------------------------------------------------------------

function formatISO(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatISO(value);
  }

  if (typeof value === "number") {
    const epoch = new Date(1899, 11, 30);
    const d = new Date(epoch.getTime() + value * 86_400_000);
    if (isNaN(d.getTime())) return null;
    return formatISO(d);
  }

  const str = String(value).trim();
  if (!str) return null;

  const mdy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    let yr = parseInt(mdy[3]!, 10);
    if (yr < 100) yr += 2000;
    const d = new Date(yr, parseInt(mdy[1]!, 10) - 1, parseInt(mdy[2]!, 10));
    if (!isNaN(d.getTime())) return formatISO(d);
  }

  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const d = new Date(parseInt(ymd[1]!, 10), parseInt(ymd[2]!, 10) - 1, parseInt(ymd[3]!, 10));
    if (!isNaN(d.getTime())) return formatISO(d);
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return formatISO(d);
  return null;
}

function clampToRange(dateISO: string, period: BillingPeriod): string {
  if (dateISO < period.startISO) return period.startISO;
  if (dateISO > period.endISO)   return period.endISO;
  return dateISO;
}

// ---------------------------------------------------------------------------
// Task fingerprint
// ---------------------------------------------------------------------------

function computeTaskFingerprint(
  batchLabel: string,
  invoiceNumber: string,
  referenceNumber: string,
  pncCode: string,
): string {
  return `${batchLabel}:${invoiceNumber}:${referenceNumber}:${pncCode}`;
}

// ---------------------------------------------------------------------------
// First-Bank sentinel
// ---------------------------------------------------------------------------

function assertNoFirstBank(value: string, rowNum: number, column: string): void {
  if (FIRST_BANK_RE.test(value)) {
    throw new Error(
      `ABORT: First Bank string detected at Excel row ${rowNum}, column "${column}": "${value}"\n` +
      `This data must not reach the database. Verify source file and re-run.`,
    );
  }
}

function checkSentinelFields(fields: Record<string, string>, rowNum: number): void {
  for (const [col, val] of Object.entries(fields)) {
    if (val) assertNoFirstBank(val, rowNum, col);
  }
}

// ---------------------------------------------------------------------------
// Column finder — case-insensitive, exact then partial match
// ---------------------------------------------------------------------------

function findColumn(headers: string[], candidates: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return headers[idx]!;
  }
  for (const c of candidates) {
    const idx = lower.findIndex(h => h.includes(c.toLowerCase()));
    if (idx >= 0) return headers[idx]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsed row type
// ---------------------------------------------------------------------------

interface ParsedRow {
  excelRow: number;       // 1-based Excel row number for reporting
  pncCode: string;
  invoiceNumber: string;
  referenceNumber: string;
  serviceType: string;
  description: string;    // Description column → tasks.title / invoices.notes
  completionDate: string; // ISO, after clamping
  rawDate: string;        // ISO, before clamping
  wasClamped: boolean;
  cost: number;
}

// ---------------------------------------------------------------------------
// Parse workbook
// ---------------------------------------------------------------------------

interface ParseResult {
  rows: ParsedRow[];
  skippedRows: Array<{ excelRow: number; reason: string }>;
  clampedRows: Array<{ excelRow: number; before: string; after: string; serviceType: string }>;
}

function parseWorkbook(buffer: Buffer, batchLabel: string): ParseResult {
  const period = parseBillingPeriod(batchLabel);
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetName = wb.SheetNames.find(n => /service\s+detail/i.test(n));
  if (!sheetName) {
    throw new Error(
      `Sheet "Service Detail" not found. Available sheets: ${wb.SheetNames.join(", ")}`,
    );
  }

  const ws = wb.Sheets[sheetName];
  // layout: rows 1-3 title/metadata (indices 0-2), row 4 headers (index 3), data row 5+ (index 4+)
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 4) {
    throw new Error("Workbook has fewer than 4 rows — cannot find header at row 4.");
  }

  const headerRow = (raw[3] as unknown[]).map(h => String(h ?? "").trim());

  // Required columns — case-insensitive match against known variants
  const colPncCode     = findColumn(headerRow, ["pnc code", "pnc_code", "branch code", "property code", "code"]);
  const colInvoiceNum  = findColumn(headerRow, ["invoice #", "invoice no", "invoice number", "invoice#", "invoice"]);
  const colRefNum      = findColumn(headerRow, ["reference #", "reference no", "reference number", "ref #", "ref no", "reference"]);
  const colServiceType = findColumn(headerRow, ["service type", "work type", "type"]);
  const colDescription = findColumn(headerRow, ["description", "service description", "work description", "work detail", "detail", "notes", "remarks", "comments"]);
  const colDate        = findColumn(headerRow, ["service date", "completion date", "work date", "date of service", "date"]);
  const colAmount      = findColumn(headerRow, ["amount", "cost", "total", "charge", "price", "fee"]);

  const missing: string[] = [];
  if (!colPncCode)     missing.push("PNC Code");
  if (!colInvoiceNum)  missing.push("Invoice #");
  if (!colRefNum)      missing.push("Reference #");
  if (!colServiceType) missing.push("Service Type");
  if (!colDate)        missing.push("Date");
  if (!colAmount)      missing.push("Amount");
  if (missing.length > 0) {
    console.error("Available columns:", headerRow.join(", "));
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }

  if (!colDescription) {
    console.warn("WARN: No Description column found — task titles will fall back to Service Type.");
  }

  const rows: ParsedRow[] = [];
  const skippedRows: Array<{ excelRow: number; reason: string }> = [];
  const clampedRows: Array<{ excelRow: number; before: string; after: string; serviceType: string }> = [];

  const cell = (rowArr: unknown[], col: string): string =>
    String(rowArr[headerRow.indexOf(col)] ?? "").trim();

  for (let i = 4; i < raw.length; i++) {
    const excelRow = i + 1; // 1-indexed
    const rowArr = raw[i] as unknown[];

    const pncCode         = cell(rowArr, colPncCode!);
    const invoiceNumber   = cell(rowArr, colInvoiceNum!);
    const referenceNumber = cell(rowArr, colRefNum!);
    const serviceType     = cell(rowArr, colServiceType!);
    const description     = colDescription ? cell(rowArr, colDescription) : "";
    const dateRaw         = rowArr[headerRow.indexOf(colDate!)];
    const amountRaw       = rowArr[headerRow.indexOf(colAmount!)];

    // Skip fully blank rows
    if (!pncCode && !invoiceNumber && !serviceType) {
      skippedRows.push({ excelRow, reason: "blank row" });
      continue;
    }

    // Skip unknown PNC codes — GRAND TOTAL and footer rows fall out here automatically
    if (!KNOWN_PNC_CODES.has(pncCode)) {
      skippedRows.push({ excelRow, reason: `unknown PNC code "${pncCode}"` });
      continue;
    }

    // Guard: service type must be non-empty (spec says guard even though none expected)
    if (!serviceType) {
      skippedRows.push({ excelRow, reason: `empty service type (PNC: ${pncCode})` });
      continue;
    }

    // Parse date
    const rawDateISO = parseDate(dateRaw);
    if (!rawDateISO) {
      skippedRows.push({ excelRow, reason: `unparseable date: "${dateRaw}"` });
      continue;
    }

    // Clamp to billing period (general rule — not a hardcoded row list)
    const clampedISO = clampToRange(rawDateISO, period);
    const wasClamped = clampedISO !== rawDateISO;
    if (wasClamped) {
      clampedRows.push({ excelRow, before: rawDateISO, after: clampedISO, serviceType });
    }

    // Parse cost
    const costStr = String(amountRaw ?? "").replace(/[$,\s]/g, "");
    const cost = parseFloat(costStr);
    if (isNaN(cost)) {
      skippedRows.push({ excelRow, reason: `unparseable amount: "${amountRaw}"` });
      continue;
    }

    // First Bank sentinel — checked against every string destined for the DB
    checkSentinelFields(
      {
        "PNC Code":         pncCode,
        "Invoice #":        invoiceNumber,
        "Reference #":      referenceNumber,
        "Service Type":     serviceType,
        "Description":      description,
        "source":           IMPORT_ORIGIN,
        "source_batch":     batchLabel,
        "contractor":       CONTRACTOR_DISPLAY_NAME,
      },
      excelRow,
    );

    rows.push({
      excelRow,
      pncCode,
      invoiceNumber,
      referenceNumber,
      serviceType,
      description,
      completionDate: clampedISO,
      rawDate: rawDateISO,
      wasClamped,
      cost,
    });
  }

  return { rows, skippedRows, clampedRows };
}

// ---------------------------------------------------------------------------
// Community resolver — scoped to pilot org
// ---------------------------------------------------------------------------

interface CommunityRecord {
  id: string;
  name: string;
  code: string;
  organizationId: string;
}

async function resolveCommunities(
  rows: ParsedRow[],
): Promise<{ map: Map<string, CommunityRecord>; pilotOrgId: string }> {
  const codes = [...new Set(rows.map(r => r.pncCode))];
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(", ");

  const result = await pool.query<{
    id: string; name: string; code: string; organization_id: string;
  }>(
    `SELECT id, name, code, organization_id FROM communities WHERE code IN (${placeholders})`,
    codes,
  );

  // Group by code
  const byCode = new Map<string, CommunityRecord[]>();
  for (const row of result.rows) {
    const rec: CommunityRecord = {
      id: row.id, name: row.name, code: row.code, organizationId: row.organization_id,
    };
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code)!.push(rec);
  }

  const errors: string[] = [];
  for (const code of codes) {
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) {
      errors.push(`PNC Code "${code}" — 0 matching communities`);
    } else if (matches.length > 1) {
      errors.push(
        `PNC Code "${code}" — ${matches.length} communities: ` +
        matches.map(m => `${m.name} (org: ${m.organizationId})`).join(", "),
      );
    }
  }
  if (errors.length > 0) {
    console.error("Community resolution errors (stop and report — do not guess):");
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  }

  const communityMap = new Map<string, CommunityRecord>();
  for (const [code, [match]] of byCode) communityMap.set(code, match!);

  // All communities must belong to the same organisation — cross-org write prevention
  const orgIds = new Set([...communityMap.values()].map(c => c.organizationId));
  if (orgIds.size > 1) {
    console.error(
      `ABORT: PNC codes span ${orgIds.size} organizations — cross-org contamination prevented.`,
    );
    for (const [code, com] of communityMap) {
      console.error(`  ${code} → ${com.name} (org: ${com.organizationId})`);
    }
    process.exit(1);
  }

  return { map: communityMap, pilotOrgId: [...orgIds][0]! };
}

// ---------------------------------------------------------------------------
// Contractor resolver — read-only query only
// ---------------------------------------------------------------------------

async function findExistingContractor(): Promise<{ id: string; displayName: string } | null> {
  const r = await pool.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users
     WHERE role = 'contractor'
       AND (display_name ILIKE '%High Plains%' OR username = $1)
     ORDER BY created_at ASC LIMIT 1`,
    [SERVICE_ACCOUNT_USERNAME],
  );
  if (r.rows.length > 0) {
    return { id: r.rows[0]!.id, displayName: r.rows[0]!.display_name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

function assertExact(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed — ${label}:\n` +
      `  expected : ${expected}\n` +
      `  actual   : ${actual}\n` +
      `Aborting to protect production data integrity.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Completion notes builder
// ---------------------------------------------------------------------------

function buildCompletionNotes(row: ParsedRow): string {
  // Spec: '{Service Type} · Invoice {Invoice #} · Ref {Reference #}'
  const parts = [row.serviceType];
  parts.push(`Invoice ${row.invoiceNumber}`);
  if (row.referenceNumber) parts.push(`Ref ${row.referenceNumber}`);
  return parts.join(" \u00b7 ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { xlsxPath, batchLabel, confirm } = parseArgs();
  const period   = parseBillingPeriod(batchLabel);
  const baseline = PERIOD_BASELINE[batchLabel]!;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`  Master Bill Import \u2014 ${batchLabel}`);
  console.log(`  Billing period : ${period.startISO} \u2192 ${period.endISO}`);
  console.log(`  Mode           : ${confirm ? "CONFIRM (writes to database)" : "DRY RUN (no writes)"}`);
  console.log(`${"=".repeat(72)}\n`);

  // Load workbook
  let buffer: Buffer;
  try {
    buffer = readFileSync(xlsxPath);
  } catch (err) {
    console.error(`ERROR: Cannot read "${xlsxPath}": ${(err as NodeJS.ErrnoException).message}`);
    process.exit(1);
  }

  // Parse — First Bank sentinel runs inside parseWorkbook
  const { rows, skippedRows, clampedRows } = parseWorkbook(buffer, batchLabel);

  // ── Skipped rows ──────────────────────────────────────────────────────────
  console.log(`\u2500\u2500 Skipped rows (${skippedRows.length}) \u2500`.padEnd(72, "\u2500"));
  if (skippedRows.length === 0) {
    console.log("  (none)");
  } else {
    for (const s of skippedRows) {
      console.log(`  Row ${String(s.excelRow).padStart(4)}: ${s.reason}`);
    }
  }
  console.log();

  // ── Community resolution (scoped to pilot org) ────────────────────────────
  const { map: communityMap, pilotOrgId } = await resolveCommunities(rows);

  console.log(`\u2500\u2500 Community mapping \u2014 pilot org ${pilotOrgId} \u2500`.padEnd(72, "\u2500"));
  for (const [code, com] of [...communityMap.entries()].sort()) {
    console.log(`  ${code.padEnd(6)} \u2192  ${com.name.padEnd(40)} id: ${com.id}`);
  }
  console.log();

  // ── Classify rows ──────────────────────────────────────────────────────────
  const contractRows   = rows.filter(r => r.serviceType === MONTHLY_CONTRACT_TYPE);
  const completionRows = rows.filter(r => r.serviceType !== MONTHLY_CONTRACT_TYPE);

  // ── Assertions (run before any write — catches data problems in dry-run too) ─
  console.log(`\u2500\u2500 Assertions \u2500`.padEnd(72, "\u2500"));

  // 1. Clamp count
  assertExact(clampedRows.length, baseline.clamps, `date-clamped rows for ${batchLabel}`);
  console.log(`  \u2713 date-clamped rows: ${clampedRows.length} (expected ${baseline.clamps})`);

  // 2. Every clamped row must be a Monthly Landscape Contract line
  const nonContractClamped = clampedRows.filter(cr => {
    const row = rows.find(r => r.excelRow === cr.excelRow);
    return row?.serviceType !== MONTHLY_CONTRACT_TYPE;
  });
  if (nonContractClamped.length > 0) {
    throw new Error(
      `Assertion failed: ${nonContractClamped.length} clamped row(s) are NOT Monthly Landscape Contract:\n` +
      nonContractClamped.map(cr => `  Row ${cr.excelRow}`).join("\n"),
    );
  }
  if (baseline.clamps > 0) {
    console.log(`  \u2713 all clamped rows are Monthly Landscape Contract lines`);
  }

  // 3. Contract row count
  assertExact(contractRows.length, baseline.contracts, `Monthly Landscape Contract rows for ${batchLabel}`);
  console.log(`  \u2713 contract-only rows: ${contractRows.length} (expected ${baseline.contracts})`);

  // 4. First Bank sentinel: also check source/batch/contractor constants (belt-and-suspenders)
  assertNoFirstBank(IMPORT_ORIGIN,          0, "source (constant)");
  assertNoFirstBank(batchLabel,             0, "source_batch (argument)");
  assertNoFirstBank(CONTRACTOR_DISPLAY_NAME, 0, "contractor (constant)");
  console.log(`  \u2713 First Bank sentinel: source, source_batch, contractor are clean`);

  console.log();

  // ── Date-clamped rows ─────────────────────────────────────────────────────
  console.log(`\u2500\u2500 Date-clamped rows (${clampedRows.length}) \u2500`.padEnd(72, "\u2500"));
  if (clampedRows.length === 0) {
    console.log("  (none)");
  } else {
    for (const cr of clampedRows) {
      console.log(`  Row ${String(cr.excelRow).padStart(4)}: ${cr.before} \u2192 ${cr.after}  [${cr.serviceType}]`);
    }
  }
  console.log();

  // ── Per-branch summary ────────────────────────────────────────────────────
  const branchCompletionCounts: Record<string, number> = {};
  const branchInvoiceCounts: Record<string, number> = {};
  for (const r of completionRows) branchCompletionCounts[r.pncCode] = (branchCompletionCounts[r.pncCode] ?? 0) + 1;
  for (const r of rows)           branchInvoiceCounts[r.pncCode]    = (branchInvoiceCounts[r.pncCode] ?? 0) + 1;

  console.log(`\u2500\u2500 Per-branch counts \u2500`.padEnd(72, "\u2500"));
  console.log(`  ${"Code".padEnd(8)} ${"Invoices".padEnd(12)} ${"Completions".padEnd(14)} Contracts`);
  for (const code of [...KNOWN_PNC_CODES].sort()) {
    if (!communityMap.has(code)) continue;
    const inv  = branchInvoiceCounts[code]    ?? 0;
    const comp = branchCompletionCounts[code] ?? 0;
    const cont = contractRows.filter(r => r.pncCode === code).length;
    console.log(`  ${code.padEnd(8)} ${String(inv).padEnd(12)} ${String(comp).padEnd(14)} ${cont}`);
  }
  console.log();

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalAmount = rows.reduce((s, r) => s + r.cost, 0);
  const totalCents  = Math.round(totalAmount * 100);
  console.log(`\u2500\u2500 Totals \u2500`.padEnd(72, "\u2500"));
  console.log(`  Invoice rows (all)  : ${rows.length}`);
  console.log(`  Completion rows     : ${completionRows.length}`);
  console.log(`  Contract-only rows  : ${contractRows.length}`);
  console.log(`  Total amount        : $${totalAmount.toFixed(2)}  (${totalCents} cents)`);
  console.log();
  console.log(`  Expected aggregate across all three bills:`);
  console.log(`    Invoices    : ${AGGREGATE.invoices}`);
  console.log(`    Completions : ${AGGREGATE.completions}`);
  console.log(`    Total amount: $${(AGGREGATE.totalCents / 100).toFixed(2)}`);
  console.log();

  // ── Contractor ────────────────────────────────────────────────────────────
  const existingContractor = await findExistingContractor();
  console.log(`\u2500\u2500 Contractor resolution \u2500`.padEnd(72, "\u2500"));
  if (existingContractor) {
    console.log(`  Using existing user: "${existingContractor.displayName}" (id: ${existingContractor.id})`);
  } else if (confirm) {
    console.log(`  No existing HP contractor \u2014 will create service account inside transaction:`);
    console.log(`    username     : ${SERVICE_ACCOUNT_USERNAME}`);
    console.log(`    display_name : ${SERVICE_ACCOUNT_DISPLAY_NAME}`);
  } else {
    console.log(`  [DRY RUN] No existing HP contractor \u2014 would create:`);
    console.log(`    "${SERVICE_ACCOUNT_DISPLAY_NAME}"`);
  }
  console.log();

  // ── Projected sample ──────────────────────────────────────────────────────
  const sampleRow = completionRows[0] ?? contractRows[0];
  const sampleCom = sampleRow ? communityMap.get(sampleRow.pncCode) : undefined;
  const contractorIdHint = existingContractor?.id ?? "(created in transaction)";

  console.log(`\u2500\u2500 Projected sample \u2500`.padEnd(72, "\u2500"));
  if (sampleRow && sampleCom) {
    const taskTitle       = (sampleRow.description || sampleRow.serviceType).trim();
    const completionNotes = buildCompletionNotes(sampleRow);
    const fingerprint     = computeTaskFingerprint(batchLabel, sampleRow.invoiceNumber, sampleRow.referenceNumber, sampleRow.pncCode);
    console.log("  invoices row:");
    console.log(`    community_id     : ${sampleCom.id}`);
    console.log(`    contractor       : ${CONTRACTOR_DISPLAY_NAME}`);
    console.log(`    completion_date  : ${sampleRow.completionDate}`);
    console.log(`    service_type     : ${sampleRow.serviceType}`);
    console.log(`    cost             : ${sampleRow.cost}`);
    console.log(`    invoice_number   : ${sampleRow.invoiceNumber}`);
    console.log(`    reference_number : ${sampleRow.referenceNumber}`);
    console.log(`    notes            : ${sampleRow.description || "(none)"}`);
    console.log(`    source           : ${IMPORT_ORIGIN}`);
    console.log(`    source_batch     : ${batchLabel}`);
    console.log(`    status/due_date/paid_at: (omitted — null by design)`);
    if (sampleRow.serviceType !== MONTHLY_CONTRACT_TYPE) {
      console.log("  tasks row:");
      console.log(`    title              : ${taskTitle}`);
      console.log(`    status             : completed`);
      console.log(`    origin             : ${IMPORT_ORIGIN}`);
      console.log(`    import_fingerprint : ${fingerprint}`);
      console.log(`    estimate_cents     : ${Math.round(sampleRow.cost * 100)}`);
      console.log(`    created_by         : ${contractorIdHint}`);
      console.log("  task_completions row:");
      console.log(`    completed_by  : ${contractorIdHint}`);
      console.log(`    completed_at  : ${sampleRow.completionDate}`);
      console.log(`    notes         : ${completionNotes}`);
    }
  }
  console.log();

  // ── Dry run ends here ──────────────────────────────────────────────────────
  if (!confirm) {
    console.log("DRY RUN complete \u2014 nothing written.\n");
    console.log("Verify the mapping table, per-branch counts, and totals above.");
    console.log("Then re-run with --confirm to write to production.\n");
    await pool.end();
    return;
  }

  // ── Confirm mode ───────────────────────────────────────────────────────────
  console.log(`\u2500\u2500 Importing (confirm mode) \u2500`.padEnd(72, "\u2500"));

  let invoicesInserted = 0;
  let tasksInserted    = 0;
  let invoicesSkipped  = 0;
  let tasksSkipped     = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Resolve/create contractor within the transaction ────────────────────
    let contractorId: string;
    if (existingContractor) {
      contractorId = existingContractor.id;
      console.log(`  Contractor: using existing user "${existingContractor.displayName}" (${contractorId})`);
    } else {
      // Create service account within transaction — rolled back on failure
      const ins = await client.query<{ id: string }>(
        `INSERT INTO users (username, password, display_name, role, is_active)
         VALUES ($1, $2, $3, 'contractor', true)
         ON CONFLICT (username) DO UPDATE SET is_active = users.is_active
         RETURNING id`,
        [SERVICE_ACCOUNT_USERNAME, "!LOCKED_IMPORT_SERVICE_ACCOUNT", SERVICE_ACCOUNT_DISPLAY_NAME],
      );
      contractorId = ins.rows[0]!.id;
      console.log(`  Contractor: created service account "${SERVICE_ACCOUNT_DISPLAY_NAME}" (${contractorId})`);
    }

    // ── Process rows ────────────────────────────────────────────────────────
    for (const row of rows) {
      const com = communityMap.get(row.pncCode)!;

      // Invoice idempotency — four-column unique key (invoices_source_line_unique_idx)
      const existingInvoice = await client.query<{ id: string }>(
        `SELECT id FROM invoices
         WHERE invoice_number   = $1
           AND reference_number = $2
           AND community_id     = $3
           AND completion_date  = $4
         LIMIT 1`,
        [row.invoiceNumber, row.referenceNumber, com.id, row.completionDate],
      );

      if (existingInvoice.rows.length > 0) {
        invoicesSkipped++;
      } else {
        // Insert invoice — status, due_date, paid_at intentionally OMITTED (null by design)
        await client.query(
          `INSERT INTO invoices
             (community_id, contractor, completion_date, service_type, cost,
              notes, invoice_number, reference_number, source, source_batch)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            com.id,
            CONTRACTOR_DISPLAY_NAME,
            row.completionDate,
            row.serviceType,
            row.cost,
            row.description || null,
            row.invoiceNumber,
            row.referenceNumber,
            IMPORT_ORIGIN,
            batchLabel,
          ],
        );
        invoicesInserted++;
      }

      // Monthly Landscape Contract rows: invoice only, no task/completion
      if (row.serviceType === MONTHLY_CONTRACT_TYPE) continue;

      // Task idempotency — importFingerprint (tasks_import_fingerprint_idx)
      const fingerprint = computeTaskFingerprint(batchLabel, row.invoiceNumber, row.referenceNumber, row.pncCode);
      const existingTask = await client.query<{ id: string }>(
        `SELECT id FROM tasks WHERE import_fingerprint = $1 LIMIT 1`,
        [fingerprint],
      );

      if (existingTask.rows.length > 0) {
        tasksSkipped++;
        continue;
      }

      // task.title = Description (trimmed), falling back to Service Type
      const taskTitle = (row.description || row.serviceType).trim();
      // Assert title is also clean of First Bank strings
      assertNoFirstBank(taskTitle, row.excelRow, "tasks.title");

      const taskResult = await client.query<{ id: string }>(
        `INSERT INTO tasks
           (community_id, title, description, status, priority, origin,
            import_fingerprint, estimate_cents, created_by)
         VALUES ($1, $2, $3, 'completed', 'medium', $4, $5, $6, $7)
         RETURNING id`,
        [
          com.id,
          taskTitle,
          row.description || null,
          IMPORT_ORIGIN,
          fingerprint,
          Math.round(row.cost * 100),
          contractorId,
        ],
      );
      tasksInserted++;

      const completionNotes = buildCompletionNotes(row);
      await client.query(
        `INSERT INTO task_completions
           (task_id, completed_by, notes, employee_sign_off_name, completed_at)
         VALUES ($1, $2, $3, '', $4)`,
        [taskResult.rows[0]!.id, contractorId, completionNotes, row.completionDate],
      );
    }

    // ── Pre-commit: aggregate baseline assertions ─────────────────────────────
    //
    // Run inside the transaction using `client` so any assertion failure triggers
    // the catch-block ROLLBACK and leaves the database unchanged.
    //
    // PostgreSQL's read-your-own-writes guarantee means these queries see the rows
    // just inserted above, so the assertions are live checks on the real post-import
    // state — not a post-hoc audit of already-committed data.
    //
    // Spec provides aggregate totals only (not per-period splits), so the full
    // baseline check is deferred until all three bills are present (invoice count
    // reaches 139). The per-period clamp/contract assertions earlier in the script
    // are the per-period safety net.

    const aggResult = await client.query<{
      invoice_count: string;
      task_count: string;
      total_cents: string;
    }>(`
      SELECT
        (SELECT COUNT(*)                             FROM invoices WHERE source = $1)::text AS invoice_count,
        (SELECT COUNT(*)                             FROM tasks    WHERE origin = $1)::text AS task_count,
        (SELECT COALESCE(SUM(cost * 100), 0)::bigint FROM invoices WHERE source = $1)::text AS total_cents
    `, [IMPORT_ORIGIN]);

    const agg = aggResult.rows[0]!;
    const aggInvoices = parseInt(agg.invoice_count, 10);
    const aggTasks    = parseInt(agg.task_count,    10);
    const aggCents    = parseInt(agg.total_cents,   10);

    if (aggInvoices > AGGREGATE.invoices) {
      // Aggregate already exceeds expected total — something is wrong; roll back this batch
      throw new Error(
        `Aggregate invoice count (${aggInvoices}) exceeds validated total (${AGGREGATE.invoices}).\n` +
        `This bill may already be imported or the source file contains unexpected rows.\n` +
        `Rolling back — no data written.`,
      );
    }

    // When all three bills are now present (aggregate hits 139), perform the full
    // baseline assertion before committing the third bill.
    let allThreeAsserted = false;
    if (aggInvoices === AGGREGATE.invoices) {
      console.log(`\n  All three bills now present — running aggregate baseline assertion...`);

      assertExact(aggTasks, AGGREGATE.completions, "aggregate task count");

      if (Math.abs(aggCents - AGGREGATE.totalCents) > 1) {
        throw new Error(
          `Aggregate total amount assertion failed:\n` +
          `  expected: $${(AGGREGATE.totalCents / 100).toFixed(2)}\n` +
          `  actual  : $${(aggCents / 100).toFixed(2)}\n` +
          `Rolling back — no data written.`,
        );
      }

      // Per-branch completion counts (inside transaction — sees this batch's inserts)
      const branchResult = await client.query<{ code: string; completion_count: string }>(`
        SELECT c.code, COUNT(tc.id)::text AS completion_count
          FROM task_completions tc
          JOIN tasks t ON t.id = tc.task_id
          JOIN communities c ON c.id = t.community_id
         WHERE t.origin = $1
         GROUP BY c.code
      `, [IMPORT_ORIGIN]);

      const actualBranch: Record<string, number> = {};
      for (const r of branchResult.rows) actualBranch[r.code] = parseInt(r.completion_count, 10);

      const branchErrors: string[] = [];
      for (const [code, expected] of Object.entries(AGGREGATE.branchCompletions)) {
        const actual = actualBranch[code] ?? 0;
        if (actual !== expected) {
          branchErrors.push(`  ${code}: expected ${expected} completions, got ${actual}`);
        }
      }
      if (branchErrors.length > 0) {
        throw new Error(
          `Per-branch completion counts do not match the validated baseline:\n` +
          branchErrors.join("\n") + "\n" +
          `Rolling back — no data written.`,
        );
      }

      console.log(`  ✓ aggregate invoices : ${aggInvoices}`);
      console.log(`  ✓ aggregate tasks    : ${aggTasks}`);
      console.log(`  ✓ aggregate amount   : $${(aggCents / 100).toFixed(2)}`);
      console.log(`  ✓ per-branch completion counts match validated baseline`);
      allThreeAsserted = true;
    }

    await client.query("COMMIT");

    // Store counts for summary (captured before release)
    const summaryAggInvoices = aggInvoices;
    const summaryAggTasks    = aggTasks;
    const summaryAggCents    = aggCents;
    const summaryAllThree    = allThreeAsserted;
    const summaryRemaining   = AGGREGATE.invoices - aggInvoices;

    // ── Post-commit summary ────────────────────────────────────────────────
    console.log(`\n${"=".repeat(72)}`);
    console.log(`  Import complete \u2014 ${batchLabel}`);
    console.log(`${"=".repeat(72)}`);
    console.log(`  This batch:`);
    console.log(`    Invoice rows inserted : ${invoicesInserted}`);
    console.log(`    Invoice rows skipped  : ${invoicesSkipped} (idempotent)`);
    console.log(`    Task rows inserted    : ${tasksInserted}`);
    console.log(`    Task rows skipped     : ${tasksSkipped} (idempotent)`);
    console.log(`    Batch amount          : $${totalAmount.toFixed(2)}`);
    console.log();
    console.log(`  Running aggregate in DB (source = '${IMPORT_ORIGIN}'):`);
    console.log(`    Invoices : ${summaryAggInvoices}  (expected all-three total: ${AGGREGATE.invoices})`);
    console.log(`    Tasks    : ${summaryAggTasks}     (expected: ${AGGREGATE.completions})`);
    console.log(`    Amount   : $${(summaryAggCents / 100).toFixed(2)}  (expected: $${(AGGREGATE.totalCents / 100).toFixed(2)})`);

    if (summaryAllThree) {
      console.log(`\n  \u2713 ALL THREE BILLS IMPORTED AND VALIDATED SUCCESSFULLY`);
    } else {
      console.log(`\n  \u2139 ${summaryRemaining} invoice(s) remain until aggregate baseline assertion runs.`);
    }

    console.log();
    // Undo commands — invoices keyed by source_batch (direct column);
    // tasks keyed by origin + import_fingerprint prefix (batch encoded as fingerprint prefix
    // because tasks.source_batch does not exist — see schema.ts tasks table).
    console.log(`  Undo commands for this batch:`);
    console.log(`    DELETE FROM invoices WHERE source_batch = '${batchLabel}';`);
    console.log(`    DELETE FROM tasks`);
    console.log(`      WHERE origin = '${IMPORT_ORIGIN}'`);
    console.log(`        AND import_fingerprint LIKE '${batchLabel}:%';`);
    console.log(`    -- task_completions CASCADE-deletes when tasks are deleted.`);
    console.log(`${"=".repeat(72)}\n`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nERROR: Transaction rolled back \u2014 no data was written.");
    console.error(err);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  pool.end().finally(() => process.exit(1));
});
