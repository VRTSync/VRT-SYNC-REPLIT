/**
 * masterBillImporter.ts
 *
 * Shared module for High Plains Property Maintenance master-bill import.
 * Extracted from scripts/src/import-master-bill.ts so the same logic can
 * run via both the CLI script and the admin browser upload page.
 *
 * All validation rules from the script are preserved — only the entry point
 * changes. Reporting goes to return values instead of console.log.
 */

import * as XLSX from "xlsx";
import pg from "pg";
import {
  ImportAcknowledgementError,
  reconcileAcknowledgements,
  type UnmatchedEntry,
} from "./importAcknowledgements";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Constants (identical to the CLI script)
// ---------------------------------------------------------------------------

export const KNOWN_PNC_CODES = new Set([
  "FB01", "FB02", "FB08", "FB15", "FB16",
  "FB1B", "FB36", "FB45", "FB4F", "FB5F", "FB65",
]);

/**
 * Display names for the eleven pilot branches, used to label an unmatched code
 * in an acknowledgement checkbox. Purely cosmetic: a code with no entry here
 * renders on its own, and nothing downstream depends on the name.
 */
export const PILOT_COMMUNITY_NAMES: Record<string, string> = {
  FB01: "104th and Federal",
  FB02: "136th and Colorado",
  FB08: "104th and Colorado",
  FB15: "50th and Bridge",
  FB16: "Brighton",
  FB1B: "104th and Chambers",
  FB36: "Colfax and Wadsworth",
  FB45: "88th and Wadsworth",
  FB4F: "120th and Sheridan",
  FB5F: "Baseline and Sheridan",
  FB65: "136th and Zuni",
};

export const MONTHLY_CONTRACT_TYPE = "Monthly Landscape Contract";
export const IMPORT_ORIGIN = "master_bill_import";
export const CONTRACTOR_DISPLAY_NAME = "High Plains Property Maintenance";
export const SERVICE_ACCOUNT_DISPLAY_NAME = "High Plains Property Maintenance \u2014 historical import";
export const SERVICE_ACCOUNT_USERNAME = "hp-historical-import";

export const FIRST_BANK_RE = /first\s*[-_]?bank/i;

export interface PeriodBaseline {
  clamps:    number;
  contracts: number;
}

export const PERIOD_BASELINE: Record<string, PeriodBaseline> = {
  master_bill_2026_05: { clamps: 10, contracts: 10 },
  master_bill_2026_06: { clamps: 10, contracts: 10 },
  master_bill_2026_07: { clamps: 0,  contracts: 9  },
};

