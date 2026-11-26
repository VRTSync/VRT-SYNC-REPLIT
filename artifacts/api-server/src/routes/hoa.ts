import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { createHoaRequestSchema } from "@workspace/db";
import { notifyHoaRequestSubmitted } from "../pushNotifications";
import { route } from "./handler";

export function registerHoaRoutes(app: Express): void {
  app.get("/api/hoa/dashboard", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return void res.status(401).json({ error: "User not found" });
      }
      const actor = policy.actorFromUser(user);
      const communityId = policy.hoaPortalCommunity(actor);
      if (!communityId) {
        return void res.status(403).json({ error: "This endpoint is only available to HOA users" });
      }
      const data = await storage.getHoaDashboardData(communityId);
      res.json(data);
    } catch (error) {
      console.error("HOA dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch HOA dashboard data" });
    }
  }));

  app.get("/api/hoa/requests", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return void res.status(401).json({ error: "User not found" });
      }
      const actor = policy.actorFromUser(user);
      const communityId = policy.hoaPortalCommunity(actor);
      if (!communityId) {
        return void res.status(403).json({ error: "This endpoint is only available to HOA users" });
      }
      const requests = await storage.getHoaRequests(communityId);
      res.json(requests);
    } catch (error) {
      console.error("Get HOA requests error:", error);
      res.status(500).json({ error: "Failed to fetch HOA requests" });
    }
  }));

  app.get("/api/hoa/requests/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) {
        return void res.status(404).json({ error: "Request not found" });
      }
      if (task.origin !== "HOA") {
        return void res.status(404).json({ error: "Request not found" });
      }

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return void res.status(401).json({ error: "User not found" });
      }

      const actor = policy.actorFromUser(user);
      if (!await policy.canReadHoaRequest(actor, task)) {
        return void res.status(403).json({ error: "Access denied" });
      }

      let pinLocation: { lat: number; lng: number } | null = null;

      const taskLink = await storage.getTaskLink(task.id);
      if (taskLink?.assetId) {
        const asset = await storage.getAssetById(taskLink.assetId);
        if (asset?.latitude != null && asset?.longitude != null) {
          pinLocation = { lat: asset.latitude, lng: asset.longitude };
        }
      }

      if (!pinLocation && task.latitude != null && task.longitude != null) {
        pinLocation = { lat: task.latitude, lng: task.longitude };
      }

      res.json({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        origin: task.origin,
        pinLocation,
        assetId: taskLink?.assetId ?? task.assetId ?? null,
        category: task.category,
        createdAt: task.createdAt,
      });
    } catch (error) {
      console.error("Get HOA request error:", error);
      res.status(500).json({ error: "Failed to fetch HOA request" });
    }
  }));

  app.post("/api/hoa/requests", requireAuth, route(async (req: Request, res: Response) => {
    const REQUEST_TIMEOUT_MS = 30000;
    const startTime = Date.now();
    let timeoutFired = false;
    const requestTimer = setTimeout(() => {
      timeoutFired = true;
      console.error("[HOA Request] Handler exceeded 30s, forcing 504");
      if (!res.headersSent) {
        res.status(504).json({ error: "Request timed out. Please try again." });
      }
    }, REQUEST_TIMEOUT_MS);

    try {
      const userId = req.session.userId!;
      console.log(`[HOA Request] Start: userId=${userId}, calling getUserById`);

      const user = await storage.getUserById(userId);
      console.log(`[HOA Request] getUserById done (${Date.now() - startTime}ms), role=${user?.role}, hoaCommunityId=${user?.hoaCommunityId}`);
      if (!user || !policy.canCreateHoaRequest(policy.actorFromUser(user))) {
        return void res.status(403).json({ error: "Only HOA Admins can create requests" });
      }

      const actor = policy.actorFromUser(user);
      const communityId = policy.hoaRequestCommunity(actor);
      if (!communityId) {
        console.error(`[HOA Request] No communityId: user.hoaCommunityId=${user.hoaCommunityId}`);
        return void res.status(400).json({ error: "No HOA community associated with this user" });
      }

      const parsed = createHoaRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        console.error("[HOA Request] Validation failed:", parsed.error.flatten());
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const { title, description, priority, category, assetId, assignedTo, pinLat, pinLng } = parsed.data;
      console.log(`[HOA Request] Validated body:`, JSON.stringify({ title, description, priority, category, assetId, assignedTo, pinLat, pinLng }));

      let latitude: number | undefined;
      let longitude: number | undefined;
      let resolvedAssetId: string | undefined;

      if (assetId) {
        console.log(`[HOA Request] Calling getAssetById: assetId=${assetId}`);
        const asset = await storage.getAssetById(assetId);
        console.log(`[HOA Request] getAssetById done (${Date.now() - startTime}ms), found=${!!asset}`);
        if (!asset) {
          return void res.status(404).json({ error: "Asset not found" });
        }
        if (asset.communityId !== communityId) {
          return void res.status(403).json({ error: "Asset does not belong to your community" });
        }
        latitude = asset.latitude ?? undefined;
        longitude = asset.longitude ?? undefined;
        resolvedAssetId = asset.id;
      } else {
        if (pinLat != null && pinLng != null) {
          latitude = pinLat;
          longitude = pinLng;
        } else if ((pinLat != null) !== (pinLng != null)) {
          return void res.status(400).json({ error: "Both pinLat and pinLng must be provided together, or omit both" });
        }
      }

      let validatedAssignedTo: string | undefined;
      if (assignedTo) {
        console.log(`[HOA Request] Calling getCommunityMembers: communityId=${communityId}`);
        const members = await storage.getCommunityMembers(communityId);
        console.log(`[HOA Request] getCommunityMembers done (${Date.now() - startTime}ms), count=${members.length}`);
        await storage.validateTaskAssignee(communityId, assignedTo);
        validatedAssignedTo = assignedTo;
      }

      const mappedPriority = priority === "Urgent" ? "urgent" as const : "medium" as const;

      if (timeoutFired) return;

      console.log(`[HOA Request] Calling createTask: communityId=${communityId}, createdBy=${userId}`);
      const task = await storage.createHoaTaskWithLink({
        communityId,
        title,
        description,
        priority: mappedPriority,
        status: "submitted",
        origin: "HOA",
        category: category ?? undefined,
        assignedTo: validatedAssignedTo,
        latitude,
        longitude,
        createdBy: userId,
      }, resolvedAssetId);
      console.log(`[HOA Request] createTask done (${Date.now() - startTime}ms), taskId=${task.id}`);

      if (timeoutFired) return;

      if (timeoutFired) return;

      notifyHoaRequestSubmitted(task).catch(err => console.error("notifyHoaRequestSubmitted error:", err));

      if (!res.headersSent) {
        console.log(`[HOA Request] Success in ${Date.now() - startTime}ms, taskId=${task.id}`);
        res.status(201).json(task);
      }
    } catch (error: any) {
      if (error instanceof storage.WorkValidationError && !timeoutFired && !res.headersSent) {
        return void res.status(400).json({ error: error.message });
      }
      console.error("[HOA Request] Error:", error);
      if (!timeoutFired && !res.headersSent) {
        res.status(500).json({ error: "Failed to create HOA request" });
      }
    } finally {
      clearTimeout(requestTimer);
    }
  }));
}
