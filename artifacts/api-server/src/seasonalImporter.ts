/**
 * seasonalImporter.ts
 *
 * Seasonal contract importer for the admin browser upload page.
 * Follows the parse/preview/commit pattern of contractImporter.ts.
 *
 * Variable column layout — the UI's Map Columns step lets the admin
 * identify which spreadsheet column carries each semantic field.
 *
 * Validation rules (all enforced during preview; blocking errors disable Commit):
 *  - All service_date values must be in the year 2026
 *  - Every service_date must be a Wednesday (day-of-week = 3)
 *  - Every community code must resolve to exactly one community in the DB
 *
 * Idempotency:
 *  - service_visits: unique on (schedule_id, service_date) via existing DB index
 *  - tasks: unique on schedule_instance_key = "seasonal:<scheduleId>:<serviceDate>:<titleHash>"
 */

import * as XLSX from "xlsx";
import { createHash } from "crypto";
import pg from "pg";

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeasonalParseResult {
  columns: string[];
  rowsPreview: Record<string, any>[];
  totalRows: number;
  allRows: Record<string, any>[];
  sheetNames?: string[];
}

export interface SeasonalColumnMappings {
  communityCode: string;  // column containing community code (e.g. "FB01")
  serviceDate: string;    // column containing service date
  serviceType: string;    // column containing service type / schedule category
  taskTitle: string;      // column containing task title
  description?: string | null;
  status?: string | null; // optional: 'completed' / 'done' rows get task_completions
}

export interface SeasonalSchedulePlan {
  communityCode: string;
  communityId: string;
  communityName: string;
  serviceType: string;
  action: "create" | "existing";
  existingScheduleId?: string;
  visitCount: number;
  taskCount: number;
}

