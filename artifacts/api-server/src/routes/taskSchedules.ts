import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import * as storage from "../storage";
import { insertTaskScheduleSchema } from "@workspace/db";
import { runDueSchedules, computeInitialNextRunAt } from "../scheduler";

export function registerTaskScheduleRoutes(app: Express): void {
  // Task Schedules CRUD
  app.get("/api/task-schedules", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const schedules = await storage.getTaskSchedules(communityId);
      res.json(schedules);
    } catch (error) {
      console.error("Get schedules error:", error);
      res.status(500).json({ error: "Failed to fetch schedules" });
    }
  }));

  app.post("/api/task-schedules", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { communityId, templateId, frequency, daysOfWeek, dayOfMonth, timezone, startDate: startDateStr, endDate: endDateStr, assignToUserId, isEnabled } = parsed.data;

      // Enforce template scope against community type
      const [schedCommunity, schedTemplate] = await Promise.all([
        storage.getCommunityById(communityId),
        storage.getTaskTemplateById(templateId),
      ]);
      if (!schedCommunity) return void res.status(404).json({ error: "Community not found" });
      if (!schedTemplate) return void res.status(404).json({ error: "Template not found" });
      if (schedTemplate.scope !== 'all') {
        const communityType = schedCommunity.organizationId ? 'commercial' : 'hoa';
        if (schedTemplate.scope !== communityType) {
          return void res.status(400).json({
            error: `This template is scoped to ${schedTemplate.scope} clients only and cannot be scheduled for this ${communityType} community.`,
          });
        }
      }

      const startDate = new Date(startDateStr);
      const endDate = endDateStr ? new Date(endDateStr) : null;

      const nextRunAt = computeInitialNextRunAt(
        frequency, daysOfWeek ?? null, dayOfMonth ?? null, startDate, endDate
      );

      const schedule = await storage.createTaskSchedule({
        communityId,
        templateId,
        frequency,
        daysOfWeek: daysOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        timezone,
        startDate,
        endDate,
        nextRunAt,
        assignToUserId: assignToUserId ?? null,
        isEnabled,
        createdBy: req.session.userId!,
      });
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create schedule error:", error);
      res.status(500).json({ error: "Failed to create schedule" });
    }
  }));

  app.patch("/api/task-schedules/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const existing = await storage.getTaskScheduleById(req.params.id as string);
      if (!existing) return void res.status(404).json({ error: "Schedule not found" });

      const parsed = insertTaskScheduleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const updates: any = {};
      if (parsed.data.frequency !== undefined) updates.frequency = parsed.data.frequency;
      if (parsed.data.daysOfWeek !== undefined) updates.daysOfWeek = parsed.data.daysOfWeek ?? null;
      if (parsed.data.dayOfMonth !== undefined) updates.dayOfMonth = parsed.data.dayOfMonth ?? null;
      if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
      if (parsed.data.startDate !== undefined) updates.startDate = new Date(parsed.data.startDate);
      if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
      if (parsed.data.assignToUserId !== undefined) updates.assignToUserId = parsed.data.assignToUserId ?? null;
      if (parsed.data.isEnabled !== undefined) updates.isEnabled = parsed.data.isEnabled;

      const freq = updates.frequency || existing.frequency;
      const dow = updates.daysOfWeek !== undefined ? updates.daysOfWeek : existing.daysOfWeek;
      const dom = updates.dayOfMonth !== undefined ? updates.dayOfMonth : existing.dayOfMonth;
      const sd = updates.startDate || existing.startDate;
      const ed = updates.endDate !== undefined ? updates.endDate : existing.endDate;

      updates.nextRunAt = computeInitialNextRunAt(freq, dow, dom, sd, ed);

      const updated = await storage.updateTaskSchedule(req.params.id as string, updates);
      res.json(updated);
    } catch (error) {
      console.error("Update schedule error:", error);
      res.status(500).json({ error: "Failed to update schedule" });
    }
  }));

  app.delete("/api/task-schedules/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskSchedule(req.params.id as string);
      res.json({ message: "Schedule deleted" });
    } catch (error) {
      console.error("Delete schedule error:", error);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  }));

  app.get("/api/task-schedules/:id/runs", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const runs = await storage.getScheduleRuns(req.params.id as string);
      res.json(runs);
    } catch (error) {
      console.error("Get schedule runs error:", error);
      res.status(500).json({ error: "Failed to fetch schedule runs" });
    }
  }));

  app.post("/api/task-schedules/run-now", requireAdmin, route(async (_req: Request, res: Response) => {
    try {
      const reports = await runDueSchedules();
      res.json({
        processed: reports.length,
        reports,
      });
    } catch (error) {
      console.error("Run now error:", error);
      res.status(500).json({ error: "Failed to run schedules" });
    }
  }));
}
