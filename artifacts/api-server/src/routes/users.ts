import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { userRoleEnum } from "@workspace/db";
import { requireAuth, requireAdmin, isClientRole, isContractorSide } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";
import { checkHoaLimits, companySelectionError, targetHasHoaRole } from "./userRules";

export function registerUserRoutes(app: Express): void {
  app.get("/api/users", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      const communityId = req.query.communityId as string | undefined;
      const access = await policy.userListAccess(actor, communityId);

      /* Super Admin: return all users */
      if (access === "all") {
        let allUsers = await storage.getAllUsers();
        const roleFilter = req.query.role as string | undefined;
        if (roleFilter) {
          allUsers = allUsers.filter(u => u.role === roleFilter);
        }
        return void res.json(allUsers.map(({ password: _, ...u }) => u));
      }
      if (access === "community_required") return void res.status(400).json({ error: "communityId is required for this role" });
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (access === "other_community") return void res.status(403).json({ error: "Access denied" });
      if (access === "community") {
        const communityUsers = await storage.getUsersByCommunity(communityId!);
        return void res.json(communityUsers.map(({ password: _, ...u }) => u));
      }
      return void res.status(403).json({ error: "Not authorized" });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }));

  app.put("/api/users/:id/role", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { role, hoaCommunityId, companyId } = req.body;
      const validRoles = userRoleEnum.enumValues;
      if (!validRoles.includes(role as (typeof validRoles)[number])) {
        return void res.status(400).json({ error: "Invalid role" });
      }
      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot change your own role" });
      }
      if (targetHasHoaRole(role) && !hoaCommunityId) {
        return void res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (targetHasHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role, req.params.id as string);
        if (limitCheck) {
          return void res.status(400).json({ error: limitCheck });
        }
      }
      const targetUser = await storage.getUserById(req.params.id as string);
      const effectiveCompanyId = companyId === undefined && isContractorSide(targetUser?.role || "") && isContractorSide(role)
        ? targetUser?.companyId : companyId;
      const companyError = companyId === undefined && role !== "contractor_manager" ? null : await companySelectionError(role, effectiveCompanyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const updated = await storage.updateUserRole(req.params.id as string, role, targetHasHoaRole(role) ? hoaCommunityId : null, companyId);
      if (!updated) {
        return void res.status(404).json({ error: "User not found" });
      }
      await storage.revokeUserSessions(req.params.id as string);
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  }));

  app.post("/api/admin/users", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { username, password, displayName, role, hoaCommunityId, organizationId, companyId } = req.body;
      if (!username || !password) {
        return void res.status(400).json({ error: "username and password are required" });
      }
      const validRoles = userRoleEnum.enumValues;
      if (role && !validRoles.includes(role as (typeof validRoles)[number])) {
        return void res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      }
      if (targetHasHoaRole(role) && !hoaCommunityId) {
        return void res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (targetHasHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role);
        if (limitCheck) {
          return void res.status(400).json({ error: limitCheck });
        }
      }
      if (isClientRole(role) && !organizationId) {
        return void res.status(400).json({ error: "client_admin role requires an organizationId" });
      }
      if (!isClientRole(role) && organizationId) {
        return void res.status(400).json({ error: "organizationId is only valid for client_admin role" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return void res.status(409).json({ error: "Username already taken" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const companyError = await companySelectionError(role || "contractor", companyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const user = await storage.createAdminUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: role || "contractor",
        hoaCommunityId: targetHasHoaRole(role) ? hoaCommunityId : undefined,
        organizationId: isClientRole(role) ? organizationId : undefined,
        companyId: companyId ?? null,
      });
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  }));

  app.patch("/api/admin/users/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { displayName, newPassword, companyId } = req.body ?? {};
      const updates: { displayName?: string; password?: string; companyId?: string | null } = {};
      if (displayName !== undefined) {
        if (typeof displayName !== "string" || displayName.trim().length === 0) {
          return void res.status(400).json({ error: "Display name cannot be empty" });
        }
        updates.displayName = displayName.trim();
      }
      if (newPassword !== undefined) {
        if (typeof newPassword !== "string" || newPassword.length < 6) {
          return void res.status(400).json({ error: "New password must be at least 6 characters" });
        }
        updates.password = await bcrypt.hash(newPassword, 10);
      }
      if (companyId !== undefined) updates.companyId = companyId;
      if (Object.keys(updates).length === 0) {
        return void res.status(400).json({ error: "No changes provided" });
      }
      const existing = await storage.getUserById(userId);
      if (!existing) {
        return void res.status(404).json({ error: "User not found" });
      }
      const companyError = companyId === undefined ? null : await companySelectionError(existing.role, companyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const updated = await storage.updateUserProfile(userId, updates);
      if (!updated) {
        return void res.status(500).json({ error: "Failed to update user" });
      }
      if (updates.password) await storage.revokeUserSessions(userId);
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Admin update user error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  }));

  app.delete("/api/admin/users/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      if (userId === req.session.userId) {
        return void res.status(400).json({ error: "Cannot delete yourself" });
      }
      const user = await storage.getUserById(userId);
      if (!user) {
        return void res.status(404).json({ error: "User not found" });
      }
      await storage.deleteUser(userId);
      await storage.revokeUserSessions(userId);
      await storage.removeAllPushTokens(userId);
      res.json({ message: "User deleted" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  }));

  app.get("/api/users/:id/communities", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const comms = await storage.getUserCommunitiesList(req.params.id as string);
      res.json(comms);
    } catch (error) {
      console.error("Get user communities error:", error);
      res.status(500).json({ error: "Failed to fetch user communities" });
    }
  }));

  /* ── Status toggle (admin, PM, HOA Admin) ───────────────────────────────── */
  app.put("/api/users/:id/status", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      if (!policy.canManageUserStatus(actor)) {
        return void res.status(403).json({ error: "Not authorized" });
      }
      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });
      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot change your own status" });
      }
      const access = await policy.portalTargetAccess(actor, targetUser, "status");
      if (access === "no_community" || access === "not_in_community") {
        return void res.status(403).json({ error: "User is not in your community" });
      }
      if (access === "hoa_member_only") {
        return void res.status(403).json({ error: "HOA Admins can only manage HOA Members" });
      }
      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return void res.status(400).json({ error: "isActive (boolean) is required" });
      }
      const updated = await storage.updateUserStatus(req.params.id as string, isActive);
      if (!updated) return void res.status(404).json({ error: "User not found" });
      if (!isActive) {
        await storage.revokeUserSessions(req.params.id as string);
        await storage.removeAllPushTokens(req.params.id as string);
      }
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update user status error:", error);
      res.status(500).json({ error: "Failed to update user status" });
    }
  }));

  /* ── Community-scoped user list (PM, HOA Admin) ─────────────────────────── */
  app.get("/api/portal/users", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      const access = await policy.portalUserListAccess(actor, communityId);
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (access === "other_community") return void res.status(403).json({ error: "Access denied" });
      if (access === "not_authorized") return void res.status(403).json({ error: "Not authorized" });
      const communityUsers = await storage.getUsersByCommunity(communityId);
      res.json(communityUsers.map(({ password: _, ...u }) => u));
    } catch (error) {
      console.error("Get portal users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }));

  /* ── Create user in community (PM, HOA Admin) ───────────────────────────── */
  app.post("/api/portal/users", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      if (!policy.canManagePortalUsers(actor)) {
        return void res.status(403).json({ error: "Not authorized" });
      }
      const { username, password, displayName, role, communityId } = req.body;
      if (!username || !password || !communityId) {
        return void res.status(400).json({ error: "username, password, and communityId are required" });
      }
      if (password.length < 6) {
        return void res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const access = await policy.portalCreateAccess(actor, role, communityId);
      if (access === "hoa_role_only") return void res.status(403).json({ error: "HOA Admins can only create HOA Member users" });
      if (access === "other_community") return void res.status(403).json({ error: "Access denied" });
      if (access === "pm_role_only") return void res.status(403).json({ error: "Property Managers can only create HOA Admin or HOA Member users" });
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      const existing = await storage.getUserByUsername(username);
      if (existing) return void res.status(409).json({ error: "Username already taken" });
      const validPortalRoles = ["hoa_admin", "hoa_member"] as const;
      type PortalRole = typeof validPortalRoles[number];
      const typedRole: PortalRole = validPortalRoles.includes(role) ? (role as PortalRole) : "hoa_member";
      const hashedPassword = await bcrypt.hash(password, 10);
      const created = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: typedRole,
        hoaCommunityId: communityId,
      });
      await storage.addCommunityMembers(communityId, [created.id]);
      const { password: _, ...safeUser } = created;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create portal user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  }));

  /* ── Edit community user role/status (PM, HOA Admin) ───────────────────── */
  app.put("/api/portal/users/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      if (!policy.canManagePortalUsers(actor)) {
        return void res.status(403).json({ error: "Not authorized" });
      }
      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });
      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot edit yourself" });
      }
      const access = await policy.portalTargetAccess(actor, targetUser);
      if (access === "not_in_community") return void res.status(403).json({ error: "User is not in your community" });
      if (access === "hoa_member_only") return void res.status(403).json({ error: "HOA Admins can only edit HOA Members" });
      if (access === "no_community") return void res.status(403).json({ error: "User has no community assignment" });
      const { role, isActive } = req.body;
      let updated = targetUser;
      if (role !== undefined) {
        const assign = policy.portalRoleAssignAccess(actor, role);
        if (assign === "hoa_role_only") return void res.status(403).json({ error: "HOA Admins can only assign HOA Member role" });
        if (assign === "pm_role_only") return void res.status(403).json({ error: "Property Managers can only assign HOA Admin or HOA Member roles" });
        const r = await storage.updateUserRole(req.params.id as string, role, targetUser.hoaCommunityId);
        if (r) {
          updated = r;
          await storage.revokeUserSessions(req.params.id as string);
        }
      }
      if (typeof isActive === "boolean") {
        const r = await storage.updateUserStatus(req.params.id as string, isActive);
        if (r) {
          updated = r;
          if (!isActive) {
            await storage.revokeUserSessions(req.params.id as string);
            await storage.removeAllPushTokens(req.params.id as string);
          }
        }
      }
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Edit portal user error:", error);
      res.status(500).json({ error: "Failed to edit user" });
    }
  }));

  /* ── Remove user from community (PM, HOA Admin) — unlinks, does not delete ─ */
  app.delete("/api/portal/users/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });
      const actor = policy.actorFromUser(user);
      if (!policy.canManagePortalUsers(actor)) {
        return void res.status(403).json({ error: "Not authorized" });
      }
      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });
      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot remove yourself" });
      }
      const access = await policy.portalTargetAccess(actor, targetUser);
      if (access === "not_in_community") return void res.status(403).json({ error: "User is not in your community" });
      if (access === "hoa_member_only") return void res.status(403).json({ error: "HOA Admins can only remove HOA Members" });
      if (access === "no_community") return void res.status(403).json({ error: "User has no community" });
      /* Unlink from community (remove hoaCommunityId and community_members row), do NOT delete account */
      await storage.removeCommunityMember(targetUser.hoaCommunityId!, req.params.id as string);
      await storage.updateUserRole(req.params.id as string, targetUser.role, null);
      await storage.revokeUserSessions(req.params.id as string);
      res.json({ message: "User removed from community" });
    } catch (error) {
      console.error("Remove portal user error:", error);
      res.status(500).json({ error: "Failed to remove user from community" });
    }
  }));
}
