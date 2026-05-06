import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { db } from "./db";
import { tasks, serviceSchedules, serviceVisits } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ParseResult {
  columns: string[];
  rowsPreview: Record<string, any>[];
  totalRows: number;
  sheetNames?: string[];
  inferredMappings: Record<string, string | null>;
}

export interface ColumnMappings {
  title: string;
  windowStart: string;
  windowEnd: string;
  description?: string | null;
  priority?: string | null;
  category?: string | null;
}

export interface MowingConfig {
  mode: "keyword" | "manual";
  keywords?: string[];
  manualRowIndices?: number[];
  dayOfWeek: number;
  seasonStart?: string | null;
  seasonEnd?: string | null;
}

export interface PreviewRequest {
  communityId: string;
  mappings: ColumnMappings;
  mowingConfig: MowingConfig;
  defaultPriority: string;
  importMode: "create" | "upsert";
  parsedData: Record<string, any>[];
}

export interface TaskPreviewRow {
  rowIndex: number;
  title: string;
  windowStart: string | null;
  windowEnd: string | null;
  priority: string;
  description: string;
  category: string;
  action: "create" | "update" | "skip" | "error";
  error?: string;
  fingerprint: string;
  existingTaskId?: string;
}

export interface PreviewResult {
  mowingSchedulePreview: {
    dayOfWeek: number;
    seasonStart: string | null;
    seasonEnd: string | null;
    action: "create" | "update";
    existingId?: string;
  } | null;
  tasksPreview: TaskPreviewRow[];
  mowingRowIndices: number[];
  counts: {
    total: number;
    toCreate: number;
    toUpdate: number;
    toSkip: number;
    errors: number;
    mowingRows: number;
  };
}

export interface CommitResult {
  scheduleResult: { action: string; id: string } | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
}

const MOWING_KEYWORDS_DEFAULT = ["mow", "mowing", "weekly maintenance", "weekly service", "landscape visit", "weekly landscape"];

const TITLE_COLUMN_PATTERNS = ["title", "task", "name", "item", "description", "service", "scope"];
const START_COLUMN_PATTERNS = ["start", "begin", "from", "window start", "start date"];
const END_COLUMN_PATTERNS = ["end", "finish", "to", "window end", "end date", "due", "deadline"];
const DESC_COLUMN_PATTERNS = ["desc", "note", "detail", "comment", "specification"];
const PRIORITY_COLUMN_PATTERNS = ["priority", "urgency", "importance", "level"];
const CATEGORY_COLUMN_PATTERNS = ["category", "section", "group", "type", "area"];

function inferMapping(columns: string[], patterns: string[]): string | null {
  const lower = columns.map(c => c.toLowerCase().trim());
  for (const pattern of patterns) {
    const exact = lower.indexOf(pattern);
    if (exact >= 0) return columns[exact];
  }
  for (const pattern of patterns) {
    const partial = lower.findIndex(c => c.includes(pattern));
    if (partial >= 0) return columns[partial];
  }
  return null;
}

export function parseFile(buffer: Buffer, filename: string, sheetName?: string): ParseResult {
  const ext = filename.toLowerCase().split(".").pop();
  let workbook: XLSX.WorkBook;

  if (ext === "csv") {
    const csvText = buffer.toString("utf-8");
    workbook = XLSX.read(csvText, { type: "string", cellDates: true });
  } else {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  }

  const sheetNames = workbook.SheetNames;
  const targetSheet = sheetName || sheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];

  if (!worksheet) {
    throw new Error(`Sheet "${targetSheet}" not found`);
  }

  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  if (rawData.length < 2) {
    throw new Error("File must have at least a header row and one data row");
  }

  const headerRow = rawData[0].map((h: any) => String(h).trim());
  const columns = headerRow.filter((h: string) => h.length > 0);

  const rows: Record<string, any>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row: Record<string, any> = {};
    let hasData = false;
    for (let j = 0; j < columns.length; j++) {
      const val = rawData[i][j];
      row[columns[j]] = val !== undefined && val !== null ? val : "";
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        hasData = true;
      }
    }
    if (hasData) {
      rows.push(row);
    }
  }

  const inferredMappings: Record<string, string | null> = {
    title: inferMapping(columns, TITLE_COLUMN_PATTERNS),
    windowStart: inferMapping(columns, START_COLUMN_PATTERNS),
    windowEnd: inferMapping(columns, END_COLUMN_PATTERNS),
    description: inferMapping(columns, DESC_COLUMN_PATTERNS),
    priority: inferMapping(columns, PRIORITY_COLUMN_PATTERNS),
    category: inferMapping(columns, CATEGORY_COLUMN_PATTERNS),
  };

  return {
    columns,
    rowsPreview: rows.slice(0, 50),
    totalRows: rows.length,
    sheetNames: sheetNames.length > 1 ? sheetNames : undefined,
    inferredMappings,
  };
}

