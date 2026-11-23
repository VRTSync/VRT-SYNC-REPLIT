import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerDashboardRoutes(app: Express): void {
  app.get("/api/dashboard", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      const actor = policy.actorFromUser(user);
      if (!await policy.dashboardAccess(actor, communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      const data = await storage.getDashboardData(user.id, communityId, policy.isAdminView(actor));
      res.json(storage.toTaskResponse(data, user));
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  }));

  app.get("/api/dashboard/role", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });

      const access = await policy.roleDashboardCommunity(policy.actorFromUser(user), req.query.communityId as string | undefined);
      if (access === "hoa_unassigned") {
        return void res.status(403).json({ error: "HOA user is not assigned to a community" });
      }
      if (access === "community_required") {
        return void res.status(400).json({ error: "communityId is required" });
      }
      if (access === "not_member") {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      const communityId = access.communityId;

      const viewModel = await storage.getDashboardDataForRole(user.role, user.id, communityId);
      res.json(storage.toTaskResponse(viewModel, user));
    } catch (error) {
      console.error("Dashboard role error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  }));
}