export interface SeasonalPreviewResult {
  blockingErrors: string[];
  warnings: string[];
  schedulePlans: SeasonalSchedulePlan[];
  counts: {
    schedulesToCreate: number;
    schedulesExisting: number;
    visitsToInsert: number;
    tasksToInsert: number;
    completionsToInsert: number;
    totalRows: number;
    skippedRows: number;
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

const SEASONAL_ORIGIN = "seasonal_import";

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

  return {
    columns,
    rowsPreview: allRows.slice(0, 50),
    totalRows: allRows.length,
    allRows,
    sheetNames: sheetNames.length > 1 ? sheetNames : undefined,
  };
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

function isWednesday(d: Date): boolean {
  return d.getDay() === 3;
}

function scheduleInstanceKey(scheduleId: string, serviceDate: string, titleHash: string): string {
  return `seasonal:${scheduleId}:${serviceDate}:${titleHash}`;
}

function titleHash(title: string): string {
  return createHash("sha256").update(title.toLowerCase().trim()).digest("hex").substring(0, 12);
}

// ---------------------------------------------------------------------------
// previewSeasonal — queries DB to resolve communities; never writes
// ---------------------------------------------------------------------------

export async function previewSeasonal(
  allRows: Record<string, any>[],
  mappings: SeasonalColumnMappings,
  pool: InstanceType<typeof Pool>,
): Promise<SeasonalPreviewResult> {
  const blockingErrors: string[] = [];
  const warnings: string[]       = [];

  // Collect all community codes in the file
  const communityCodesInFile = new Set<string>();
  for (const row of allRows) {
    const code = String(row[mappings.communityCode] ?? "").trim();
    if (code) communityCodesInFile.add(code);
  }

  // Resolve communities from DB
  const communityMap = new Map<string, { id: string; name: string }>();
  if (communityCodesInFile.size > 0) {
    const codes = [...communityCodesInFile];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query<{ id: string; name: string; code: string }>(
      `SELECT id, name, code FROM communities WHERE code IN (${placeholders})`,
      codes,
    );
    const byCode = new Map<string, typeof result.rows[0][]>();
    for (const row of result.rows) {
      if (!byCode.has(row.code)) byCode.set(row.code, []);
      byCode.get(row.code)!.push(row);
    }
    for (const code of codes) {
      const matches = byCode.get(code) ?? [];
      if (matches.length === 0) {
        blockingErrors.push(`Community code "${code}" — not found in database`);
      } else if (matches.length > 1) {
        blockingErrors.push(`Community code "${code}" — ${matches.length} communities match`);
      } else {
        communityMap.set(code, { id: matches[0]!.id, name: matches[0]!.name });
      }
    }
  }

  // Validate rows and plan schedules/visits/tasks
  const scheduleKey = (communityCode: string, serviceType: string) =>
    `${communityCode}|${serviceType}`;

  const schedulePlansMap = new Map<string, {
    communityCode: string; communityId: string; communityName: string; serviceType: string;
    visitDates: Set<string>; taskTitles: string[];
  }>();

  let skippedRows   = 0;
  let non2026Errors = 0;
  let nonWedErrors  = 0;
  let completionRows = 0;

  for (const row of allRows) {
    const communityCode = String(row[mappings.communityCode] ?? "").trim();
    const serviceType   = String(row[mappings.serviceType] ?? "").trim();
    const taskTitle     = String(row[mappings.taskTitle] ?? "").trim();
    const rawDate       = row[mappings.serviceDate];
    const status        = mappings.status ? String(row[mappings.status] ?? "").trim().toLowerCase() : "";

    if (!communityCode && !taskTitle) { skippedRows++; continue; }
    if (!communityCode) { skippedRows++; continue; }

    const dateObj = parseSeasonalDate(rawDate);
    if (!dateObj) { skippedRows++; continue; }

    const year = dateObj.getFullYear();
    if (year !== 2026) {
      non2026Errors++;
      continue;
    }

    if (!isWednesday(dateObj)) {
      nonWedErrors++;
      continue;
    }

    const serviceDate = toISODate(dateObj);
    const com = communityMap.get(communityCode);
    if (!com) continue; // already reported as blocking error

    const key = scheduleKey(communityCode, serviceType);
    if (!schedulePlansMap.has(key)) {
      schedulePlansMap.set(key, {
        communityCode, communityId: com.id, communityName: com.name, serviceType,
        visitDates: new Set(), taskTitles: [],
      });
    }
    const plan = schedulePlansMap.get(key)!;
    plan.visitDates.add(serviceDate);
    if (taskTitle) plan.taskTitles.push(taskTitle);

    if (status === "completed" || status === "done" || status === "complete") {
      completionRows++;
    }
  }

  if (non2026Errors > 0) {
    blockingErrors.push(
      `${non2026Errors} row(s) have service dates outside 2026. All service dates must be in 2026.`,
    );
  }
  if (nonWedErrors > 0) {
    blockingErrors.push(
      `${nonWedErrors} row(s) have service dates that are not Wednesdays. All seasonal service dates must be Wednesdays.`,
    );
  }

  // Check for existing schedules
  const scheduleExistenceMap = new Map<string, string>(); // key → existing scheduleId
  if (schedulePlansMap.size > 0) {
    const communityIds = [...new Set([...schedulePlansMap.values()].map(p => p.communityId))];
    const placeholders = communityIds.map((_, i) => `$${i + 1}`).join(", ");
    const existing = await pool.query<{ id: string; community_id: string; notes: string }>(
      `SELECT id, community_id, notes FROM service_schedules WHERE community_id IN (${placeholders})`,
      communityIds,
    );
    for (const s of existing.rows) {
      if (s.notes) {
        const tag = s.notes.match(/seasonal_key:(\S+)/);
        if (tag) scheduleExistenceMap.set(tag[1], s.id);
      }
    }
  }

  const schedulePlans: SeasonalSchedulePlan[] = [];
  let totalVisits = 0;
  let totalTasks  = 0;

  for (const [key, plan] of schedulePlansMap) {
    const existing  = scheduleExistenceMap.get(key);
    const visitCount = plan.visitDates.size;
    const taskCount  = plan.taskTitles.length;
    schedulePlans.push({
      communityCode: plan.communityCode,
      communityId:   plan.communityId,
      communityName: plan.communityName,
      serviceType:   plan.serviceType,
      action:        existing ? "existing" : "create",
      existingScheduleId: existing,
      visitCount, taskCount,
    });
    totalVisits += visitCount;
    totalTasks  += taskCount;
  }

  return {
    blockingErrors,
    warnings,
    schedulePlans,
    counts: {
      schedulesToCreate:   schedulePlans.filter(p => p.action === "create").length,
      schedulesExisting:   schedulePlans.filter(p => p.action === "existing").length,
      visitsToInsert:      totalVisits,
      tasksToInsert:       totalTasks,
      completionsToInsert: completionRows,
      totalRows:           allRows.length,
      skippedRows,
    },
  };
}

// ---------------------------------------------------------------------------
// commitSeasonal — writes schedules / visits / tasks; logs import_batches
// ---------------------------------------------------------------------------

export async function commitSeasonal(
  allRows: Record<string, any>[],
  mappings: SeasonalColumnMappings,
  pool: InstanceType<typeof Pool>,
  runByUserId: string,
): Promise<SeasonalCommitResult> {
  let schedulesCreated    = 0;
  let visitsInserted      = 0;
  let visitsSkipped       = 0;
  let tasksInserted       = 0;
  let tasksSkipped        = 0;
  let completionsInserted = 0;
  let batchId             = "";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Build schedule map: scheduleKey → scheduleId
    const scheduleIdMap = new Map<string, string>();

    for (const row of allRows) {
      const communityCode = String(row[mappings.communityCode] ?? "").trim();
      const serviceType   = String(row[mappings.serviceType] ?? "").trim();
      const taskTitle     = String(row[mappings.taskTitle] ?? "").trim();
      const rawDate       = row[mappings.serviceDate];
      const description   = mappings.description ? String(row[mappings.description] ?? "").trim() : "";
      const statusRaw     = mappings.status ? String(row[mappings.status] ?? "").trim().toLowerCase() : "";
      const isCompleted   = ["completed", "done", "complete"].includes(statusRaw);

      if (!communityCode) continue;

      const dateObj = parseSeasonalDate(rawDate);
      if (!dateObj || dateObj.getFullYear() !== 2026 || !isWednesday(dateObj)) continue;

      const serviceDate = toISODate(dateObj);

      // Resolve community
      const comResult = await client.query<{ id: string }>(
        `SELECT id FROM communities WHERE code = $1 LIMIT 1`,
        [communityCode],
      );
      if (comResult.rows.length === 0) continue;
      const communityId = comResult.rows[0]!.id;

      // Upsert service schedule (one per community + serviceType)
      const sKey    = `${communityCode}|${serviceType}`;
      const noteTag = `seasonal_key:${sKey}`;

      if (!scheduleIdMap.has(sKey)) {
        // Look for existing schedule with this tag
        const existingSchedule = await client.query<{ id: string }>(
          `SELECT id FROM service_schedules
           WHERE community_id = $1 AND notes LIKE $2
           LIMIT 1`,
          [communityId, `%${noteTag}%`],
        );
        if (existingSchedule.rows.length > 0) {
          scheduleIdMap.set(sKey, existingSchedule.rows[0]!.id);
        } else {
          // Create new schedule — dayOfWeek=3 (Wednesday), general_service type
          const newSched = await client.query<{ id: string }>(
            `INSERT INTO service_schedules
               (community_id, service_type, day_of_week, is_active, notes)
             VALUES ($1, 'general_service', 3, true, $2)
             RETURNING id`,
            [communityId, `${serviceType} | ${noteTag}`],
          );
          scheduleIdMap.set(sKey, newSched.rows[0]!.id);
          schedulesCreated++;
        }
      }

      const scheduleId = scheduleIdMap.get(sKey)!;

      // Upsert service visit — idempotent on (schedule_id, service_date)
      const existingVisit = await client.query<{ id: string }>(
        `SELECT id FROM service_visits
         WHERE schedule_id = $1 AND service_date = $2
         LIMIT 1`,
        [scheduleId, serviceDate],
      );
      let visitId: string;
      if (existingVisit.rows.length > 0) {
        visitId = existingVisit.rows[0]!.id;
        visitsSkipped++;
      } else {
        const newVisit = await client.query<{ id: string }>(
          `INSERT INTO service_visits (schedule_id, community_id, service_date, status)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [scheduleId, communityId, serviceDate, isCompleted ? "completed" : "scheduled"],
        );
        visitId = newVisit.rows[0]!.id;
        visitsInserted++;
      }

      if (!taskTitle) continue;

      // Upsert task — idempotent on schedule_instance_key
      const tHash = titleHash(taskTitle);
      const sik   = scheduleInstanceKey(scheduleId, serviceDate, tHash);

      const existingTask = await client.query<{ id: string }>(
        `SELECT id FROM tasks WHERE schedule_instance_key = $1 LIMIT 1`,
        [sik],
      );

      let taskId: string;
      if (existingTask.rows.length > 0) {
        taskId = existingTask.rows[0]!.id;
        tasksSkipped++;
      } else {
        const newTask = await client.query<{ id: string }>(
          `INSERT INTO tasks
             (community_id, title, description, status, priority, origin,
              schedule_instance_key, window_start, window_end, created_by)
           VALUES ($1, $2, $3, $4, 'medium', $5, $6, $7, $7, $8)
           RETURNING id`,
          [
            communityId, taskTitle, description || null,
            isCompleted ? "completed" : "pending",
            SEASONAL_ORIGIN, sik, serviceDate, runByUserId,
          ],
        );
        taskId = newTask.rows[0]!.id;
        tasksInserted++;

        if (isCompleted) {
          await client.query(
            `INSERT INTO task_completions
               (task_id, completed_by, notes, employee_sign_off_name, completed_at)
             VALUES ($1, $2, $3, '', $4)`,
            [taskId, runByUserId, description || null, serviceDate],
          );
          completionsInserted++;
        }
      }
    }

    // Log batch
    const batchRes = await client.query<{ id: string }>(
      `INSERT INTO import_batches
         (mode, batch_label, run_by, schedule_count, visit_count, task_count, completion_count)
       VALUES ('seasonal', $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `seasonal_${new Date().toISOString().slice(0, 10)}`,
        runByUserId, schedulesCreated, visitsInserted,
        tasksInserted, completionsInserted,
      ],
    );
    batchId = batchRes.rows[0]!.id;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const undoSQL =
    `-- Undo seasonal import batch ${batchId}\n` +
    `DELETE FROM tasks WHERE origin = '${SEASONAL_ORIGIN}';\n` +
    `-- (service_visits and task_completions CASCADE from their parents)\n` +
    `DELETE FROM import_batches WHERE id = '${batchId}';`;

  return { schedulesCreated, visitsInserted, visitsSkipped, tasksInserted, tasksSkipped, completionsInserted, batchId, undoSQL };
}
