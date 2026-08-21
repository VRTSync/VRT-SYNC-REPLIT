/**
 * seasonalImporter.ts
 *
 * Seasonal contract importer — fixed-layout reader for
 * "Contract Task List - VRT.xlsx".
 *
 * Expected columns (exactly 8, in any order):
 *   Ticket Title, Ticket Type, Priority, Start Date, End Date,
 *   Frequency, Total Visits, Description
 *
 * Expected rows: exactly 18 data rows.
 *
 * Validation enforced at parse time AND again at preview/commit time
 * (endpoints accept client-supplied rows, so we re-validate server-side):
 *   - All 8 headers present as row keys
 *   - Exactly 18 data rows
 *   - Every Start Date is in 2026
 *   - Every End Date is after its Start Date
 *
 * Processing:
 *   - Frequency "Weekly" | "Monthly"  → recurring schedule + generated visits
 *   - Frequency "One-Time"             → one-time task
 *
 * Visit date generation (recurring rows):
 *   Season window: 2026-04-01 … 2026-10-31 (31 Wednesdays, indices 0-30)
 *   For n visits: pick Wednesday at index round(i × 30 / (n-1)) for i in 0..n-1
 *
 * Attribution: all tasks / completions / visits attributed to the
 *   High Plains service account (same pattern as masterBillImporter.ts).
 *
 * Idempotency:
 *   - service_schedules: upsert via notes containing "contract_schedule:{title}"
 *   - service_visits:    unique on (schedule_id, service_date)
 *   - tasks:             unique on schedule_instance_key = "contract_schedule:{communityId}:{title}"
 *
 * Batch provenance:
 *   - service_schedules newly created by this batch: notes contains "batch:{batchId}"
 *   - service_visits newly created by this batch: notes = "batch:{batchId}" (covers reused schedules)
 *   - tasks: import_fingerprint = batchId
 *   Undo deletes visits by their notes, schedules by their notes, tasks by import_fingerprint.
 */

import * as XLSX from "xlsx";
import pg from "pg";
import { KNOWN_PNC_CODES, SERVICE_ACCOUNT_USERNAME, SERVICE_ACCOUNT_DISPLAY_NAME } from "./masterBillImporter";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTRACT_ORIGIN = "contract_schedule";

const EXPECTED_HEADERS = [
  "Ticket Title",
  "Ticket Type",
  "Priority",
  "Start Date",
  "End Date",
  "Frequency",
  "Total Visits",
  "Description",
] as const;

const EXPECTED_ROW_COUNT = 18;

// Season window: 2026-04-01 through 2026-10-31
const SEASON_START = new Date(2026, 3, 1);  // April 1
const SEASON_END   = new Date(2026, 9, 31); // October 31

/** All 31 Wednesdays within the season window, as ISO date strings. */
function buildSeasonWednesdays(): string[] {
  const days: string[] = [];
  let d = new Date(SEASON_START);
  while (d <= SEASON_END) {
    if (d.getDay() === 3) days.push(toISODate(d));
    d = new Date(d.getTime() + 86_400_000);
  }
  return days;
}

const SEASON_WEDNESDAYS = buildSeasonWednesdays();