export const AGGREGATE = {
  invoices:    139,
  completions: 110,
  totalCents:  5_312_090,
  branchCompletions: {
    FB01:  9, FB02: 14, FB08: 14, FB15: 12, FB16:  9,
    FB1B: 14, FB36: 10, FB45:  1, FB4F:  6, FB5F: 13, FB65:  8,
  } as Record<string, number>,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BillingPeriod {
  year: number;
  month: number;
  startISO: string;
  endISO: string;
}

export interface ParsedRow {
  excelRow: number;
  pncCode: string;
  invoiceNumber: string;
  referenceNumber: string;
  serviceType: string;
  description: string;
  completionDate: string;
  rawDate: string;
  wasClamped: boolean;
  cost: number;
}

export interface MasterBillParseResult {
  rows: ParsedRow[];
  skippedRows: Array<{ excelRow: number; reason: string }>;
  clampedRows: Array<{ excelRow: number; before: string; after: string; serviceType: string }>;
  batchLabel: string;
  period: BillingPeriod;
  baseline: PeriodBaseline;
}

export interface CommunityRecord {
  id: string;
  name: string;
  code: string;
  organizationId: string;
}

/**
 * The shared unmatched-entry shape plus the master bill's own descriptive
 * fields: acknowledging a code here skips real invoice rows, so the admin has
 * to see how many rows and how many dollars the exclusion costs.
 */
export interface MasterBillUnmatchedCode extends UnmatchedEntry {
  rowCount: number;
  totalAmount: number;
  excelRows: number[];
}

export interface MasterBillPreviewResult {
  blockingErrors: string[];
  unmatchedCodes: MasterBillUnmatchedCode[];
  communityMapping: Array<{ code: string; name: string; id: string; orgId: string }>;
  skippedRows: MasterBillParseResult["skippedRows"];
  clampedRows: MasterBillParseResult["clampedRows"];
  contractOnlyCount: number;
  completionCount: number;
  serviceAccountResolution: {
    exists: boolean;
    displayName: string;
    id?: string;
  };
  perBranchCounts: Record<string, { invoices: number; completions: number; contracts: number }>;
  totals: {
    invoiceRows: number;
    completionRows: number;
    contractRows: number;
    totalAmount: number;
    totalCents: number;
  };
}

export interface MasterBillCommitResult {
  invoicesInserted: number;
  invoicesSkipped: number;
  tasksInserted: number;
  tasksSkipped: number;
  batchId: string;
  batchLabel: string;
  undoSQL: string;
  /**
   * Unified report of every row this import did NOT write: parse-stage skips
   * (unknown PNC code, unparseable amount, GRAND TOTAL, …) merged with rows
   * skipped because their PNC code was explicitly acknowledged as unmatched.
   * Sorted by Excel row so the post-import summary reads like the source file.
   */
  skippedRows: Array<{ excelRow: number; reason: string }>;
  /** How many of `skippedRows` were skipped via explicit acknowledgement. */
  acknowledgedSkipCount: number;
  /** The PNC codes the admin explicitly acknowledged for this run. */
  acknowledgedCodes: string[];
}

/**
 * Thrown when a commit request is rejected for a caller-correctable reason
 * (bad acknowledgement list, unacknowledged unmatched code, …). Extends the
 * shared acknowledgement error so both importers surface the same HTTP status
 * to the route layer, which therefore never has to string-match messages.
 */
export class MasterBillValidationError extends ImportAcknowledgementError {
  constructor(message: string) {
    super(message);
    this.name = "MasterBillValidationError";
  }
}

// ---------------------------------------------------------------------------
// Helpers — pure functions (no DB calls)
// ---------------------------------------------------------------------------

export function parseBillingPeriod(label: string): BillingPeriod {
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

export function computeTaskFingerprint(
  batchLabel: string,
  invoiceNumber: string,
  referenceNumber: string,
  pncCode: string,
): string {
  return `${batchLabel}:${invoiceNumber}:${referenceNumber}:${pncCode}`;
}

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

export function buildCompletionNotes(row: ParsedRow): string {
  const parts = [row.serviceType];
  parts.push(`Invoice ${row.invoiceNumber}`);
  if (row.referenceNumber) parts.push(`Ref ${row.referenceNumber}`);
  return parts.join(" \u00b7 ");
}

// ---------------------------------------------------------------------------
// parseMasterBill — pure: reads workbook, returns structured data
// ---------------------------------------------------------------------------

export function parseMasterBill(buffer: Buffer, batchLabel: string): MasterBillParseResult {
  if (!batchLabel || !(batchLabel in PERIOD_BASELINE)) {
    throw new Error(
      `"${batchLabel}" is not a validated billing period.\n` +
      `Accepted values: ${Object.keys(PERIOD_BASELINE).join(", ")}`,
    );
  }

  const period   = parseBillingPeriod(batchLabel);
  const baseline = PERIOD_BASELINE[batchLabel]!;

  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetName = wb.SheetNames.find(n => /service\s+detail/i.test(n));
  if (!sheetName) {
    throw new Error(
      `Sheet "Service Detail" not found. Available sheets: ${wb.SheetNames.join(", ")}`,
    );
  }

  const ws = wb.Sheets[sheetName];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 4) {
    throw new Error("Workbook has fewer than 4 rows — cannot find header at row 4.");
  }

  const headerRow = (raw[3] as unknown[]).map(h => String(h ?? "").trim());

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
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }

  const rows: ParsedRow[] = [];
  const skippedRows: Array<{ excelRow: number; reason: string }> = [];
  const clampedRows: Array<{ excelRow: number; before: string; after: string; serviceType: string }> = [];

  const cell = (rowArr: unknown[], col: string): string =>
    String(rowArr[headerRow.indexOf(col)] ?? "").trim();

  for (let i = 4; i < raw.length; i++) {
    const excelRow = i + 1;
    const rowArr   = raw[i] as unknown[];

    const pncCode         = cell(rowArr, colPncCode!);
    const invoiceNumber   = cell(rowArr, colInvoiceNum!);
    const referenceNumber = cell(rowArr, colRefNum!);
    const serviceType     = cell(rowArr, colServiceType!);
    const description     = colDescription ? cell(rowArr, colDescription) : "";
    const dateRaw         = rowArr[headerRow.indexOf(colDate!)];
    const amountRaw       = rowArr[headerRow.indexOf(colAmount!)];

    if (!pncCode && !invoiceNumber && !serviceType) {
      skippedRows.push({ excelRow, reason: "blank row" });
      continue;
    }

    if (!KNOWN_PNC_CODES.has(pncCode)) {
      skippedRows.push({ excelRow, reason: `unknown PNC code "${pncCode}"` });
      continue;
    }

    if (!serviceType) {
      skippedRows.push({ excelRow, reason: `empty service type (PNC: ${pncCode})` });
      continue;
    }

    const rawDateISO = parseDate(dateRaw);
    if (!rawDateISO) {
      skippedRows.push({ excelRow, reason: `unparseable date: "${dateRaw}"` });
      continue;
    }

    const clampedISO = clampToRange(rawDateISO, period);
    const wasClamped = clampedISO !== rawDateISO;
    if (wasClamped) {
      clampedRows.push({ excelRow, before: rawDateISO, after: clampedISO, serviceType });
    }

    const costStr = String(amountRaw ?? "").replace(/[$,\s]/g, "");
    const cost    = parseFloat(costStr);
    if (isNaN(cost)) {
      skippedRows.push({ excelRow, reason: `unparseable amount: "${amountRaw}"` });
      continue;
    }

    checkSentinelFields({
      "PNC Code":     pncCode,
      "Invoice #":    invoiceNumber,
      "Reference #":  referenceNumber,
      "Service Type": serviceType,
      "Description":  description,
      "source":       IMPORT_ORIGIN,
      "source_batch": batchLabel,
      "contractor":   CONTRACTOR_DISPLAY_NAME,
    }, excelRow);

    rows.push({
      excelRow, pncCode, invoiceNumber, referenceNumber, serviceType, description,
      completionDate: clampedISO, rawDate: rawDateISO, wasClamped, cost,
    });
  }

  return { rows, skippedRows, clampedRows, batchLabel, period, baseline };
}

