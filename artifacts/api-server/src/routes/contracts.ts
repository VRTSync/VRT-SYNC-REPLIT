import type { Express, Request, Response } from "express";
import { insertContractSchema, updateContractSchema } from "@workspace/db";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerContractRoutes(app: Express): void {
  app.get("/api/contracts", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canReadContracts(actor)) {
        return void res.status(403).json({ error: "Access denied" });
      }
      const communityId = req.query.communityId as string | undefined;
      const contractorUserId = req.query.contractorUserId as string | undefined;
      const access = await policy.contractCommunityAccess(actor, communityId);
      if (access === "community_required") return void res.status(400).json({ error: "communityId is required" });
      if (access === "not_member") return void res.status(403).json({ error: "Access denied" });

      let rows = await storage.getContracts(communityId || undefined, contractorUserId || undefined);

      const statusFilter = req.query.status as string | undefined;
      if (statusFilter) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        rows = rows.filter(r => {
          if (!r.isActive) return statusFilter === 'expired';
          const start = new Date(r.startDate + 'T00:00:00');
          const end = new Date(r.endDate + 'T00:00:00');
          if (today < start) return statusFilter === 'upcoming';
          if (today > end) return statusFilter === 'expired';
          return statusFilter === 'active';
        });
      }

      res.json(rows);
    } catch (error) {
      console.error("Get contracts error:", error);
      res.status(500).json({ error: "Failed to fetch contracts" });
    }
  }));

  app.get("/api/contracts/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canReadContracts(actor)) {
        return void res.status(403).json({ error: "Access denied" });
      }
      const contract = await storage.getContractById((req.params.id as string));
      if (!contract) return void res.status(404).json({ error: "Contract not found" });

      const access = await policy.contractCommunityAccess(actor, contract.communityId);
      if (access === "not_member") return void res.status(403).json({ error: "Access denied" });

      res.json(contract);
    } catch (error) {
      console.error("Get contract error:", error);
      res.status(500).json({ error: "Failed to fetch contract" });
    }
  }));

  app.post("/api/contracts", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertContractSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      if (parsed.data.startDate && parsed.data.endDate && parsed.data.endDate < parsed.data.startDate) {
        return void res.status(400).json({ error: "End date must be on or after start date" });
      }

      const contractorUser = parsed.data.contractorUserId ? await storage.getUserById(parsed.data.contractorUserId) : null;
      if (parsed.data.contractorUserId && (!contractorUser || !policy.canHoldContract(contractorUser))) {
        return void res.status(400).json({ error: "Selected user is not a contractor" });
      }

      const contract = await storage.createContract(parsed.data);
      res.status(201).json(contract);
    } catch (error) {
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      console.error("Create contract error:", error);
      res.status(500).json({ error: "Failed to create contract" });
    }
  }));

  app.put("/api/contracts/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContractById((req.params.id as string));
      if (!existing) return void res.status(404).json({ error: "Contract not found" });
      const parsed = updateContractSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const startDate = parsed.data.startDate || existing.startDate;
      const endDate = parsed.data.endDate || existing.endDate;
      if (endDate < startDate) {
        return void res.status(400).json({ error: "End date must be on or after start date" });
      }

      if (parsed.data.contractorUserId) {
        const contractorUser = await storage.getUserById(parsed.data.contractorUserId);
        if (!contractorUser || !policy.canHoldContract(contractorUser)) {
          return void res.status(400).json({ error: "Selected user is not a contractor" });
        }
      }

      const updated = await storage.updateContract((req.params.id as string), parsed.data);
      res.json(updated);
    } catch (error) {
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      console.error("Update contract error:", error);
      res.status(500).json({ error: "Failed to update contract" });
    }
  }));

  app.delete("/api/contracts/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContractById((req.params.id as string));
      if (!existing) return void res.status(404).json({ error: "Contract not found" });
      await storage.deleteContract((req.params.id as string));
      res.status(204).send();
    } catch (error) {
      console.error("Delete contract error:", error);
      res.status(500).json({ error: "Failed to delete contract" });
    }
  }));
}