/** Map ticket title → service_type enum value */
function titleToServiceType(title: string): string {
  const t = title.toLowerCase().trim();
  if (t.includes("weekly landscape maintenance")) return "mowing_visit";
  return "landscape_service";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonalParseResult {
  columns: string[];
  rowsPreview: Record<string, any>[];
  totalRows: number;
  allRows: Record<string, any>[];
  sheetNames?: string[];
  /** Blocking errors detected at parse/assert time */
  parseErrors: string[];
}

export interface CommunityMappingRow {
  code: string;
  id: string;
  name: string;
  orgId: string;
}

export interface SeasonalSchedulePlan {
  communityCode: string;
  communityId: string;
  communityName: string;
  serviceType: string;
  ticketTitle: string;
  action: "create" | "existing";
  existingScheduleId?: string;
  visitCount: number;
  completedVisits: number;
  scheduledVisits: number;
}

export interface SeasonalPreviewResult {
  blockingErrors: string[];
  warnings: string[];
  communityMapping: CommunityMappingRow[];
  schedulePlans: SeasonalSchedulePlan[];
  serviceAccountResolution: { exists: boolean; displayName: string; id?: string };
  counts: {
    totalRows: number;
    recurringRows: number;
    oneTimeRows: number;
    schedulesToCreate: number;
    schedulesExisting: number;
    visitsToInsert: number;
    completedVisits: number;
    scheduledVisits: number;
    tasksToInsert: number;
    completionsToInsert: number;
    skippedRows: number;
    communities: number;
  };
}

export interface SeasonalCommitResult {
  schedulesCreated: number;
  visitsInserted: number;
  visitsSkipped: number;
  tasksInserted: number;
  tasksSkipped: number;
  completionsInserted: number;
  batchId: string;
  undoSQL: string;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseSeasonalDate(value: any): Date | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    // Excel serial date
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86_400_000);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(value).trim();
  if (!str) return null;

  const mmddyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mmddyyyy) {
    let year = parseInt(mmddyyyy[3]!);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(mmddyyyy[1]!) - 1, parseInt(mmddyyyy[2]!));
    if (!isNaN(d.getTime())) return d;
  }

  const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const d = new Date(parseInt(yyyymmdd[1]!), parseInt(yyyymmdd[2]!) - 1, parseInt(yyyymmdd[3]!));
    if (!isNaN(d.getTime())) return d;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

/**
 * Generate n evenly-spaced visit dates from the season Wednesday list.
 * Formula: pick Wednesday at index round(i × 30 / (n-1)) for i in 0..n-1.
 * For n=1, always returns the first Wednesday (index 0).
 */
function generateVisitDates(n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [SEASON_WEDNESDAYS[0]!];
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * 30) / (n - 1));
    dates.push(SEASON_WEDNESDAYS[Math.min(idx, SEASON_WEDNESDAYS.length - 1)]!);
  }
  return dates;
}

/** True if the ISO date string is on or before today (end-of-day). */
function isDatePassed(isoDate: string): boolean {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return new Date(isoDate) <= today;
}

// ---------------------------------------------------------------------------
// assertContractLayout — centralized fixed-layout validator
//
// Called by parseSeasonal (for immediate user feedback), previewSeasonal
// (to block a commit via the UI), and commitSeasonal (final server-side guard).
// Returns an array of error strings; empty means the layout is valid.
// ---------------------------------------------------------------------------