// ---------------------------------------------------------------------------
// Shared DB resolution — used by BOTH preview and commit
//
// Commit must never trust the client-supplied `preview` object to decide which
// codes are unmatched or which community a row belongs to; it re-runs these
// against its own transaction client and uses that as the authority.
// ---------------------------------------------------------------------------

/** Minimal surface shared by `Pool` and a checked-out `PoolClient`. */
interface Queryable {
  query<R extends Record<string, any> = any>(
    text: string,
    values?: any[],
  ): Promise<{ rows: R[] }>;
}

interface CommunityResolution {
  /** Codes resolving to exactly one community. */
  mapping: Array<{ code: string; name: string; id: string; orgId: string }>;
  /** Codes with no community record at all. */
  unmatched: string[];
  /** Codes matching more than one community — always blocking. */
  ambiguous: Array<{
    code: string;
    matches: Array<{ id: string; name: string; organizationId: string }>;
  }>;
}

async function resolveCommunitiesForCodes(
  codes: string[],
  db: Queryable,
): Promise<CommunityResolution> {
  const mapping: CommunityResolution["mapping"]     = [];
  const unmatched: string[]                         = [];
  const ambiguous: CommunityResolution["ambiguous"] = [];

  if (codes.length === 0) return { mapping, unmatched, ambiguous };

  const placeholders = codes.map((_, i) => `$${i + 1}`).join(", ");
  const result = await db.query<{
    id: string; name: string; code: string; organization_id: string;
  }>(
    `SELECT id, name, code, organization_id FROM communities WHERE code IN (${placeholders})`,
    codes,
  );

  const byCode = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code)!.push(row);
  }

  for (const code of codes) {
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) {
      unmatched.push(code);
    } else if (matches.length > 1) {
      ambiguous.push({
        code,
        matches: matches.map(m => ({
          id: m.id, name: m.name, organizationId: m.organization_id,
        })),
      });
    } else {
      mapping.push({
        code, name: matches[0]!.name, id: matches[0]!.id, orgId: matches[0]!.organization_id,
      });
    }
  }

  return { mapping, unmatched, ambiguous };
}

