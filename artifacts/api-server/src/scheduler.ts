import * as storage from "./storage";
import { notifyTaskAssigned } from "./pushNotifications";
import { logger } from "./lib/logger";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function computeNextRunAt(
  frequency: "weekly" | "monthly" | "once",
  daysOfWeek: string | null,
  dayOfMonth: number | null,
  startDate: Date,
  endDate: Date | null,
  now: Date,
): Date | null {
  if (frequency === "once") {
    if (now >= startDate) return null;
    return startDate;
  }

  if (frequency === "weekly") {
    const selectedDays = (daysOfWeek || "1").split(",").map(Number);
    let candidate = new Date(now);
    candidate.setHours(6, 0, 0, 0);

    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }

    for (let i = 0; i < 8; i++) {
      const dow = candidate.getDay();
      if (selectedDays.includes(dow)) {
        if (endDate && candidate > endDate) return null;
        if (candidate >= startDate) return candidate;
      }
      candidate.setDate(candidate.getDate() + 1);
    }
    return null;
  }

  if (frequency === "monthly") {
    const dom = dayOfMonth || 1;
    let candidate = new Date(now.getFullYear(), now.getMonth(), dom, 6, 0, 0, 0);

    if (candidate <= now) {
      candidate.setMonth(candidate.getMonth() + 1);
    }

    if (endDate && candidate > endDate) return null;
    if (candidate >= startDate) return candidate;

    candidate = new Date(startDate.getFullYear(), startDate.getMonth(), dom, 6, 0, 0, 0);
    if (candidate < startDate) {
      candidate.setMonth(candidate.getMonth() + 1);
    }
    if (endDate && candidate > endDate) return null;
    return candidate;
  }

  return null;
}

export function computeInitialNextRunAt(
  frequency: "weekly" | "monthly" | "once",
  daysOfWeek: string | null,
  dayOfMonth: number | null,
  startDate: Date,
  endDate: Date | null,
): Date | null {
  const now = new Date();
  if (frequency === "once") {
    if (startDate <= now) {
      const today = new Date(now);
      today.setHours(6, 0, 0, 0);
      if (today <= now) today.setDate(today.getDate() + 1);
      return today;
    }
    return startDate;
  }

  const fakeNow = new Date(startDate.getTime() - 86400000);
  return computeNextRunAt(frequency, daysOfWeek, dayOfMonth, startDate, endDate, fakeNow);
}

export interface ScheduleRunReport {
  scheduleId: string;
  templateName: string;
  communityId: string;
  createdCount: number;
  skippedCount: number;
  status: "success" | "failure";
  errorMessage?: string;
}

export async function runDueSchedules(): Promise<ScheduleRunReport[]> {
  const reports: ScheduleRunReport[] = [];
  const dueSchedules = await storage.getEnabledDueSchedules();

  console.log(`[Scheduler] Found ${dueSchedules.length} due schedule(s)`);

  for (const schedule of dueSchedules) {
    const report = await runSingleSchedule(schedule);
    reports.push(report);
  }

  return reports;
}