export function assertContractLayout(allRows: Record<string, any>[]): string[] {
  const errors: string[] = [];

  // 1. Row count
  if (allRows.length !== EXPECTED_ROW_COUNT) {
    errors.push(
      `Expected exactly ${EXPECTED_ROW_COUNT} data rows but received ${allRows.length}. ` +
      `Ensure you are uploading the Contract Task List file without extra or missing rows.`,
    );
    // No point checking columns/dates without the right row count
    return errors;
  }

  // 2. Exact column set — exactly these 8 headers, no more, no less
  if (allRows.length > 0) {
    const firstRow = allRows[0]!;
    const rowKeys = Object.keys(firstRow);
    const missingHeaders = EXPECTED_HEADERS.filter(h => !(h in firstRow));
    const extraHeaders   = rowKeys.filter(h => !(EXPECTED_HEADERS as readonly string[]).includes(h));

    if (missingHeaders.length > 0) {
      errors.push(
        `Missing required column(s): ${missingHeaders.map(h => `"${h}"`).join(", ")}. ` +
        `This importer requires exactly these 8 columns: ${EXPECTED_HEADERS.map(h => `"${h}"`).join(", ")}.`,
      );
    }
    if (extraHeaders.length > 0) {
      errors.push(
        `Unexpected column(s): ${extraHeaders.map(h => `"${h}"`).join(", ")}. ` +
        `Upload only the fixed 8-column Contract Task List — do not add extra columns.`,
      );
    }
    if (errors.length > 0) return errors;
  }

  // 3. Date assertions: all Start Dates in 2026, all End Dates after Start Dates
  for (let i = 0; i < allRows.length; i++) {
    const row    = allRows[i]!;
    const title  = String(row["Ticket Title"] ?? "").trim() || `Row ${i + 2}`;
    const startD = parseSeasonalDate(row["Start Date"]);
    const endD   = parseSeasonalDate(row["End Date"]);

    if (!startD) {
      errors.push(`Row "${title}" — invalid or missing Start Date`);
      break;
    }
    if (startD.getFullYear() !== 2026) {
      errors.push(
        `Row "${title}" — Start Date is ${startD.getFullYear()}, not 2026. ` +
        `All contract tasks must start in 2026.`,
      );
      break;
    }
    if (!endD) {
      errors.push(`Row "${title}" — invalid or missing End Date`);
      break;
    }
    if (endD <= startD) {
      errors.push(
        `Row "${title}" — End Date (${toISODate(endD)}) is not after Start Date (${toISODate(startD)})`,
      );
      break;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// parseSeasonal — pure: reads workbook, returns columns + all rows
// ---------------------------------------------------------------------------

export function parseSeasonal(buffer: Buffer, filename?: string): SeasonalParseResult {
  const ext = (filename ?? "").toLowerCase().split(".").pop();
  let wb: XLSX.WorkBook;

  if (ext === "csv") {
    wb = XLSX.read(buffer.toString("utf-8"), { type: "string", cellDates: true });
  } else {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  }

  const sheetNames = wb.SheetNames;
  const ws = wb.Sheets[sheetNames[0]!];
  if (!ws) throw new Error("Workbook has no sheets");

  const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rawData.length < 2) throw new Error("File must have at least a header row and one data row");

  const headerRow = (rawData[0] as any[]).map((h: any) => String(h).trim());
  const columns   = headerRow.filter((h: string) => h.length > 0);

  // Check all expected headers are present
  const missingHeaders = EXPECTED_HEADERS.filter(h => !columns.includes(h));
  if (missingHeaders.length > 0) {
    const parseErrors = [
      `Missing required column(s): ${missingHeaders.map(h => `"${h}"`).join(", ")}. ` +
      `This importer expects the fixed Contract Task List layout with exactly these 8 columns: ` +
      EXPECTED_HEADERS.map(h => `"${h}"`).join(", "),
    ];
    return { columns, rowsPreview: [], totalRows: 0, allRows: [], parseErrors };
  }

  const allRows: Record<string, any>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row: Record<string, any> = {};
    let hasData = false;
    for (let j = 0; j < columns.length; j++) {
      const val = rawData[i][j];
      row[columns[j]] = val !== undefined && val !== null ? val : "";
      if (val !== undefined && val !== null && String(val).trim() !== "") hasData = true;
    }
    if (hasData) allRows.push(row);
  }

  // Run the centralised assertions
  const parseErrors = assertContractLayout(allRows);

  return {
    columns,
    rowsPreview: allRows.slice(0, 50),
    totalRows: allRows.length,
    allRows,
    sheetNames: sheetNames.length > 1 ? sheetNames : undefined,
    parseErrors,
  };
}

// ---------------------------------------------------------------------------
// Internal: resolve pilot-org communities from KNOWN_PNC_CODES
// ---------------------------------------------------------------------------

async function resolvePilotCommunities(
  client: pg.PoolClient | InstanceType<typeof Pool>,
): Promise<{ communityMapping: CommunityMappingRow[]; blockingErrors: string[] }> {
  const codes = [...KNOWN_PNC_CODES];
  const placeholders = codes.map((_, i) => `$${i + 1}`).join(", ");

  const result = await client.query<{
    id: string; name: string; code: string; organization_id: string;
  }>(
    `SELECT id, name, code, organization_id
       FROM communities
      WHERE code IN (${placeholders})
      ORDER BY code`,
    codes,
  );

  const blockingErrors: string[] = [];

  // Group by code — flag missing and ambiguous
  const byCode = new Map<string, typeof result.rows[0][]>();
  for (const row of result.rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code)!.push(row);
  }

  const communityMapping: CommunityMappingRow[] = [];
  for (const code of codes) {
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) {
      blockingErrors.push(`Pilot community "${code}" — not found in the database`);
    } else if (matches.length > 1) {
      blockingErrors.push(`Pilot community "${code}" — ${matches.length} communities share this code (ambiguous)`);
    } else {
      communityMapping.push({
        code,
        id:    matches[0]!.id,
        name:  matches[0]!.name,
        orgId: matches[0]!.organization_id,
      });
    }
  }

  // All resolved communities must belong to the same organization.
  // If codes span multiple orgs (e.g. a test DB where codes were reused),
  // importing would silently write across tenant boundaries.
  if (communityMapping.length > 0) {
    const orgIds = new Set(communityMapping.map(c => c.orgId));
    if (orgIds.size > 1) {
      blockingErrors.push(
        `Community codes resolve to ${orgIds.size} different organizations ` +
        `(${[...orgIds].join(", ")}). All 11 pilot communities must belong to ` +
        `the same organization. Cannot import across tenant boundaries.`,
      );
    }
  }

  return { communityMapping, blockingErrors };
}