async function resolveServiceAccount(
  db: Queryable,
): Promise<MasterBillPreviewResult["serviceAccountResolution"]> {
  const saResult = await db.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users
     WHERE role = 'contractor'
       AND (display_name ILIKE '%High Plains%' OR username = $1)
     ORDER BY created_at ASC LIMIT 1`,
    [SERVICE_ACCOUNT_USERNAME],
  );

  return saResult.rows.length > 0
    ? { exists: true, displayName: saResult.rows[0]!.display_name, id: saResult.rows[0]!.id }
    : { exists: false, displayName: SERVICE_ACCOUNT_DISPLAY_NAME };
}

// ---------------------------------------------------------------------------
// previewMasterBill — reads DB to resolve communities; never writes
// ---------------------------------------------------------------------------

export async function previewMasterBill(
  parsed: MasterBillParseResult,
  pool: InstanceType<typeof Pool>,
): Promise<MasterBillPreviewResult> {
  const { rows, skippedRows, clampedRows, batchLabel, baseline } = parsed;

  const blockingErrors: string[] = [];
  const unmatchedCodes: MasterBillPreviewResult["unmatchedCodes"] = [];

  // Validate First Bank sentinel on constants (belt-and-suspenders)
  try {
    assertNoFirstBank(IMPORT_ORIGIN,           0, "source (constant)");
    assertNoFirstBank(batchLabel,              0, "source_batch");
    assertNoFirstBank(CONTRACTOR_DISPLAY_NAME, 0, "contractor (constant)");
  } catch (err: any) {
    blockingErrors.push(err.message);
  }

  // Clamp count assertion
  if (clampedRows.length !== baseline.clamps) {
    blockingErrors.push(
      `Date-clamped rows: expected ${baseline.clamps}, found ${clampedRows.length}. ` +
      `This bill may be the wrong billing period or file.`,
    );
  }

  // Contract row count assertion
  const contractRows   = rows.filter(r => r.serviceType === MONTHLY_CONTRACT_TYPE);
  const completionRows = rows.filter(r => r.serviceType !== MONTHLY_CONTRACT_TYPE);

  if (contractRows.length !== baseline.contracts) {
    blockingErrors.push(
      `Monthly Landscape Contract rows: expected ${baseline.contracts}, ` +
      `found ${contractRows.length}. Verify the source file.`,
    );
  }

  // Resolve communities. A code with zero matches is NOT a blocking error
  // string — it becomes an entry the admin can explicitly acknowledge. Codes
  // rejected at the parse stage (unknown PNC code, e.g. GRAND TOTAL) never
  // reach here, so they can never appear in the acknowledgement panel.
  const codes = [...new Set(rows.map(r => r.pncCode))];
  const resolution = await resolveCommunitiesForCodes(codes, pool);
  const communityMapping = resolution.mapping;

  for (const code of resolution.unmatched) {
    const codeRows = rows.filter(r => r.pncCode === code);
    unmatchedCodes.push({
      code,
      rowCount: codeRows.length,
      totalAmount: codeRows.reduce((s, r) => s + r.cost, 0),
      excelRows: codeRows.map(r => r.excelRow),
    });
  }

  for (const amb of resolution.ambiguous) {
    blockingErrors.push(
      `PNC Code "${amb.code}" — ${amb.matches.length} communities match: ` +
      amb.matches.map(m => `${m.name} (org: ${m.organizationId})`).join(", "),
    );
  }

  // Cross-org check
  const previewOrgIds = new Set(communityMapping.map(c => c.orgId));
  if (previewOrgIds.size > 1) {
    blockingErrors.push(
      `PNC codes span ${previewOrgIds.size} organizations — cross-org contamination prevented.`,
    );
  }

  const serviceAccountResolution = await resolveServiceAccount(pool);

  // Per-branch counts
  const perBranchCounts: MasterBillPreviewResult["perBranchCounts"] = {};
  for (const code of [...KNOWN_PNC_CODES]) {
    const inv  = rows.filter(r => r.pncCode === code).length;
    const comp = completionRows.filter(r => r.pncCode === code).length;
    const cont = contractRows.filter(r => r.pncCode === code).length;
    if (inv > 0 || comp > 0 || cont > 0) {
      perBranchCounts[code] = { invoices: inv, completions: comp, contracts: cont };
    }
  }

  const totalAmount = rows.reduce((s, r) => s + r.cost, 0);

  return {
    blockingErrors,
    unmatchedCodes,
    communityMapping: communityMapping.sort((a, b) => a.code.localeCompare(b.code)),
    skippedRows,
    clampedRows,
    contractOnlyCount: contractRows.length,
    completionCount: completionRows.length,
    serviceAccountResolution,
    perBranchCounts,
    totals: {
      invoiceRows: rows.length,
      completionRows: completionRows.length,
      contractRows: contractRows.length,
      totalAmount,
      totalCents: Math.round(totalAmount * 100),
    },
  };
}

// ---------------------------------------------------------------------------
// commitMasterBill — writes invoices + tasks + completions; logs import_batches
// ---------------------------------------------------------------------------

export async function commitMasterBill(
  parsed: MasterBillParseResult,
  preview: MasterBillPreviewResult,
  pool: InstanceType<typeof Pool>,
  runByUserId: string,
  acknowledgedCodes: string[] = [],
): Promise<MasterBillCommitResult> {
  if (preview.blockingErrors.length > 0) {
    throw new Error(
      `Cannot commit — blocking errors present:\n` +
      preview.blockingErrors.map(e => `  • ${e}`).join("\n"),
    );
  }

  const { rows, batchLabel } = parsed;
  const acknowledgedSet = new Set(acknowledgedCodes);

  let invoicesInserted = 0;
  let invoicesSkipped  = 0;
  let tasksInserted    = 0;
  let tasksSkipped     = 0;
  let batchId          = "";
  const acknowledgedSkips: Array<{ excelRow: number; reason: string }> = [];
  let unifiedSkippedRows: Array<{ excelRow: number; reason: string }> = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ---- Server-authoritative validation -------------------------------
    // `preview` arrives in the request body and is therefore untrusted. Every
    // decision that controls what gets written — which codes are unmatched,
    // which community a row lands in, which service account owns the tasks —
    // is re-derived here against the transaction client. A tampered preview
    // cannot smuggle a code into the acknowledged set or redirect a row.
    const codes      = [...new Set(rows.map(r => r.pncCode))];
    const resolution = await resolveCommunitiesForCodes(codes, client);

    if (resolution.ambiguous.length > 0) {
      throw new MasterBillValidationError(
        `Cannot commit — ${resolution.ambiguous.length} PNC code(s) match multiple communities: ` +
        resolution.ambiguous.map(a => a.code).join(", "),
      );
    }

    // (a) Every acknowledged code must genuinely be unmatched on the server, and
    // (b) every unmatched code must be acknowledged, or commit still blocks.
    // Both directions live in the shared reconciler the seasonal importer uses.
    reconcileAcknowledgements({
      serverUnmatched:   resolution.unmatched,
      acknowledgedCodes: acknowledgedSet,
      codeNoun:          "PNC code",
    });

    const orgIds = new Set(resolution.mapping.map(c => c.orgId));
    if (orgIds.size > 1) {
      throw new MasterBillValidationError(
        `PNC codes span ${orgIds.size} organizations — cross-org contamination prevented.`,
      );
    }

    // Build the community map from the server's own resolution, not the
    // client's `preview.communityMapping`.
    const communityMap = new Map<string, { id: string; name: string }>();
    for (const c of resolution.mapping) {
      communityMap.set(c.code, { id: c.id, name: c.name });
    }

    // Resolve / create service account (also re-derived server-side)
    const serviceAccount = await resolveServiceAccount(client);
    let contractorId: string;
    if (serviceAccount.exists && serviceAccount.id) {
      contractorId = serviceAccount.id;
    } else {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO users (username, password, display_name, role, is_active)
         VALUES ($1, $2, $3, 'contractor', true)
         ON CONFLICT (username) DO UPDATE SET is_active = users.is_active
         RETURNING id`,
        [SERVICE_ACCOUNT_USERNAME, "!LOCKED_IMPORT_SERVICE_ACCOUNT", SERVICE_ACCOUNT_DISPLAY_NAME],
      );
      contractorId = ins.rows[0]!.id;
    }

    // Process rows
    for (const row of rows) {
      // Skip rows for explicitly acknowledged unmatched codes
      if (acknowledgedSet.has(row.pncCode)) {
        acknowledgedSkips.push({ excelRow: row.excelRow, reason: "acknowledged_unmatched" });
        continue;
      }

      const com = communityMap.get(row.pncCode);
      if (!com) continue;

      // Invoice idempotency
      const existingInv = await client.query<{ id: string }>(
        `SELECT id FROM invoices
         WHERE invoice_number   = $1
           AND reference_number = $2
           AND community_id     = $3
           AND completion_date  = $4
         LIMIT 1`,
        [row.invoiceNumber, row.referenceNumber, com.id, row.completionDate],
      );

      if (existingInv.rows.length > 0) {
        invoicesSkipped++;
      } else {
        await client.query(
          `INSERT INTO invoices
             (community_id, contractor, completion_date, service_type, cost,
              notes, invoice_number, reference_number, source, source_batch)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            com.id, CONTRACTOR_DISPLAY_NAME, row.completionDate, row.serviceType,
            row.cost, row.description || null, row.invoiceNumber,
            row.referenceNumber, IMPORT_ORIGIN, batchLabel,
          ],
        );
        invoicesInserted++;
      }

      if (row.serviceType === MONTHLY_CONTRACT_TYPE) continue;

      // Task idempotency
      const fingerprint  = computeTaskFingerprint(batchLabel, row.invoiceNumber, row.referenceNumber, row.pncCode);
      const existingTask = await client.query<{ id: string }>(
        `SELECT id FROM tasks WHERE import_fingerprint = $1 LIMIT 1`,
        [fingerprint],
      );

      if (existingTask.rows.length > 0) {
        tasksSkipped++;
        continue;
      }

      const taskTitle = (row.description || row.serviceType).trim();
      assertNoFirstBank(taskTitle, row.excelRow, "tasks.title");

      const taskResult = await client.query<{ id: string }>(
        `INSERT INTO tasks
           (community_id, title, description, status, priority, origin,
            import_fingerprint, estimate_cents, created_by)
         VALUES ($1, $2, $3, 'completed', 'medium', $4, $5, $6, $7)
         RETURNING id`,
        [
          com.id, taskTitle, row.description || null,
          IMPORT_ORIGIN, fingerprint,
          Math.round(row.cost * 100), contractorId,
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

    // Aggregate guard: invoice count must not exceed validated total
    const aggResult = await client.query<{ invoice_count: string }>(
      `SELECT COUNT(*)::text AS invoice_count FROM invoices WHERE source = $1`,
      [IMPORT_ORIGIN],
    );
    const aggInvoices = parseInt(aggResult.rows[0]!.invoice_count, 10);
    if (aggInvoices > AGGREGATE.invoices) {
      throw new Error(
        `Aggregate invoice count (${aggInvoices}) exceeds validated total (${AGGREGATE.invoices}).\n` +
        `This bill may already be imported or the source file contains unexpected rows.\n` +
        `Rolling back — no data written.`,
      );
    }

    // Unified skip report: parse-stage skips (unknown PNC code, unparseable
    // amount, GRAND TOTAL, …) merged with acknowledged-unmatched skips, in
    // source-file order.
    unifiedSkippedRows = [...parsed.skippedRows, ...acknowledgedSkips]
      .sort((a, b) => a.excelRow - b.excelRow);

    // Log to import_batches, persisting the full skip audit alongside the
    // aggregate counts so the record explains itself without the source file.
    const batchResult = await client.query<{ id: string }>(
      `INSERT INTO import_batches
         (mode, batch_label, run_by, invoice_count, task_count, completion_count,
          skipped_rows, acknowledged_codes)
       VALUES ('master_bill', $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id`,
      [
        batchLabel, runByUserId, invoicesInserted, tasksInserted, tasksInserted,
        JSON.stringify(unifiedSkippedRows),
        JSON.stringify([...acknowledgedSet].sort()),
      ],
    );
    batchId = batchResult.rows[0]!.id;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Count acknowledged skips toward invoicesSkipped total
  invoicesSkipped += acknowledgedSkips.length;

  const undoSQL =
    `DELETE FROM invoices WHERE source_batch = '${batchLabel}';\n` +
    `DELETE FROM tasks\n` +
    `  WHERE origin = '${IMPORT_ORIGIN}'\n` +
    `    AND import_fingerprint LIKE '${batchLabel}:%';\n` +
    `-- task_completions CASCADE-deletes when tasks are deleted.`;

  return {
    invoicesInserted, invoicesSkipped, tasksInserted, tasksSkipped,
    batchId, batchLabel, undoSQL,
    skippedRows: unifiedSkippedRows,
    acknowledgedSkipCount: acknowledgedSkips.length,
    acknowledgedCodes: [...acknowledgedSet].sort(),
  };
}