async function runSingleSchedule(schedule: any): Promise<ScheduleRunReport> {
  const now = new Date();
  const dateKey = formatDate(now);
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setHours(23, 59, 59, 999);

  let createdCount = 0;
  let skippedCount = 0;
  let errorMessage: string | undefined;
  let status: "success" | "failure" = "success";
  let templateName = "";

  try {
    const template = await storage.getTaskTemplateById(schedule.templateId);
    if (!template) throw new Error(`Template ${schedule.templateId} not found`);
    templateName = template.name;

    if (template.targetType === "none") {
      const instanceKey = `${schedule.id}:${dateKey}:single`;
      const exists = await storage.taskExistsWithInstanceKey(instanceKey);
      if (exists) {
        skippedCount = 1;
      } else {
        let dueDate: Date | undefined;
        if (template.dueDaysOffset != null) {
          dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + template.dueDaysOffset);
        }

        const task = await storage.createTaskWithInstanceKey({
          communityId: schedule.communityId,
          title: template.title,
          description: template.description || undefined,
          priority: template.priority,
          assignedTo: schedule.assignToUserId || undefined,
          createdBy: schedule.createdBy,
          dueDate,
          scheduleInstanceKey: instanceKey,
        });
        if (schedule.assignToUserId) {
          const community = await storage.getCommunityById(schedule.communityId);
          notifyTaskAssigned(task.id, task.title, community?.name ?? 'Unknown', schedule.assignToUserId).catch((err: unknown) => {
            logger.error({ err, scheduleId: schedule.id, taskId: task.id }, "[Scheduler] notifyTaskAssigned failed");
          });
        }
        createdCount = 1;
      }
    } else {
      const targetAssets = await storage.getTargetAssets(
        schedule.communityId,
        template.targetType,
        template.targetAssetType,
        template.targetMapLayerId,
        template.targetAssetId,
        false,
      );

      for (const asset of targetAssets) {
        const instanceKey = `${schedule.id}:${dateKey}:${asset.id}`;
        const exists = await storage.taskExistsWithInstanceKey(instanceKey);
        if (exists) {
          skippedCount++;
          continue;
        }

        let dueDate: Date | undefined;
        if (template.dueDaysOffset != null) {
          dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + template.dueDaysOffset);
        }

        const task = await storage.createTaskWithInstanceKey({
          communityId: schedule.communityId,
          title: `${template.title} — ${asset.label || asset.featureRef || asset.id.substring(0, 8)}`,
          description: template.description || undefined,
          priority: template.priority,
          latitude: asset.latitude ?? undefined,
          longitude: asset.longitude ?? undefined,
          assignedTo: schedule.assignToUserId || undefined,
          createdBy: schedule.createdBy,
          dueDate,
          scheduleInstanceKey: instanceKey,
        });

        await storage.setTaskLink(task.id, {
          linkType: "asset",
          assetId: asset.id,
        });

        if (schedule.assignToUserId) {
          const community = await storage.getCommunityById(schedule.communityId);
          notifyTaskAssigned(task.id, task.title, community?.name ?? 'Unknown', schedule.assignToUserId).catch((err: unknown) => {
            logger.error({ err, scheduleId: schedule.id, taskId: task.id }, "[Scheduler] notifyTaskAssigned failed");
          });
        }

        createdCount++;
      }
    }
  } catch (err: any) {
    status = "failure";
    errorMessage = err.message || String(err);
    console.error(`[Scheduler] Error running schedule ${schedule.id}:`, err);
  }

  try {
    await storage.createScheduleRun({
      scheduleId: schedule.id,
      windowStart,
      windowEnd,
      createdCount,
      skippedCount,
      status,
      errorMessage,
    });
  } catch (err) {
    console.error(`[Scheduler] Failed to record run for schedule ${schedule.id}:`, err);
  }

  const nextRunAt = computeNextRunAt(
    schedule.frequency,
    schedule.daysOfWeek,
    schedule.dayOfMonth,
    schedule.startDate,
    schedule.endDate,
    now,
  );
  await storage.updateScheduleNextRunAt(schedule.id, nextRunAt);

  console.log(`[Scheduler] Schedule ${schedule.id}: created=${createdCount}, skipped=${skippedCount}, next=${nextRunAt?.toISOString() || "none"}`);

  return {
    scheduleId: schedule.id,
    templateName,
    communityId: schedule.communityId,
    createdCount,
    skippedCount,
    status,
    errorMessage,
  };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startSchedulerInterval(intervalMs = 3600000) {
  if (intervalHandle) return;
  console.log(`[Scheduler] Starting interval (every ${intervalMs / 1000}s)`);

  intervalHandle = setInterval(async () => {
    try {
      const reports = await runDueSchedules();
      if (reports.length > 0) {
        console.log(`[Scheduler] Tick completed: ${reports.length} schedule(s) processed`);
      }
    } catch (err) {
      console.error("[Scheduler] Tick error:", err);
    }
  }, intervalMs);
}

export function stopSchedulerInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