// ---------------------------------------------------------------------------
// Internal: resolve / check service account (preview — read-only)
// ---------------------------------------------------------------------------

async function resolveServiceAccountPreview(
  pool: InstanceType<typeof Pool>,
): Promise<{ exists: boolean; displayName: string; id?: string }> {
  const r = await pool.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM users
      WHERE role = 'contractor'
        AND (display_name ILIKE '%High Plains%' OR username = $1)
      ORDER BY created_at ASC LIMIT 1`,
    [SERVICE_ACCOUNT_USERNAME],
  );
  return r.rows.length > 0
    ? { exists: true, displayName: r.rows[0]!.display_name, id: r.rows[0]!.id }
    : { exists: false, displayName: SERVICE_ACCOUNT_DISPLAY_NAME };
}

// ---------------------------------------------------------------------------
// Internal: resolve / upsert service account (commit — writes)
// ---------------------------------------------------------------------------

async function resolveOrCreateServiceAccount(
  client: pg.PoolClient,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE role = 'contractor'
        AND (display_name ILIKE '%High Plains%' OR username = $1)
      ORDER BY created_at ASC LIMIT 1`,
    [SERVICE_ACCOUNT_USERNAME],
  );
  if (r.rows.length > 0) return r.rows[0]!.id;

  const ins = await client.query<{ id: string }>(
    `INSERT INTO users (username, password, display_name, role, is_active)
     VALUES ($1, $2, $3, 'contractor', true)
     ON CONFLICT (username) DO UPDATE SET is_active = users.is_active
     RETURNING id`,
    [SERVICE_ACCOUNT_USERNAME, "!LOCKED_IMPORT_SERVICE_ACCOUNT", SERVICE_ACCOUNT_DISPLAY_NAME],
  );
  return ins.rows[0]!.id;
}

// ---------------------------------------------------------------------------
// previewSeasonal — queries DB; never writes
// ---------------------------------------------------------------------------

