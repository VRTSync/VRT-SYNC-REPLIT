import type { Express, Request, Response } from "express";
import { ZodError } from "zod/v4";
import { scheduleDateSchema, replaceContractScheduleSchema, completeContractServiceSchema, contractCompletionPhotoSchema } from "@workspace/db";
import { requireAuth } from "../auth";
import * as policy from "../policy";
import * as storage from "../storage";
import { todayInDenver } from "../scheduleDates";
import { ObjectForbiddenError, ObjectNotFoundError } from "../objectStorage";
import { route } from "./handler";

function scheduleRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return route(async (req, res) => {
    try { await fn(req, res); } catch (error) {
      if (error instanceof storage.ScheduleError) return void res.status(error.status).json({ error: error.message, ...error.extra });
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        const name = issue?.path[0] === "services" && typeof issue.path[1] === "number"
          ? req.body?.services?.[issue.path[1]]?.name : undefined;
        return void res.status(400).json({ error: name ? `${name}: ${issue.message}` : "Invalid input", details: error.flatten() });
      }
      if (error instanceof ObjectForbiddenError) return void res.status(403).json({ error: "You do not own this file" });
      if (process.env.STRICT_UPLOAD_URL_VALIDATION !== "false" && error instanceof ObjectNotFoundError) {
        return void res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
      }
      throw error;
    }
  });
}

export function registerScheduleRoutes(app: Express): void {
  app.get("/api/communities/:communityId/schedule", requireAuth, scheduleRoute(async (req, res) => {
    const on = scheduleDateSchema.parse(req.query.on ?? todayInDenver());
    res.json(await storage.getCommunitySchedule(req.params.communityId as string, on, policy.actorFrom(req)));
  }));
  app.get("/api/contracts/:id/schedule", requireAuth, scheduleRoute(async (req, res) => {
    res.json(await storage.getContractSchedule(req.params.id as string, policy.actorFrom(req)));
  }));
  app.put("/api/contracts/:id/schedule", requireAuth, scheduleRoute(async (req, res) => {
    const actor = policy.actorFrom(req);
    policy.assertCan(policy.canEditContractSchedule(actor), "Access denied");
    const body = replaceContractScheduleSchema.parse(req.body);
    res.json(await storage.replaceContractSchedule(req.params.id as string, body, actor));
  }));
  app.post("/api/schedule/windows/:windowId/complete", requireAuth, scheduleRoute(async (req, res) => {
    res.json(await storage.completeWindow(req.params.windowId as string, completeContractServiceSchema.parse(req.body), policy.actorFrom(req)));
  }));
  app.post("/api/schedule/completions/:completionId/undo", requireAuth, scheduleRoute(async (req, res) => {
    res.json(await storage.undoCompletion(req.params.completionId as string, policy.actorFrom(req)));
  }));
  app.post("/api/schedule/completions/:completionId/photos", requireAuth, scheduleRoute(async (req, res) => {
    const result = await storage.addCompletionPhoto(req.params.completionId as string, contractCompletionPhotoSchema.parse(req.body), policy.actorFrom(req));
    res.status(result.created ? 201 : 200).json(result.photo);
  }));
  app.get("/api/schedule/completions/:completionId/photos", requireAuth, scheduleRoute(async (req, res) => {
    res.json(await storage.listCompletionPhotos(req.params.completionId as string, policy.actorFrom(req)));
  }));
}
