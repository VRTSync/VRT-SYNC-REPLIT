import type { Express, Request, Response } from "express";
import { insertServiceScheduleSchema, updateServiceScheduleSchema, logServiceVisitSchema } from "@workspace/db";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerServiceScheduleRoutes(app: Express): void {
  app.get("/api/communities/:communityId/service-schedules", requireAuth, route(async (req: Request, res: Response) => {
    try {
      if (!(await policy.canViewServiceSchedules(policy.actorFromUser(req.currentUser!), req.params.communityId as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const schedules = await storage.getServiceSchedulesByCommunity(req.params.communityId as string);
      res.json(schedules);
    } catch (error) {
      console.error("Get service schedules error:", error);
      res.status(500).json({ error: "Failed to get service schedules" });
    }
  }));

  app.post("/api/communities/:communityId/service-schedules", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertServiceScheduleSchema.safeParse({
        ...req.body,
        communityId: req.params.communityId,
      });
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.createServiceSchedule(parsed.data);
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create service schedule error:", error);
      res.status(500).json({ error: "Failed to create service schedule" });
    }
  }));

  app.patch("/api/service-schedules/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = updateServiceScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.updateServiceSchedule(req.params.id as string, parsed.data);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      console.error("Update service schedule error:", error);
      res.status(500).json({ error: "Failed to update service schedule" });
    }
  }));

  app.delete("/api/service-schedules/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteServiceSchedule(req.params.id as string);
      if (!deleted) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete service schedule error:", error);
      res.status(500).json({ error: "Failed to delete service schedule" });
    }
  }));

  app.get("/api/service-schedules/:scheduleId/visits", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const schedule = await storage.getServiceScheduleById(req.params.scheduleId as string);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      if (!(await policy.canViewServiceSchedules(policy.actorFromUser(req.currentUser!), schedule.communityId))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisits(req.params.scheduleId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  }));

  app.get("/api/communities/:communityId/service-visits", requireAuth, route(async (req: Request, res: Response) => {
    try {
      if (!(await policy.canViewServiceSchedules(policy.actorFromUser(req.currentUser!), req.params.communityId as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisitsByCommunity(req.params.communityId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get community service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  }));

  app.post("/api/service-schedules/:scheduleId/log", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const parsed = logServiceVisitSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.getServiceScheduleById(req.params.scheduleId as string);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      const user = req.currentUser!;
      if (!(await policy.canLogServiceVisit(policy.actorFromUser(user), schedule.communityId))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const visit = await storage.upsertServiceVisit({
        scheduleId: schedule.id,
        communityId: schedule.communityId,
        serviceDate: parsed.data.serviceDate,
        completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date(),
        completedBy: user.id,
        employeeSignOffName: parsed.data.employeeSignOffName,
        notes: parsed.data.notes ?? null,
      });
      res.status(201).json(visit);
    } catch (error) {
      console.error("Log service visit error:", error);
      res.status(500).json({ error: "Failed to log service visit" });
    }
  }));
}