export async function previewSeasonal(
  allRows: Record<string, any>[],
  pool: InstanceType<typeof Pool>,
): Promise<SeasonalPreviewResult> {
  const blockingErrors: string[] = [];
  const warnings: string[]       = [];

  // ── Server-side fixed-layout assertion ────────────────────────────────────
  // Re-run even though parseSeasonal already checked, because the preview
  // endpoint accepts client-supplied rows that bypassed parsing.
  const layoutErrors = assertContractLayout(allRows);
  blockingErrors.push(...layoutErrors);

  // Resolve pilot-org communities (read-only pool)
  const { communityMapping, blockingErrors: communityErrors } = await resolvePilotCommunities(pool);
  blockingErrors.push(...communityErrors);

  // Resolve service account
  const serviceAccountResolution = await resolveServiceAccountPreview(pool);

  // Split rows by Frequency
  const recurringRows = allRows.filter(r => {
    const freq = String(r["Frequency"] ?? "").trim().toLowerCase();
    return freq === "weekly" || freq === "monthly";
  });
  const oneTimeRows = allRows.filter(r => {
    const freq = String(r["Frequency"] ?? "").trim().toLowerCase();
    return freq === "one-time" || freq === "one time";
  });

  const skippedRows = allRows.length - recurringRows.length - oneTimeRows.length;
  if (skippedRows > 0) {
    warnings.push(
      `${skippedRows} row(s) had unrecognised Frequency values and will be skipped.`,
    );
  }

  // ── Recurring rows → schedule plans ────────────────────────────────────────
  const schedulePlans: SeasonalSchedulePlan[] = [];

  // Check for existing schedules per community
  const existingSchedulesMap = new Map<string, string>(); // "communityId|title" → scheduleId
  if (communityMapping.length > 0 && recurringRows.length > 0) {
    const communityIds = communityMapping.map(c => c.id);
    const phs = communityIds.map((_, i) => `$${i + 1}`).join(", ");
    const existing = await pool.query<{ id: string; community_id: string; notes: string }>(
      `SELECT id, community_id, notes FROM service_schedules
        WHERE community_id IN (${phs})
          AND notes LIKE 'contract_schedule:%'`,
      communityIds,
    );
    for (const s of existing.rows) {
      if (s.notes) {
        const m = s.notes.match(/contract_schedule:([^|]+)/);
        if (m) existingSchedulesMap.set(`${s.community_id}|${m[1]!.trim()}`, s.id);
      }
    }
  }

  let totalVisits    = 0;
  let totalCompleted = 0;
  let totalScheduled = 0;

  for (const row of recurringRows) {
    const title      = String(row["Ticket Title"] ?? "").trim();
    const nVisits    = parseInt(String(row["Total Visits"] ?? "0").trim()) || 0;
    const serviceType = titleToServiceType(title);
    const visitDates = generateVisitDates(nVisits);

    const completedDates = visitDates.filter(d => isDatePassed(d));
    const scheduledDates = visitDates.filter(d => !isDatePassed(d));

    for (const com of communityMapping) {
      const existingId = existingSchedulesMap.get(`${com.id}|${title}`);

      schedulePlans.push({
        communityCode:    com.code,
        communityId:      com.id,
        communityName:    com.name,
        serviceType,
        ticketTitle:      title,
        action:           existingId ? "existing" : "create",
        existingScheduleId: existingId,
        visitCount:       nVisits,
        completedVisits:  completedDates.length,
        scheduledVisits:  scheduledDates.length,
      });

      totalVisits    += nVisits;
      totalCompleted += completedDates.length;
      totalScheduled += scheduledDates.length;
    }
  }

  // ── One-time rows → task counts ────────────────────────────────────────────
  let oneTimeTasks       = 0;
  let oneTimeCompletions = 0;

  for (const row of oneTimeRows) {
    const endD = parseSeasonalDate(row["End Date"]);
    const isCompleted = endD ? isDatePassed(toISODate(endD)) : false;
    oneTimeTasks++;
    if (isCompleted) oneTimeCompletions++;
  }

  const totalTasks       = oneTimeTasks * communityMapping.length;
  const totalCompletions = oneTimeCompletions * communityMapping.length;

  const schedulesToCreate = schedulePlans.filter(p => p.action === "create").length;
  const schedulesExisting = schedulePlans.filter(p => p.action === "existing").length;

  return {
    blockingErrors,
    warnings,
    communityMapping,
    schedulePlans,
    serviceAccountResolution,
    counts: {
      totalRows:           allRows.length,
      recurringRows:       recurringRows.length,
      oneTimeRows:         oneTimeRows.length,
      schedulesToCreate,
      schedulesExisting,
      visitsToInsert:      totalVisits,
      completedVisits:     totalCompleted,
      scheduledVisits:     totalScheduled,
      tasksToInsert:       totalTasks,
      completionsToInsert: totalCompletions,
      skippedRows,
      communities:         communityMapping.length,
    },
  };
}

// ---------------------------------------------------------------------------
// commitSeasonal — writes schedules / visits / tasks; logs import_batches
// ---------------------------------------------------------------------------