function parseDate(value: any): string | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return formatDateISO(value);
  }

  if (typeof value === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    if (isNaN(d.getTime())) return null;
    return formatDateISO(d);
  }

  const str = String(value).trim();
  if (!str) return null;

  const mmddyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mmddyyyy) {
    let year = parseInt(mmddyyyy[3]);
    if (year < 100) year += 2000;
    const month = parseInt(mmddyyyy[1]);
    const day = parseInt(mmddyyyy[2]);
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) return formatDateISO(d);
  }

  const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const d = new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
    if (!isNaN(d.getTime())) return formatDateISO(d);
  }

  const monthDay = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
  if (monthDay) {
    const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const m = months[monthDay[1].toLowerCase().substring(0, 3)];
    const day = parseInt(monthDay[2]);
    const year = monthDay[3] ? parseInt(monthDay[3]) : new Date().getFullYear();
    const d = new Date(year, m, day);
    if (!isNaN(d.getTime())) return formatDateISO(d);
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return formatDateISO(d);

  return null;
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizePriority(value: any, defaultPriority: string): string {
  if (!value) return defaultPriority;
  const str = String(value).toLowerCase().trim();
  if (["low", "l", "1"].includes(str)) return "low";
  if (["medium", "med", "m", "2", "normal"].includes(str)) return "medium";
  if (["high", "h", "3"].includes(str)) return "high";
  if (["urgent", "u", "4", "critical"].includes(str)) return "urgent";
  return defaultPriority;
}

function computeFingerprint(communityId: string, title: string, windowStart: string, windowEnd: string): string {
  const normalized = `${communityId}|${title.toLowerCase().trim()}|${windowStart}|${windowEnd}`;
  return createHash("sha256").update(normalized).digest("hex").substring(0, 40);
}

function isMowingRow(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

export async function generatePreview(
  parsedData: Record<string, any>[],
  communityId: string,
  mappings: ColumnMappings,
  mowingConfig: MowingConfig,
  defaultPriority: string,
  importMode: "create" | "upsert"
): Promise<PreviewResult> {
  const keywords = mowingConfig.keywords || MOWING_KEYWORDS_DEFAULT;
  const mowingRowIndices: number[] = [];
  const tasksPreview: TaskPreviewRow[] = [];

  for (let i = 0; i < parsedData.length; i++) {
    const row = parsedData[i];
    const title = String(row[mappings.title] || "").trim();

    if (!title) continue;

    let isMowing = false;
    if (mowingConfig.mode === "keyword") {
      isMowing = isMowingRow(title, keywords);
    } else if (mowingConfig.mode === "manual") {
      isMowing = (mowingConfig.manualRowIndices || []).includes(i);
    }

    if (isMowing) {
      mowingRowIndices.push(i);
      continue;
    }

    const rawStart = row[mappings.windowStart];
    const rawEnd = row[mappings.windowEnd];
    const windowStart = parseDate(rawStart);
    const windowEnd = parseDate(rawEnd);
    const description = mappings.description ? String(row[mappings.description] || "").trim() : "";
    const priority = mappings.priority ? normalizePriority(row[mappings.priority], defaultPriority) : defaultPriority;
    const category = mappings.category ? String(row[mappings.category] || "").trim() : "";

    let error: string | undefined;
    let action: TaskPreviewRow["action"] = "create";

    if (!windowStart && !windowEnd) {
      error = "Missing both window start and end dates";
      action = "error";
    } else if (!windowStart) {
      error = "Missing window start date";
      action = "error";
    } else if (!windowEnd) {
      error = "Missing window end date";
      action = "error";
    } else if (windowStart > windowEnd) {
      error = "Window start is after window end";
      action = "error";
    }

    const fingerprint = windowStart && windowEnd
      ? computeFingerprint(communityId, title, windowStart, windowEnd)
      : "";

    tasksPreview.push({
      rowIndex: i,
      title,
      windowStart,
      windowEnd,
      priority,
      description,
      category,
      action,
      error,
      fingerprint,
    });
  }

  if (tasksPreview.length > 0) {
    const fingerprints = tasksPreview
      .filter(t => t.fingerprint && t.action !== "error")
      .map(t => t.fingerprint);

    if (fingerprints.length > 0) {
      const existingTasks = await db
        .select({ id: tasks.id, importFingerprint: tasks.importFingerprint })
        .from(tasks)
        .where(
          and(
            eq(tasks.communityId, communityId),
          )
        );

      const existingMap = new Map<string, string>();
      for (const t of existingTasks) {
        if (t.importFingerprint) {
          existingMap.set(t.importFingerprint, t.id);
        }
      }

      for (const tp of tasksPreview) {
        if (tp.action === "error" || !tp.fingerprint) continue;
        const existingId = existingMap.get(tp.fingerprint);
        if (existingId) {
          tp.existingTaskId = existingId;
          tp.action = importMode === "upsert" ? "update" : "skip";
        }
      }
    }
  }

  let mowingSchedulePreview = null;
  if (mowingRowIndices.length > 0) {
    const existingSchedules = await db
      .select()
      .from(serviceSchedules)
      .where(
        and(
          eq(serviceSchedules.communityId, communityId),
          eq(serviceSchedules.serviceType, "mowing_visit")
        )
      );

    if (existingSchedules.length > 0) {
      mowingSchedulePreview = {
        dayOfWeek: mowingConfig.dayOfWeek,
        seasonStart: mowingConfig.seasonStart || null,
        seasonEnd: mowingConfig.seasonEnd || null,
        action: "update" as const,
        existingId: existingSchedules[0].id,
      };
    } else {
      mowingSchedulePreview = {
        dayOfWeek: mowingConfig.dayOfWeek,
        seasonStart: mowingConfig.seasonStart || null,
        seasonEnd: mowingConfig.seasonEnd || null,
        action: "create" as const,
      };
    }
  }

  const counts = {
    total: tasksPreview.length,
    toCreate: tasksPreview.filter(t => t.action === "create").length,
    toUpdate: tasksPreview.filter(t => t.action === "update").length,
    toSkip: tasksPreview.filter(t => t.action === "skip").length,
    errors: tasksPreview.filter(t => t.action === "error").length,
    mowingRows: mowingRowIndices.length,
  };

  return {
    mowingSchedulePreview,
    tasksPreview,
    mowingRowIndices,
    counts,
  };
}

export async function commitImport(
  tasksPreview: TaskPreviewRow[],
  mowingSchedulePreview: PreviewResult["mowingSchedulePreview"],
  communityId: string,
  adminUserId: string,
  defaultPriority: string,
): Promise<CommitResult> {
  let scheduleResult: CommitResult["scheduleResult"] = null;
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  if (mowingSchedulePreview) {
    if (mowingSchedulePreview.action === "update" && mowingSchedulePreview.existingId) {
      await db
        .update(serviceSchedules)
        .set({
          dayOfWeek: mowingSchedulePreview.dayOfWeek,
          seasonStart: mowingSchedulePreview.seasonStart,
          seasonEnd: mowingSchedulePreview.seasonEnd,
          updatedAt: new Date(),
        })
        .where(eq(serviceSchedules.id, mowingSchedulePreview.existingId));
      scheduleResult = { action: "updated", id: mowingSchedulePreview.existingId };
    } else {
      const [newSchedule] = await db
        .insert(serviceSchedules)
        .values({
          communityId,
          serviceType: "mowing_visit",
          dayOfWeek: mowingSchedulePreview.dayOfWeek,
          seasonStart: mowingSchedulePreview.seasonStart,
          seasonEnd: mowingSchedulePreview.seasonEnd,
          isActive: true,
        })
        .returning();
      scheduleResult = { action: "created", id: newSchedule.id };
    }
  }

  for (const tp of tasksPreview) {
    if (tp.action === "error") {
      errorCount++;
      continue;
    }
    if (tp.action === "skip") {
      skippedCount++;
      continue;
    }

    try {
      if (tp.action === "create") {
        await db.insert(tasks).values({
          communityId,
          title: tp.title,
          description: tp.description || null,
          priority: tp.priority as any,
          windowStart: tp.windowStart,
          windowEnd: tp.windowEnd,
          createdBy: adminUserId,
          importFingerprint: tp.fingerprint,
          status: "pending",
        });
        createdCount++;
      } else if (tp.action === "update" && tp.existingTaskId) {
        await db
          .update(tasks)
          .set({
            title: tp.title,
            description: tp.description || null,
            priority: tp.priority as any,
            windowStart: tp.windowStart,
            windowEnd: tp.windowEnd,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, tp.existingTaskId));
        updatedCount++;
      }
    } catch (err) {
      console.error(`Failed to import task row ${tp.rowIndex}:`, err);
      errorCount++;
    }
  }

  return {
    scheduleResult,
    createdCount,
    updatedCount,
    skippedCount,
    errorCount,
  };
}
