import type { Express, Request, Response } from "express";
import { z } from "zod";
import { normalizeCompanyName } from "@workspace/db";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";
import { companyUniqueConflict } from "./userRules";

export function registerCompanyRoutes(app: Express): void {
  app.get("/api/contractors", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      const communityId = req.query.communityId as string | undefined;
      const access = await policy.contractorListAccess(actor, communityId);
      if (access === "denied") return void res.status(403).json({ error: "Access denied" });
      if (access === "not_member") return void res.status(403).json({ error: "You are not a member of this community" });
      if (access === "community_required") return void res.status(400).json({ error: "communityId is required" });
      let contractors: Awaited<ReturnType<typeof storage.getAllContractors>>;
      if (access === "ok_community") {
        contractors = await storage.getContractorsForCommunity(communityId!);
      } else {
        contractors = await storage.getAllContractors();
      }
      res.json(contractors.map(({ password: _, ...c }) => c));
    } catch (error) {
      console.error("Get contractors error:", error);
      res.status(500).json({ error: "Failed to fetch contractors" });
    }
  }));

  // Company management is intentionally staff-only, independent of community access.
  app.get("/api/admin/companies", requireAdmin, route(async (req: Request, res: Response) => {
    const parsed = z.object({
      search: z.string().optional(), kind: z.enum(["contractor", "management_company"]).optional(),
      includeInactive: z.enum(["true", "false"]).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await storage.listCompanies({ ...parsed.data, includeInactive: parsed.data.includeInactive === "true" }));
    } catch (error) {
      console.error("List companies error:", error);
      res.status(500).json({ error: "Failed to fetch companies" });
    }
  }));

  app.post("/api/admin/companies", requireAdmin, route(async (req: Request, res: Response) => {
    const parsed = z.object({
      name: z.string().trim().min(1), kind: z.enum(["contractor", "management_company"]), confirmNew: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success || !normalizeCompanyName(parsed.data.name)) return void res.status(400).json({ error: "Name and kind are required" });
    const { name, kind, confirmNew } = parsed.data;
    try {
      const matches = await storage.findSimilarCompanies(name, kind);
      // The normalized-name constraint is global, including other kinds and
      // inactive records; neither may be silently duplicated.
      const exact = (await storage.listCompanies({ search: name, includeInactive: true }))
        .filter(c => normalizeCompanyName(c.name) === normalizeCompanyName(name));
      if (exact.length) {
        return void res.status(409).json({ error: "A company with this name already exists", matches: exact });
      }
      if (matches.length && confirmNew !== true) return void res.status(409).json({ error: "Similar companies exist", matches });
      res.status(201).json(await storage.createCompany(name, kind));
    } catch (error) {
      if (companyUniqueConflict(error)) {
        const matches = (await storage.listCompanies({ search: name, includeInactive: true }))
          .filter(c => normalizeCompanyName(c.name) === normalizeCompanyName(name));
        return void res.status(409).json({ error: "A company with this name already exists", matches });
      }
      console.error("Create company error:", error);
      res.status(500).json({ error: "Failed to create company" });
    }
  }));

  app.patch("/api/admin/companies/:id", requireAdmin, route(async (req: Request, res: Response) => {
    const parsed = z.object({ name: z.string().trim().min(1).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data).length || (parsed.data.name !== undefined && !normalizeCompanyName(parsed.data.name))) {
      return void res.status(400).json({ error: "Invalid company update" });
    }
    try {
      const company = await storage.getCompanyById(req.params.id as string);
      if (!company) return void res.status(404).json({ error: "Company not found" });
      if (parsed.data.name !== undefined) {
        const exactMatches = (await storage.listCompanies({ search: parsed.data.name, includeInactive: true }))
          .filter(c => c.id !== company.id && normalizeCompanyName(c.name) === normalizeCompanyName(parsed.data.name!));
        if (exactMatches.length) return void res.status(409).json({ error: "A company with this name already exists", matches: exactMatches });
        const matches = (await storage.findSimilarCompanies(parsed.data.name, company.kind)).filter(c => c.id !== company.id);
        if (matches.length) {
          const exact = matches.some(c => c.normalizedName === normalizeCompanyName(parsed.data.name!));
          return void res.status(409).json({ error: exact ? "A company with this name already exists" : "Similar companies exist", matches });
        }
      }
      res.json(await storage.updateCompany(company.id, parsed.data));
    } catch (error) {
      if (companyUniqueConflict(error)) return void res.status(409).json({ error: "A company with this name already exists", matches: [] });
      console.error("Update company error:", error);
      res.status(500).json({ error: "Failed to update company" });
    }
  }));
}