export async function commitSeasonal(
  allRows: Record<string, any>[],
  pool: InstanceType<typeof Pool>,
  runByUserId: string,
): Promise<SeasonalCommitResult> {
  // ── Server-side guard: re-run fixed-layout assertions ─────────────────────
  // This prevents a client from bypassing parse validation and committing
  // malformed or out-of-year data directly to the database.
  const layoutErrors = assertContractLayout(allRows);
  if (layoutErrors.length > 0) {
    throw new Error(
      `Cannot commit — layout validation failed:\n` +
      layoutErrors.map(e => `  • ${e}`).join("\n"),
    );
  }

  let schedulesCreated    = 0;
  let visitsInserted      = 0;
  let visitsSkipped       = 0;
  let tasksInserted       = 0;
  let tasksSkipped        = 0;
  let completionsInserted = 0;

  // Generate batchId upfront so we can embed it in notes/fingerprints
  const { randomUUID } = await import("node:crypto");
  const batchId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Service account ──────────────────────────────────────────────────────
    const serviceAccountId = await resolveOrCreateServiceAccount(client);

    // ── Resolve pilot-org communities — must ALL resolve ─────────────────────
    const { communityMapping, blockingErrors: communityErrors } = await resolvePilotCommunities(client);
    if (communityErrors.length > 0) {
      throw new Error(
        `Cannot commit — ${communityErrors.length} community code(s) did not resolve:\n` +
        communityErrors.map(e => `  • ${e}`).join("\n"),
      );
    }
    // All KNOWN_PNC_CODES must have exactly one match
    if (communityMapping.length !== KNOWN_PNC_CODES.size) {
      throw new Error(
        `Cannot commit — expected ${KNOWN_PNC_CODES.size} pilot communities but only ` +
        `${communityMapping.length} resolved. Aborting to prevent partial import.`,
      );
    }

    const communityMap = new Map(communityMapping.map(c => [c.code, c]));

    // ── Split rows ───────────────────────────────────────────────────────────
    const recurringRows = allRows.filter(r => {
      const freq = String(r["Frequency"] ?? "").trim().toLowerCase();
      return freq === "weekly" || freq === "monthly";
    });
    const oneTimeRows = allRows.filter(r => {
      const freq = String(r["Frequency"] ?? "").trim().toLowerCase();
      return freq === "one-time" || freq === "one time";
    });

    // ── Recurring rows → schedules + visits ───────────────────────────────────
    for (const row of recurringRows) {
      const title       = String(row["Ticket Title"] ?? "").trim();
      const nVisits     = parseInt(String(row["Total Visits"] ?? "0").trim()) || 0;
      const serviceType = titleToServiceType(title);
      const noteTag     = `contract_schedule:${title}`;
      const visitDates  = generateVisitDates(nVisits);

      for (const com of communityMapping) {
        // Upsert schedule — idempotency via notes tag
        const existingSched = await client.query<{ id: string }>(
          `SELECT id FROM service_schedules
            WHERE community_id = $1
              AND notes LIKE $2
            LIMIT 1`,
          [com.id, `%${noteTag}%`],
        );

        let scheduleId: string;
        if (existingSched.rows.length > 0) {
          scheduleId = existingSched.rows[0]!.id;
        } else {
          const newSched = await client.query<{ id: string }>(
            `INSERT INTO service_schedules
               (community_id, service_type, day_of_week, is_active, notes)
             VALUES ($1, $2, 3, true, $3)
             RETURNING id`,
            [com.id, serviceType, `${noteTag} | batch:${batchId}`],
          );
          scheduleId = newSched.rows[0]!.id;
          schedulesCreated++;
        }

        // Upsert visits — idempotency on (schedule_id, service_date)
        // All newly inserted visits carry notes = 'batch:{batchId}' so the undo
        // route can scope deletes to this batch even when the schedule was pre-existing.
        for (const serviceDate of visitDates) {
          const isPast = isDatePassed(serviceDate);
          const status = isPast ? "completed" : "scheduled";

          const existingVisit = await client.query<{ id: string }>(
            `SELECT id FROM service_visits
              WHERE schedule_id = $1 AND service_date = $2
              LIMIT 1`,
            [scheduleId, serviceDate],
          );

          if (existingVisit.rows.length > 0) {
            visitsSkipped++;
          } else {
            await client.query(
              `INSERT INTO service_visits
                 (schedule_id, community_id, service_date, status,
                  completed_at, completed_by, employee_sign_off_name, notes)
               VALUES ($1, $2, $3, $4, $5, $6, '', $7)`,
              [
                scheduleId, com.id, serviceDate, status,
                isPast ? serviceDate : null,
                isPast ? serviceAccountId : null,
                `batch:${batchId}`,
              ],
            );
            visitsInserted++;
          }
        }
      }
    }

    // ── One-time rows → tasks ─────────────────────────────────────────────────
    for (const row of oneTimeRows) {
      const title       = String(row["Ticket Title"] ?? "").trim();
      const ticketType  = String(row["Ticket Type"] ?? "").trim() || null;
      const description = String(row["Description"] ?? "").trim() || null;
      const priority    = String(row["Priority"] ?? "medium").trim().toLowerCase() || "medium";
      const startD      = parseSeasonalDate(row["Start Date"]);
      const endD        = parseSeasonalDate(row["End Date"]);

      if (!startD || !endD) continue; // already validated, but guard anyway

      const windowStart = toISODate(startD);
      const windowEnd   = toISODate(endD);
      const isCompleted = isDatePassed(windowEnd);
      const safePriority = ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium";

      for (const com of communityMapping) {
        const sik = `contract_schedule:${com.id}:${title}`;

        const existingTask = await client.query<{ id: string }>(
          `SELECT id FROM tasks WHERE schedule_instance_key = $1 LIMIT 1`,
          [sik],
        );

        if (existingTask.rows.length > 0) {
          tasksSkipped++;
        } else {
          const newTask = await client.query<{ id: string }>(
            `INSERT INTO tasks
               (community_id, title, description, status, priority, origin, category,
                schedule_instance_key, window_start, window_end, due_date,
                created_by, import_fingerprint)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)
             RETURNING id`,
            [
              com.id,
              title,
              description,
              isCompleted ? "completed" : "pending",
              safePriority,
              CONTRACT_ORIGIN,
              ticketType,            // Ticket Type → category
              sik,
              windowStart,
              windowEnd,
              serviceAccountId,
              batchId,
            ],
          );
          const taskId = newTask.rows[0]!.id;
          tasksInserted++;

          if (isCompleted) {
            await client.query(
              `INSERT INTO task_completions
                 (task_id, completed_by, notes, employee_sign_off_name, completed_at)
               VALUES ($1, $2, $3, '', $4)`,
              [taskId, serviceAccountId, description, windowEnd],
            );
            completionsInserted++;
          }
        }
      }
    }

    // ── Log import batch ──────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO import_batches
         (id, mode, batch_label, run_by, schedule_count, visit_count, task_count, completion_count)
       VALUES ($1, 'seasonal', $2, $3, $4, $5, $6, $7)`,
      [
        batchId,
        `contract_schedule_${new Date().toISOString().slice(0, 10)}`,
        runByUserId,
        schedulesCreated,
        visitsInserted,
        tasksInserted,
        completionsInserted,
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const undoSQL =
    `-- Undo contract_schedule import batch ${batchId}\n` +
    `-- 1. task_completions cascade-delete with tasks; explicit for safety\n` +
    `DELETE FROM task_completions\n` +
    `  WHERE task_id IN (\n` +
    `    SELECT id FROM tasks\n` +
    `     WHERE import_fingerprint = '${batchId}'\n` +
    `       AND origin = '${CONTRACT_ORIGIN}'\n` +
    `  );\n` +
    `-- 2. Tasks\n` +
    `DELETE FROM tasks\n` +
    `  WHERE import_fingerprint = '${batchId}'\n` +
    `    AND origin = '${CONTRACT_ORIGIN}';\n` +
    `-- 3. Service visits (notes-tagged, covers both new and reused schedules)\n` +
    `DELETE FROM service_visits WHERE notes = 'batch:${batchId}';\n` +
    `-- 4. Service schedules created by this batch\n` +
    `DELETE FROM service_schedules WHERE notes LIKE '%batch:${batchId}%';\n` +
    `-- 5. Batch record\n` +
    `DELETE FROM import_batches WHERE id = '${batchId}';`;

  return {
    schedulesCreated,
    visitsInserted,
    visitsSkipped,
    tasksInserted,
    tasksSkipped,
    completionsInserted,
    batchId,
    undoSQL,
  };
}
