import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import * as storage from "../storage";
import { pool } from "../db";
import { isUniqueViolation, pgErrorOf } from "./errors";

export function registerOrganizationRoutes(app: Express): void {
  // ── Admin: Organization provisioning routes ───────────────────────────────

  app.post("/api/admin/organizations", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, kind, contactName, contactEmail } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const org = await storage.createOrganization({
        name: name.trim(),
        kind: kind ?? "commercial",
        contactName: contactName ?? null,
        contactEmail: contactEmail ?? null,
      });
      res.status(201).json(org);
    } catch (error) {
      console.error("Create organization error:", error);
      res.status(500).json({ error: "Failed to create organization" });
    }
  }));

  app.get("/api/admin/organizations", requireAdmin, route(async (_req: Request, res: Response) => {
    try {
      const orgs = await storage.listOrganizations();
      res.json(orgs);
    } catch (error) {
      console.error("List organizations error:", error);
      res.status(500).json({ error: "Failed to list organizations" });
    }
  }));

  app.get("/api/admin/organizations/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const org = await storage.getOrganizationById(req.params.id as string);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Get organization error:", error);
      res.status(500).json({ error: "Failed to get organization" });
    }
  }));

  app.patch("/api/admin/organizations/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, kind, contactName, contactEmail } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (kind !== undefined) updates.kind = kind;
      if (contactName !== undefined) updates.contactName = contactName;
      if (contactEmail !== undefined) updates.contactEmail = contactEmail;
      const org = await storage.updateOrganization(req.params.id as string, updates as any);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Update organization error:", error);
      res.status(500).json({ error: "Failed to update organization" });
    }
  }));

  app.delete("/api/admin/organizations/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const hasBranches = await storage.orgHasBranches(id);
      if (hasBranches) {
        return void res.status(409).json({ error: "Organization still has branches — reassign or delete them first" });
      }
      const deleted = await storage.deleteOrganization(id);
      if (!deleted) return void res.status(404).json({ error: "Organization not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Delete organization error:", error);
      res.status(500).json({ error: "Failed to delete organization" });
    }
  }));

  app.get("/api/admin/organizations/:id/portfolio", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const portfolio = await storage.getPortfolioForOrg(req.params.id as string);
      if (!portfolio) return void res.status(404).json({ error: "Organization not found" });
      res.json(portfolio);
    } catch (error) {
      console.error("Admin portfolio error:", error);
      res.status(500).json({ error: "Failed to fetch portfolio" });
    }
  }));

  // ── Admin: Branch (community) routes ──────────────────────────────────────

  app.get("/api/admin/organizations/:id/branches", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const branches = await storage.listBranchesByOrg(req.params.id as string);
      res.json(branches);
    } catch (error) {
      console.error("List branches error:", error);
      res.status(500).json({ error: "Failed to list branches" });
    }
  }));

  app.post("/api/admin/organizations/:id/branches", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, code, address, city, description } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      if (!code || typeof code !== "string" || code.trim().length === 0) {
        return void res.status(400).json({ error: "code is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });

      try {
        const branch = await storage.createBranch({
          organizationId: orgId,
          name: name.trim(),
          code: code.trim(),
          address: address ?? undefined,
          city: city ?? undefined,
          description: description ?? undefined,
        });
        res.status(201).json(branch);
      } catch (err: any) {
        // Catch unique constraint on (organization_id, code)
        if (err?.code === "23505" || err?.message?.includes("duplicate")) {
          return void res.status(409).json({ error: `A branch with code '${code}' already exists in this organization` });
        }
        throw err;
      }
    } catch (error) {
      if ((error as any)?.statusCode === 409) return void res.status(409).json(error);
      console.error("Create branch error:", error);
      res.status(500).json({ error: "Failed to create branch" });
    }
  }));

  app.delete("/api/admin/branches/:communityId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const result = await storage.deleteBranch(req.params.communityId as string);
      if (result.notABranch) return void res.status(403).json({ error: "Not an organization branch" });
      if (result.conflict) return void res.status(409).json({ error: result.conflict });
      if (!result.deleted) return void res.status(404).json({ error: "Branch not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Delete branch error:", error);
      res.status(500).json({ error: "Failed to delete branch" });
    }
  }));

  app.patch("/api/admin/branches/:communityId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      // Guard: only allow editing organization-owned branches, not HOA communities
      const orgId = await storage.getBranchOrgId(req.params.communityId as string);
      if (orgId === undefined) return void res.status(404).json({ error: "Branch not found" });
      if (orgId === null) return void res.status(403).json({ error: "Not an organization branch" });

      const { code, address, city, name, description } = req.body;
      const updates: Record<string, unknown> = {};
      if (code !== undefined) updates.code = code;
      if (address !== undefined) updates.address = address;
      if (city !== undefined) updates.city = city;
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      try {
        const branch = await storage.updateBranch(req.params.communityId as string, updates as any);
        if (!branch) return void res.status(404).json({ error: "Branch not found" });
        res.json(branch);
      } catch (err: any) {
        if (err?.code === "23505" || err?.message?.includes("duplicate")) {
          return void res.status(409).json({ error: `A branch with code '${code}' already exists in this organization` });
        }
        throw err;
      }
    } catch (error) {
      console.error("Update branch error:", error);
      res.status(500).json({ error: "Failed to update branch" });
    }
  }));

  // ── Admin: Branch group routes ────────────────────────────────────────────

  app.get("/api/admin/organizations/:id/groups", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const groups = await storage.listBranchGroupsWithMembers(req.params.id as string);
      res.json(groups);
    } catch (error) {
      console.error("List branch groups error:", error);
      res.status(500).json({ error: "Failed to list branch groups" });
    }
  }));

  app.post("/api/admin/organizations/:id/groups", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, color, sortOrder } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      const group = await storage.createBranchGroup(orgId, {
        name: name.trim(),
        color: color ?? undefined,
        sortOrder: sortOrder ?? 0,
      });
      res.status(201).json(group);
    } catch (error) {
      console.error("Create branch group error:", error);
      res.status(500).json({ error: "Failed to create branch group" });
    }
  }));

  app.patch("/api/admin/groups/:groupId", requireAdmin, route(async (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;
    try {
      const { name, color, sortOrder, setId } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (color !== undefined) updates.color = color;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (setId !== undefined) updates.setId = setId; // a set id, or null to unassign
      const group = await storage.updateBranchGroup(groupId, updates as any);
      if (!group) return void res.status(404).json({ error: "Branch group not found" });
      return void res.json(group);
    } catch (error) {
      // Moving a group into a set fires the propagate trigger on member rows;
      // if any member already belongs to another group of that set, the
      // one-per-set index rejects it. Explain which group and how many
      // locations conflict instead of surfacing a 500.
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx") && req.body?.setId) {
        let conflictMsg = "Some locations in this group already belong to another group in that set. Move them or choose a different set.";
        try {
          const { rows } = await pool.query<{ group_name: string; set_name: string; cnt: string }>(
            `SELECT bg.name AS group_name, s.name AS set_name, COUNT(DISTINCT me.community_id) AS cnt
               FROM branch_group_members me
               JOIN branch_group_members other
                 ON other.community_id = me.community_id AND other.group_id <> me.group_id
               JOIN branch_groups bg ON bg.id = other.group_id AND bg.set_id = $2
               JOIN branch_group_sets s ON s.id = $2
              WHERE me.group_id = $1
              GROUP BY bg.name, s.name
              ORDER BY cnt DESC
              LIMIT 1`,
            [groupId, req.body.setId],
          );
          if (rows[0]) {
            const n = Number(rows[0].cnt);
            conflictMsg = `${n} location${n === 1 ? "" : "s"} in this group already belong${n === 1 ? "s" : ""} to ${rows[0].group_name} in the ${rows[0].set_name} set. Move them or choose a different set.`;
          }
        } catch { /* best-effort lookup only */ }
        return void res.status(409).json({ error: conflictMsg });
      }
      console.error("Update branch group error:", error);
      return void res.status(500).json({ error: "Failed to update branch group" });
    }
  }));

  app.delete("/api/admin/groups/:groupId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteBranchGroup(req.params.groupId as string);
      if (!deleted) return void res.status(404).json({ error: "Branch group not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Delete branch group error:", error);
      return void res.status(500).json({ error: "Failed to delete branch group" });
    }
  }));

  app.put("/api/admin/groups/:groupId/members", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { communityIds } = req.body;
      if (!Array.isArray(communityIds)) {
        return void res.status(400).json({ error: "communityIds must be an array" });
      }
      await storage.setBranchGroupMembers(req.params.groupId as string, communityIds as string[]);
      return void res.json({ ok: true });
    } catch (error) {
      // One-group-per-set violation: move semantics in setBranchGroupMembers
      // should prevent this, but if a case is ever missed the admin gets a
      // real explanation, not a generic 500.
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx")) {
        const pg = pgErrorOf(error);
        // detail looks like: Key (community_id, set_id)=(abc, def) already exists.
        const detailMatch = /\(community_id, set_id\)=\(([^,]+), ([^)]+)\)/.exec(pg?.detail ?? "");
        let conflictMsg = "This location already belongs to another group in the same group set.";
        if (detailMatch) {
          try {
            const { rows } = await pool.query<{ group_name: string }>(
              `SELECT bg.name AS group_name
                 FROM branch_group_members bgm
                 JOIN branch_groups bg ON bg.id = bgm.group_id
                WHERE bgm.community_id = $1 AND bgm.set_id = $2
                LIMIT 1`,
              [detailMatch[1], detailMatch[2]],
            );
            if (rows[0]) conflictMsg = `This location already belongs to "${rows[0].group_name}" in the same group set. A location can only be in one group per set.`;
          } catch { /* best-effort lookup only */ }
        }
        return void res.status(409).json({ error: conflictMsg });
      }
      console.error("Set branch group members error:", error);
      return void res.status(500).json({ error: "Failed to set branch group members" });
    }
  }));

  // ── Admin: Branch group set routes ────────────────────────────────────────

  app.get("/api/admin/organizations/:id/group-sets", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const sets = await storage.getGroupSets(req.params.id as string);
      res.json(sets);
    } catch (error) {
      console.error("List group sets error:", error);
      res.status(500).json({ error: "Failed to list group sets" });
    }
  }));

  app.post("/api/admin/organizations/:id/group-sets", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, sortOrder } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      const set = await storage.createGroupSet(orgId, {
        name: name.trim(),
        sortOrder: sortOrder ?? 0,
      });
      res.status(201).json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Create group set error:", error);
      res.status(500).json({ error: "Failed to create group set" });
    }
  }));

  app.patch("/api/admin/group-sets/:setId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { name, sortOrder } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0) {
          return void res.status(400).json({ error: "name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      const set = await storage.updateGroupSet(req.params.setId as string, updates as any);
      if (!set) return void res.status(404).json({ error: "Group set not found" });
      return void res.json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Update group set error:", error);
      return void res.status(500).json({ error: "Failed to update group set" });
    }
  }));

  app.delete("/api/admin/group-sets/:setId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      // ON DELETE SET NULL nulls branch_groups.set_id; that referential-action
      // UPDATE fires the propagate trigger, which nulls member rows' set_id.
      const deleted = await storage.deleteGroupSet(req.params.setId as string);
      if (!deleted) return void res.status(404).json({ error: "Group set not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Delete group set error:", error);
      return void res.status(500).json({ error: "Failed to delete group set" });
    }
  }));

  // ── Admin: Organization users ─────────────────────────────────────────────

  app.get("/api/admin/organizations/:id/users", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const orgId = req.params.id as string;
      const users = await storage.getClientUsersByOrg(orgId);
      res.json(users);
    } catch (error) {
      console.error("List org users error:", error);
      res.status(500).json({ error: "Failed to list organization users" });
    }
  }));
}
