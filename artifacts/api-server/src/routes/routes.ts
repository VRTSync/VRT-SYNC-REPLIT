import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireAuth, requireAdmin, requireAdminOrMapCreator, registerAuthRoutes, enforceHoaScoping, isHoaRole, isMapCreatorRole } from "../auth";
import { ObjectStorageService, ObjectNotFoundError, parseUploadURL } from "../objectStorage";
import { ObjectPermission, buildCommunityAclPolicy } from "../objectAcl";
import * as storage from "../storage";
import { notifyTaskAssigned, sendDueReminders, notifyTaskCompleted, notifyHoaRequestSubmitted, notifyRequestAcknowledged } from "../pushNotifications";
import { syncAssetsFromLayer, syncIrrigationAssets, getMissingRequiredKeys, ASSET_TYPE_TEMPLATES, previewSyncFromLayer, getUnlinkedFeatures, getGeoJsonCollisions, resolveAssetType, extractFeatureId, extractLabel, resolveGeometry, computeAreaSqFt } from "../assetSync";
import { parseIrrigationKml } from "../kmlIrrigationParser";
import { validateLayerGeoJSON } from "../layerValidation";
import { validateLayerKeys, CANONICAL_LAYER_HIERARCHY } from "../layerKeys";
import { convertKmlToGeojson, normalizeGeojsonFeatureIds } from "../kmlConverter";
import { getDefaultLayerColor, CONTROLLER_COLORS } from "../shared/layerColors";
import {
  insertCommunitySchema, insertTaskSchema, completeTaskSchema, registerPushTokenSchema,
  insertAssetSchema, updateAssetSchema, upsertAssetPropertiesSchema, setTaskLinkSchema,
  insertMapLayerSchema, updateMapLayerSchema, insertOfflinePackSchema,
  insertTaskTemplateSchema, generateFromTemplateSchema, insertTaskScheduleSchema,
  insertServiceScheduleSchema, updateServiceScheduleSchema, logServiceVisitSchema,
  insertAssetNoteSchema, createHoaRequestSchema,
  insertDriveFolderSchema, updateDriveFolderSchema, insertDriveFileSchema, updateDriveFileSchema,
  insertInvoiceSchema, updateInvoiceSchema,
  insertContractSchema, updateContractSchema,
  insertContactSchema, updateContactSchema,
  userRoleEnum,
} from "@workspace/db";
import { runDueSchedules, computeInitialNextRunAt } from "../scheduler";
import { runExportGeneration } from "../exportGenerator";
import { parseFile, generatePreview, commitImport } from "../contractImporter";
import { exportJobs as exportsTable, plannerRecords, xeriscapePackets } from "@workspace/db";
import { db, pool } from "../db";
import { eq, and, desc, ne } from "drizzle-orm";

export const PUSH_TOKEN_RATE_LIMIT_MS = 86_400_000; // 24 hours
export const pushTokenLastReg = new Map<string, { ts: number; token: string }>();

/** Convert a 0-based index to Excel-column-style letter key: 0→A, 25→Z, 26→AA, 27→AB … */
function nextControllerKey(n: number): string {
  let result = "";
  let i = n;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function checkHoaLimits(communityId: string, role: string, excludeUserId?: string): Promise<string | null> {
  const count = await storage.getHoaUserCountByCommunity(communityId, role, excludeUserId);
  if (role === 'hoa_admin' && count >= 1) {
    return 'This community already has an HOA Admin (limit: 1)';
  }
  if (role === 'hoa_member' && count >= 4) {
    return 'This community already has 4 HOA Members (limit: 4)';
  }
  return null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerAuthRoutes(app);

  app.use("/api", enforceHoaScoping);

  app.get("/public-objects/{*filePath}", async (req: Request, res: Response) => {
    const filePath = (req.params as any).filePath as string;
    const objectStorageService = new ObjectStorageService();
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/objects/{*objectPath}", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId;
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", requireAuth, async (_req: Request, res: Response) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Upload URL error:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.post("/api/objects/confirm", requireAuth, async (req: Request, res: Response) => {
    const { uploadURL, communityId } = req.body;
    if (!uploadURL) {
      return res.status(400).json({ error: "uploadURL is required" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      const aclPolicy = communityId
        ? buildCommunityAclPolicy(req.session.userId!, communityId as string)
        : { owner: req.session.userId!, visibility: "private" as const };
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, aclPolicy);
      res.json({ objectPath });
    } catch (error) {
      console.error("Confirm upload error:", error);
      res.status(500).json({ error: "Failed to confirm upload" });
    }
  });

  app.get("/api/communities", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (user?.role === "admin" || user?.role === "map_creator") {
        const allCommunities = await storage.getCommunities();
        return res.json(allCommunities);
      }
      if (isHoaRole(user?.role || '') && user?.hoaCommunityId) {
        const community = await storage.getCommunityById(user.hoaCommunityId);
        return res.json(community ? [community] : []);
      }
      const memberships = await storage.getUserCommunities(req.session.userId!);
      res.json(memberships.map((m) => m.community));
    } catch (error) {
      console.error("Get communities error:", error);
      res.status(500).json({ error: "Failed to fetch communities" });
    }
  });

  app.post("/api/communities", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const parsed = insertCommunitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const community = await storage.createCommunity({
        name: parsed.data.name,
        description: parsed.data.description ?? undefined,
      });
      const currentUser = (req as any).currentUser;
      if (currentUser && isMapCreatorRole(currentUser.role)) {
        await storage.addCommunityMember(community.id, currentUser.id);
      }
      res.status(201).json(community);
    } catch (error) {
      req.log.error({ error }, "Create community error");
      res.status(500).json({ error: "Failed to create community" });
    }
  });

  app.patch("/api/communities/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      const id = req.params.id as string;
      const community = await storage.updateCommunity(id, { name, description });
      if (!community) {
        return res.status(404).json({ error: "Community not found" });
      }
      res.json(community);
    } catch (error) {
      console.error("Update community error:", error);
      res.status(500).json({ error: "Failed to update community" });
    }
  });

  app.get("/api/communities/:id/bounds", requireAuth, async (req: Request, res: Response) => {
    try {
      const bounds = await storage.getCommunityBounds(req.params.id as string);
      res.json(bounds);
    } catch (error) {
      console.error("Get community bounds error:", error);
      res.status(500).json({ error: "Failed to compute community bounds" });
    }
  });

  app.get("/api/communities/:id/members", requireAuth, async (req: Request, res: Response) => {
    try {
      const members = await storage.getCommunityMembers(req.params.id as string);
      res.json(members.map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.user.displayName,
        username: m.user.username,
        role: m.user.role,
        joinedAt: m.joinedAt,
      })));
    } catch (error) {
      console.error("Get members error:", error);
      res.status(500).json({ error: "Failed to fetch members" });
    }
  });

  app.post("/api/communities/:id/members", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, userIds } = req.body;
      const ids: string[] = userIds || (userId ? [userId] : []);
      if (ids.length === 0) {
        return res.status(400).json({ error: "userId or userIds[] is required" });
      }
      const result = await storage.addCommunityMembers(req.params.id as string, ids);
      res.status(201).json(result);
    } catch (error) {
      console.error("Add member error:", error);
      res.status(500).json({ error: "Failed to add member" });
    }
  });

  app.delete("/api/communities/:id/members/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.removeCommunityMember(req.params.id as string, req.params.userId as string);
      res.json({ message: "Member removed" });
    } catch (error) {
      console.error("Remove member error:", error);
      res.status(500).json({ error: "Failed to remove member" });
    }
  });

  app.get("/api/communities/:id/controllers", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const communityId = req.params.id as string;
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }

      const controllerAssets = await storage.getAssetsByCommunitySorted(communityId, "controller");
      const zoneAssets = await storage.getAssetsByCommunitySorted(communityId, "zone");

      const controllerIds = controllerAssets.map(a => a.id);
      const zoneIds = zoneAssets.map(a => a.id);
      const allIds = [...controllerIds, ...zoneIds];

      let allProps: { assetId: string; key: string; value: string }[] = [];
      if (allIds.length > 0) {
        allProps = await storage.getAssetPropertiesBulk(allIds);
      }

      const propsMap = new Map<string, Record<string, string>>();
      for (const p of allProps) {
        if (!propsMap.has(p.assetId)) propsMap.set(p.assetId, {});
        propsMap.get(p.assetId)![p.key] = p.value;
      }

      const zonesByController = new Map<string, typeof zoneAssets>();
      for (const zone of zoneAssets) {
        if (zone.isArchived) continue;
        const zProps = propsMap.get(zone.id) || {};
        const ctrlRef = zProps.controllerFeatureRef;
        if (ctrlRef) {
          if (!zonesByController.has(ctrlRef)) zonesByController.set(ctrlRef, []);
          zonesByController.get(ctrlRef)!.push(zone);
        }
      }

      const result = controllerAssets
        .filter(c => !c.isArchived)
        .map(c => {
          const cProps = propsMap.get(c.id) || {};
          const zones = zonesByController.get(c.featureRef || "") || [];
          return {
            id: c.id,
            label: c.label,
            featureRef: c.featureRef,
            controllerKey: cProps.controllerKey || "",
            controllerColor: cProps.controllerColor || "#999999",
            latitude: c.latitude,
            longitude: c.longitude,
            zoneCount: zones.length,
            zones: zones.map(z => {
              const zProps = propsMap.get(z.id) || {};
              return {
                id: z.id,
                label: z.label,
                featureRef: z.featureRef,
                zoneNumber: zProps.zoneNumber ? parseInt(zProps.zoneNumber) : null,
                zoneType: zProps.zoneType || null,
                zoneLabelShort: zProps.zoneLabelShort || null,
                zoneColor: zProps.zoneColor || null,
                latitude: z.latitude,
                longitude: z.longitude,
              };
            }).sort((a, b) => (a.zoneNumber || 999) - (b.zoneNumber || 999)),
          };
        })
        .sort((a, b) => a.controllerKey.localeCompare(b.controllerKey));

      res.json(result);
    } catch (error) {
      console.error("Get controllers error:", error);
      res.status(500).json({ error: "Failed to fetch controllers" });
    }
  });

  app.get("/api/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId is required" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }
      const data = await storage.getDashboardData(user.id, communityId, user.role === "admin");
      res.json(data);
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  app.get("/api/dashboard/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });

      let communityId: string | undefined;

      if (isHoaRole(user.role)) {
        if (!user.hoaCommunityId) {
          return res.status(403).json({ error: "HOA user is not assigned to a community" });
        }
        communityId = user.hoaCommunityId;
      } else {
        communityId = req.query.communityId as string | undefined;
      }

      if (!communityId) {
        return res.status(400).json({ error: "communityId is required" });
      }

      if (user.role !== "admin" && !isHoaRole(user.role)) {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const viewModel = await storage.getDashboardDataForRole(user.role, user.id, communityId);
      res.json(viewModel);
    } catch (error) {
      console.error("Dashboard role error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  app.get("/api/tasks/page-data", requireAuth, async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      let communityId: string | null = (req.query.communityId as string | undefined) ?? null;

      if (isHoaRole(user.role) && user.hoaCommunityId) {
        communityId = user.hoaCommunityId;
      } else if (!communityId && user.role === "contractor") {
        const memberships = await storage.getUserCommunities(user.id);
        communityId = memberships.length > 0 ? memberships[0].community.id : null;
      }

      if (communityId && user.role !== "admin" && !isHoaRole(user.role)) {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const filters: storage.TaskPageFilters = {
        status: req.query.status as string | undefined,
        priority: req.query.priority as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const mode = req.query.mode as string | undefined;

      const viewModel = await storage.getTaskPageDataForRole(user.role, user.id, communityId, filters, mode);

      const CONTRACTOR_ONLY_KEYS = new Set(["activeTasks", "overdueTasks", "pendingAcknowledgment", "upcomingScheduled"]);
      const HOA_ADMIN_ONLY_KEYS = new Set(["requestsByStatus", "contractorAssignments", "completedCommunityWork", "upcomingCommunityWork"]);
      const HOA_MEMBER_ONLY_KEYS = new Set(["communityUpcoming", "myRequests"]);
      const vmRole = viewModel.role;
      const vmKeys = new Set(Object.keys(viewModel));
      if (vmRole === "contractor") {
        const leaked = [...HOA_ADMIN_ONLY_KEYS, ...HOA_MEMBER_ONLY_KEYS].filter(k => vmKeys.has(k));
        if (leaked.length > 0) console.error(`[page-data ISOLATION VIOLATION] contractor response leaked keys: ${leaked.join(", ")}`);
      } else if (vmRole === "hoa_member") {
        const leaked = [...CONTRACTOR_ONLY_KEYS, ...HOA_ADMIN_ONLY_KEYS].filter(k => vmKeys.has(k));
        if (leaked.length > 0) console.error(`[page-data ISOLATION VIOLATION] hoa_member response leaked keys: ${leaked.join(", ")}`);
      }

      const collectionSizes: Record<string, number> = {};
      const vm = viewModel as Record<string, unknown>;
      for (const [key, val] of Object.entries(vm)) {
        if (Array.isArray(val)) collectionSizes[key] = val.length;
        else if (val !== null && typeof val === "object") {
          for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
            if (Array.isArray(subVal)) collectionSizes[`${key}.${subKey}`] = subVal.length;
          }
        }
      }
      console.log(`[GET /api/tasks/page-data] role=${user.role} user=${user.id} community=${communityId} collections=${JSON.stringify(collectionSizes)} (${Date.now() - t0}ms)`);

      res.json(viewModel);
    } catch (error) {
      console.error("Get task page data error:", error);
      res.status(500).json({ error: "Failed to fetch task page data" });
    }
  });

  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      let communityId = req.query.communityId as string | undefined;

      if (isHoaRole(user.role) && user.hoaCommunityId) {
        communityId = user.hoaCommunityId;
        const rawTasks = await storage.getTasksByCommunity(communityId);
        const tasks = await storage.enrichTasksWithAssigneeName(rawTasks);
        console.log(`[GET /api/tasks] hoa user=${user.id} community=${communityId} count=${tasks.length} (${Date.now() - t0}ms)`);
        return res.json(tasks);
      }

      if (user.role === "admin" || user.role === "property_manager") {
        if (communityId) {
          if (user.role === "property_manager") {
            const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
            if (!isMember) {
              return res.status(403).json({ error: "You are not a member of this community" });
            }
          }
          const rawTasks = await storage.getTasksByCommunity(communityId);
          const allTasks = await storage.enrichTasksWithAssigneeName(rawTasks);
          console.log(`[GET /api/tasks] role=${user.role} community=${communityId} count=${allTasks.length} (${Date.now() - t0}ms)`);
          return res.json(allTasks);
        }
        if (user.role === "admin") {
          const rawTasks = await storage.getAllTasks();
          const allTasks = await storage.enrichTasksWithAssigneeName(rawTasks);
          console.log(`[GET /api/tasks] admin all-tasks count=${allTasks.length} (${Date.now() - t0}ms)`);
          return res.json(allTasks);
        }
        return res.json([]);
      }

      if (!communityId) {
        const memberships = await storage.getUserCommunities(user.id);
        if (memberships.length > 0) {
          communityId = memberships[0].community.id;
        }
      }

      if (communityId) {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const rawUserTasks = await storage.getTasksForUser(req.session.userId!, communityId);
      const userTasks = await storage.enrichTasksWithAssigneeName(rawUserTasks);
      console.log(`[GET /api/tasks] user=${user.id} community=${communityId ?? "none"} count=${userTasks.length} (${Date.now() - t0}ms)`);
      res.json(userTasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const { allowed, task } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!task) {
        console.log(`[GET /api/tasks/:id] task=${req.params.id} not found (${Date.now() - t0}ms)`);
        return res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        console.log(`[GET /api/tasks/:id] task=${req.params.id} access denied for user=${req.session.userId} (${Date.now() - t0}ms)`);
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      console.log(`[GET /api/tasks/:id] task=${req.params.id} served (${Date.now() - t0}ms)`);
      res.json(task);
    } catch (error) {
      console.error("Get task error:", error);
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  app.get("/api/tasks/:id/detail", requireAuth, async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const taskId = req.params.id as string;
      const { allowed, task } = await storage.canUserAccessTask(req.session.userId!, taskId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!allowed) return res.status(403).json({ error: "You do not have access to this task" });

      const [rawCompletions, taskAttachments, taskLink] = await Promise.all([
        storage.getTaskCompletions(taskId),
        storage.getAttachmentsByTaskId(taskId),
        storage.getTaskLink(taskId),
      ]);

      const completions = await Promise.all(
        rawCompletions.map(async (c) => ({
          ...c,
          attachments: await storage.getAttachmentsByCompletion(c.id),
        })),
      );

      let assignedToName: string | null = null;
      if (task.assignedTo) {
        const assignee = await storage.getUserById(task.assignedTo);
        assignedToName = assignee?.displayName ?? null;
      }

      console.log(`[GET /api/tasks/:id/detail] task=${taskId} served (${Date.now() - t0}ms)`);
      res.json({ task: { ...task, assignedToName }, completions, taskAttachments, taskLink: taskLink ?? null });
    } catch (error) {
      console.error("Get task detail bundle error:", error);
      res.status(500).json({ error: "Failed to fetch task detail" });
    }
  });

  app.post("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "User not found" });
      if (actor.role !== "admin" && actor.role !== "property_manager") {
        return res.status(403).json({ error: "Only admins and property managers can create tasks" });
      }
      const parsed = insertTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      if (actor.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(actor.id, parsed.data.communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }
      const task = await storage.createTask({
        communityId: parsed.data.communityId,
        title: parsed.data.title,
        description: parsed.data.description ?? undefined,
        priority: parsed.data.priority ?? undefined,
        latitude: parsed.data.latitude ?? undefined,
        longitude: parsed.data.longitude ?? undefined,
        address: parsed.data.address ?? undefined,
        assignedTo: parsed.data.assignedTo ?? undefined,
        createdBy: req.session.userId!,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate as any) : undefined,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate as any) : undefined,
        ticketType: parsed.data.ticketType ?? undefined,
        windowStart: parsed.data.windowStart ? String(parsed.data.windowStart) : undefined,
        windowEnd: parsed.data.windowEnd ? String(parsed.data.windowEnd) : undefined,
      });

      if (task.assignedTo) {
        const community = await storage.getCommunityById(task.communityId);
        notifyTaskAssigned(task.id, task.title, community?.name || 'Unknown', task.assignedTo).catch(() => {});
      }

      res.status(201).json(task);
    } catch (error) {
      console.error("Create task error:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.put("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed, task } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      const { version, ...data } = req.body;
      if (typeof version !== "number") {
        return res.status(400).json({ error: "version is required" });
      }

      if (task!.origin === "HOA") {
        const updatingUser = await storage.getUserById(req.session.userId!);
        if (updatingUser?.role === "contractor" && data.priority !== undefined) {
          return res.status(403).json({ error: "Contractors cannot change priority on HOA requests" });
        }
        if (data.status === "acknowledged") {
          if (updatingUser?.role !== "contractor" && updatingUser?.role !== "admin") {
            return res.status(403).json({ error: "Only contractors and admins can acknowledge HOA requests" });
          }
        }
        if (data.status) {
          const currentStatus = task!.status;
          const newStatus = data.status;
          const validTransitions: Record<string, string[]> = {
            submitted: ["acknowledged"],
            acknowledged: ["in_progress"],
          };
          const allowedStatuses = validTransitions[currentStatus];
          if (!allowedStatuses || !allowedStatuses.includes(newStatus)) {
            if (newStatus === "completed") {
              return res.status(400).json({ error: "HOA requests must be completed via the completion form, not status update" });
            }
            return res.status(400).json({ error: `Invalid HOA request status transition: ${currentStatus} → ${newStatus}` });
          }
        }
      }

      if (data.startDate) {
        data.startDate = new Date(data.startDate);
      }
      if (data.dueDate) {
        data.dueDate = new Date(data.dueDate);
      }
      if (data.windowStart) {
        data.windowStart = String(data.windowStart);
      }
      if (data.windowEnd) {
        data.windowEnd = String(data.windowEnd);
      }
      const previousAssignee = task!.assignedTo;
      const updated = await storage.updateTask(req.params.id as string, version, data);
      if (!updated) {
        const latest = await storage.getTaskById(req.params.id as string);
        return res.status(409).json({
          error: "Conflict: task was modified by another user. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: latest,
        });
      }

      if (updated.assignedTo && updated.assignedTo !== previousAssignee) {
        const community = await storage.getCommunityById(updated.communityId);
        notifyTaskAssigned(updated.id, updated.title, community?.name || 'Unknown', updated.assignedTo).catch(() => {});
      }

      if (updated.origin === "HOA" && data.status === "acknowledged") {
        notifyRequestAcknowledged(updated.id).catch(() => {});
      }

      res.json(updated);
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      await storage.deleteTask(req.params.id as string);
      res.json({ message: "Task deleted" });
    } catch (error) {
      console.error("Delete task error:", error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.post("/api/tasks/:id/complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed, task: existingTask } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!existingTask) {
        return res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }

      if (existingTask.origin === "HOA" && existingTask.status !== "acknowledged" && existingTask.status !== "in_progress") {
        return res.status(400).json({ error: "HOA requests must be acknowledged or in progress before completing" });
      }

      const parsed = completeTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      if (existingTask.version !== parsed.data.version) {
        return res.status(409).json({
          error: "Conflict: task was modified by another user. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: existingTask,
        });
      }

      const completingUser = await storage.getUserById(req.session.userId!);
      if (completingUser?.role !== 'admin' && existingTask.windowStart && existingTask.windowEnd) {
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
        const today = new Date(todayStr + 'T00:00:00');
        const wsVal = typeof existingTask.windowStart === 'object' ? (existingTask.windowStart as Date).toISOString().split('T')[0] : String(existingTask.windowStart).split('T')[0];
        const weVal = typeof existingTask.windowEnd === 'object' ? (existingTask.windowEnd as Date).toISOString().split('T')[0] : String(existingTask.windowEnd).split('T')[0];
        const startDate = new Date(wsVal + 'T00:00:00');
        const endDate = new Date(weVal + 'T00:00:00');
        if (today < startDate || today > endDate) {
          return res.status(400).json({
            error: "This task can only be completed within its execution window.",
            code: "OUTSIDE_EXECUTION_WINDOW",
            windowStart: existingTask.windowStart,
            windowEnd: existingTask.windowEnd,
          });
        }
      }

      const updated = await storage.updateTask(req.params.id as string, parsed.data.version, {
        status: "completed",
      });
      if (!updated) {
        const latest = await storage.getTaskById(req.params.id as string);
        return res.status(409).json({
          error: "Conflict: task was modified by another user.",
          code: "VERSION_CONFLICT",
          latestTask: latest,
        });
      }

      const completion = await storage.createTaskCompletion({
        taskId: req.params.id as string,
        completedBy: req.session.userId!,
        notes: parsed.data.notes,
        employeeSignOffName: parsed.data.employeeSignOffName,
        timeSpentMinutes: parsed.data.timeSpentMinutes,
        materialsUsed: parsed.data.materialsUsed,
        followUpNeeded: parsed.data.followUpNeeded,
      });

      notifyTaskCompleted(updated).catch(err => console.error("notifyTaskCompleted error:", err));

      res.json({ task: updated, completion });
    } catch (error) {
      console.error("Complete task error:", error);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.post("/api/tasks/:id/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, taskId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      const { taskCompletionId, uploadURL, idempotencyKey } = req.body;
      if (!uploadURL || !idempotencyKey) {
        return res.status(400).json({ error: "uploadURL and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      if (strictValidation) {
        const parsed = parseUploadURL(uploadURL);
        if (!parsed.valid) {
          return res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
        }
      }

      if (taskCompletionId) {
        const existing = await storage.getAttachmentByIdempotencyKey(taskCompletionId, idempotencyKey);
        if (existing) {
          return res.status(200).json(existing);
        }
      } else {
        const existing = await storage.getAttachmentByTaskIdAndIdempotencyKey(taskId, idempotencyKey);
        if (existing) {
          return res.status(200).json(existing);
        }
      }

      const task = await storage.getTaskById(taskId);
      const objectStorageService = new ObjectStorageService();
      const aclPolicy = task?.communityId
        ? buildCommunityAclPolicy(req.session.userId!, task.communityId)
        : { owner: req.session.userId!, visibility: "private" as const };
      let objectPath: string;
      try {
        objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, aclPolicy);
      } catch (error) {
        if (strictValidation && error instanceof ObjectNotFoundError) {
          return res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
        }
        throw error;
      }

      const attachment = await storage.createAttachment({
        taskCompletionId: taskCompletionId || null,
        taskId: taskCompletionId ? null : taskId,
        fileRef: objectPath,
        url: objectPath,
        uploadedBy: req.session.userId!,
        idempotencyKey,
      });

      res.status(201).json(attachment);
    } catch (error) {
      console.error("Create attachment error:", error);
      res.status(500).json({ error: "Failed to create attachment" });
    }
  });

  app.post("/api/task-completions/:id/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const completionId = req.params.id as string;
      const completion = await storage.getCompletionById(completionId);
      if (!completion) {
        return res.status(404).json({ error: "Completion not found" });
      }
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, completion.taskId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task completion" });
      }
      const { fileRef, url, idempotencyKey } = req.body;
      if (!fileRef || !url || !idempotencyKey) {
        return res.status(400).json({ error: "fileRef, url, and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      let validatedHttpsUrl: string | undefined;
      if (strictValidation) {
        const candidateUrl = url.startsWith("https://") ? url : fileRef.startsWith("https://") ? fileRef : undefined;
        if (candidateUrl) {
          const parsed = parseUploadURL(candidateUrl);
          if (!parsed.valid) {
            return res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
          }
          validatedHttpsUrl = candidateUrl;
        }
      }

      const existing = await storage.getAttachmentByIdempotencyKey(completionId, idempotencyKey);
      if (existing) {
        return res.status(200).json(existing);
      }

      if (strictValidation && validatedHttpsUrl) {
        const objectStorageService = new ObjectStorageService();
        const normalizedPath = objectStorageService.normalizeObjectEntityPath(validatedHttpsUrl);
        if (normalizedPath.startsWith("/objects/")) {
          try {
            await objectStorageService.getObjectEntityFile(normalizedPath);
          } catch (error) {
            if (error instanceof ObjectNotFoundError) {
              return res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
            }
            throw error;
          }
        }
      }

      const task = await storage.getTaskById(completion.taskId);
      if (task?.communityId && fileRef.startsWith("/objects/")) {
        const objectStorageService = new ObjectStorageService();
        await objectStorageService.trySetObjectEntityAclPolicy(
          fileRef,
          buildCommunityAclPolicy(req.session.userId!, task.communityId),
        );
      }

      const attachment = await storage.createAttachment({
        taskCompletionId: completionId,
        fileRef,
        url,
        uploadedBy: req.session.userId!,
        idempotencyKey,
      });

      res.status(201).json(attachment);
    } catch (error) {
      console.error("Create attachment (completion) error:", error);
      res.status(500).json({ error: "Failed to create attachment" });
    }
  });

  app.get("/api/task-completions/:id/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const completionId = req.params.id as string;
      const completion = await storage.getCompletionById(completionId);
      if (!completion) {
        return res.status(404).json({ error: "Completion not found" });
      }
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, completion.taskId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task completion" });
      }
      const atts = await storage.getAttachmentsByCompletion(completionId);
      res.json(atts);
    } catch (error) {
      console.error("List attachments error:", error);
      res.status(500).json({ error: "Failed to fetch attachments" });
    }
  });

  app.get("/api/tasks/:id/completions", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      const completions = await storage.getTaskCompletions(req.params.id as string);
      const completionsWithAttachments = await Promise.all(
        completions.map(async (c) => {
          const atts = await storage.getAttachmentsByCompletion(c.id);
          return { ...c, attachments: atts };
        }),
      );
      res.json(completionsWithAttachments);
    } catch (error) {
      console.error("Get completions error:", error);
      res.status(500).json({ error: "Failed to fetch completions" });
    }
  });

  app.get("/api/tasks/:id/task-attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, taskId);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      const atts = await storage.getAttachmentsByTaskId(taskId);
      res.json(atts);
    } catch (error) {
      console.error("Get task attachments error:", error);
      res.status(500).json({ error: "Failed to fetch task attachments" });
    }
  });

  app.get("/api/admin/summary", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const summary = await storage.getAdminSummary(communityId);
      res.json(summary);
    } catch (error) {
      console.error("Admin summary error:", error);
      res.status(500).json({ error: "Failed to fetch admin summary" });
    }
  });

  app.get("/api/admin/completed-tasks", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) {
        return res.status(400).json({ error: "communityId is required" });
      }
      const completedTasks = await storage.getCompletedTasksWithDetails(communityId);
      res.json(completedTasks);
    } catch (error) {
      console.error("Get completed tasks error:", error);
      res.status(500).json({ error: "Failed to fetch completed tasks" });
    }
  });

  app.get("/api/admin/xeriscape/polygons", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const kmlPath = path.join(process.cwd(), "server/public/admin/data/huntington-trails-xeriscape.kml");
      const kmlText = await fs.readFile(kmlPath, "utf-8");
      const { convertKmlToGeojson } = await import("./kmlConverter");
      const { computeAreaSqFt } = await import("./assetSync");
      const { geojson } = convertKmlToGeojson(kmlText);
      const polygonFeatures = geojson.features.filter((f: any) =>
        f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
      );
      const features = polygonFeatures.map((f: any, idx: number) => {
        const name = f.properties?.name || f.properties?.Name || `Polygon ${idx + 1}`;
        const areaSqft = computeAreaSqFt(f) || 0;
        return {
          type: "Feature",
          id: f.id || String(idx),
          geometry: f.geometry,
          properties: {
            id: f.id || String(idx),
            name,
            area_sqft: areaSqft,
          },
        };
      });
      res.json({ type: "FeatureCollection", features });
    } catch (error) {
      console.error("Xeriscape polygons error:", error);
      res.status(500).json({ error: "Failed to load xeriscape polygons" });
    }
  });

  // ── Xeriscape Planning Records ─────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records", requireAdmin, async (req: Request, res: Response) => {
    try {
      const propertyId = (req.query.propertyId as string) || "huntington-trails";
      const records = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.propertyId, propertyId))
        .orderBy(desc(plannerRecords.updatedAt));
      res.json(records);
    } catch (error) {
      console.error("List planner records error:", error);
      res.status(500).json({ error: "Failed to fetch planner records" });
    }
  });

  app.post("/api/admin/xeriscape/records", requireAdmin, async (req: Request, res: Response) => {
    try {
      const {
        propertyId = "huntington-trails",
        recordName,
        internalNotes,
        assumptionsJson,
        groupsJson,
        totalSqft,
        totalEstimatedCost,
        totalAnnualSavings,
        paybackYears,
      } = req.body;

      if (!recordName || typeof recordName !== "string" || !recordName.trim()) {
        return res.status(400).json({ error: "recordName is required" });
      }

      const [record] = await db
        .insert(plannerRecords)
        .values({
          propertyId,
          recordName: recordName.trim(),
          status: "draft",
          internalNotes: internalNotes || null,
          assumptionsJson: assumptionsJson || {},
          groupsJson: groupsJson || [],
          totalSqft: totalSqft || 0,
          totalEstimatedCost: totalEstimatedCost || 0,
          totalAnnualSavings: totalAnnualSavings || 0,
          paybackYears: paybackYears ?? null,
          createdBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(record);
    } catch (error) {
      console.error("Create planner record error:", error);
      res.status(500).json({ error: "Failed to create planner record" });
    }
  });

  app.put("/api/admin/xeriscape/records/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const {
        recordName,
        internalNotes,
        assumptionsJson,
        groupsJson,
        totalSqft,
        totalEstimatedCost,
        totalAnnualSavings,
        paybackYears,
        status,
      } = req.body;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (recordName !== undefined) updateData.recordName = recordName.trim();
      if (internalNotes !== undefined) updateData.internalNotes = internalNotes || null;
      if (assumptionsJson !== undefined) updateData.assumptionsJson = assumptionsJson;
      if (groupsJson !== undefined) updateData.groupsJson = groupsJson;
      if (totalSqft !== undefined) updateData.totalSqft = totalSqft;
      if (totalEstimatedCost !== undefined) updateData.totalEstimatedCost = totalEstimatedCost;
      if (totalAnnualSavings !== undefined) updateData.totalAnnualSavings = totalAnnualSavings;
      if (paybackYears !== undefined) updateData.paybackYears = paybackYears ?? null;
      if (status !== undefined) updateData.status = status;

      // If marking as selected_for_estimate, clear any previous selection for same property
      if (status === "selected_for_estimate") {
        const rec = existing[0];
        await db
          .update(plannerRecords)
          .set({ status: "reviewed", updatedAt: new Date() })
          .where(
            and(
              eq(plannerRecords.propertyId, rec.propertyId),
              eq(plannerRecords.status, "selected_for_estimate"),
              ne(plannerRecords.id, id)
            )
          );
      }

      const [updated] = await db
        .update(plannerRecords)
        .set(updateData)
        .where(eq(plannerRecords.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update planner record error:", error);
      res.status(500).json({ error: "Failed to update planner record" });
    }
  });

  app.post("/api/admin/xeriscape/records/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const src = existing[0];
      const [copy] = await db
        .insert(plannerRecords)
        .values({
          propertyId: src.propertyId,
          recordName: src.recordName + " (Copy)",
          status: "draft",
          internalNotes: src.internalNotes,
          assumptionsJson: src.assumptionsJson as any,
          groupsJson: src.groupsJson as any,
          totalSqft: src.totalSqft,
          totalEstimatedCost: src.totalEstimatedCost,
          totalAnnualSavings: src.totalAnnualSavings,
          paybackYears: src.paybackYears,
          createdBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(copy);
    } catch (error) {
      console.error("Duplicate planner record error:", error);
      res.status(500).json({ error: "Failed to duplicate planner record" });
    }
  });

  app.delete("/api/admin/xeriscape/records/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      if (existing[0].status !== "draft") {
        return res.status(400).json({ error: "Only draft records can be permanently deleted" });
      }

      await db.delete(plannerRecords).where(eq(plannerRecords.id, id));
      res.json({ message: "Record deleted" });
    } catch (error) {
      console.error("Delete planner record error:", error);
      res.status(500).json({ error: "Failed to delete planner record" });
    }
  });

  // ── Xeriscape Community Polygons ────────────────────────────────────────────
  app.get("/api/admin/xeriscape/community/:communityId/polygons", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId } = req.params;
      const { eq, and } = await import("drizzle-orm");
      const { assets: assetsTable, assetProperties: assetPropertiesTable } = await import("@workspace/db");
      const { db } = await import("./db");

      const bluegrassAssets = await db
        .select()
        .from(assetsTable)
        .where(
          and(
            eq(assetsTable.communityId, communityId),
            eq(assetsTable.assetType, "bluegrass_area"),
            eq(assetsTable.isArchived, false),
          )
        );

      if (bluegrassAssets.length === 0) {
        return res.json({ type: "FeatureCollection", features: [] });
      }

      const assetIds = bluegrassAssets.map((a: any) => a.id);
      const { inArray } = await import("drizzle-orm");
      const allProps = await db
        .select()
        .from(assetPropertiesTable)
        .where(inArray(assetPropertiesTable.assetId, assetIds));

      const propsByAssetId: Record<string, Record<string, string>> = {};
      for (const prop of allProps) {
        if (!propsByAssetId[prop.assetId]) propsByAssetId[prop.assetId] = {};
        propsByAssetId[prop.assetId][prop.key] = prop.value;
      }

      const { db: dbForLayers } = await import("./db");
      const { mapLayers: mapLayersTable } = await import("@workspace/db");

      const layerGeojsonMap: Record<string, any> = {};
      const layerIds = [...new Set(bluegrassAssets.map((a: any) => a.mapLayerId).filter(Boolean))];
      if (layerIds.length > 0) {
        const layers = await dbForLayers
          .select()
          .from(mapLayersTable)
          .where(inArray(mapLayersTable.id, layerIds as string[]));
        for (const layer of layers) {
          if (layer.geojsonData) {
            try {
              const parsed = JSON.parse(layer.geojsonData);
              const featureMap: Record<string, any> = {};
              const feats = parsed.features || (parsed.type === "Feature" ? [parsed] : []);
              for (const f of feats) {
                const fid = f.id != null && f.id !== "" ? String(f.id) : (f.properties?.featureId || f.properties?.id || null);
                if (fid) featureMap[fid] = f;
              }
              layerGeojsonMap[layer.id] = featureMap;
            } catch {}
          }
        }
      }

      const features: any[] = [];
      for (const asset of bluegrassAssets) {
        const props = propsByAssetId[asset.id] || {};
        const sqFt = props.sqFt ? parseFloat(props.sqFt) : 0;

        let geometry: any = null;
        if (asset.mapLayerId && asset.featureRef && layerGeojsonMap[asset.mapLayerId]) {
          const feat = layerGeojsonMap[asset.mapLayerId][asset.featureRef];
          if (feat?.geometry) geometry = feat.geometry;
        }

        if (!geometry && asset.latitude != null && asset.longitude != null) {
          geometry = { type: "Point", coordinates: [asset.longitude, asset.latitude] };
        }

        if (!geometry) continue;

        features.push({
          type: "Feature",
          id: asset.id,
          geometry,
          properties: {
            id: asset.id,
            name: asset.label,
            area_sqft: sqFt,
            featureRef: asset.featureRef,
          },
        });
      }

      res.json({ type: "FeatureCollection", features });
    } catch (error) {
      console.error("Xeriscape community polygons error:", error);
      res.status(500).json({ error: "Failed to load community xeriscape polygons" });
    }
  });

  // ── Xeriscape Packet CRUD ───────────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId } = req.params;
      const packets = await db
        .select()
        .from(xeriscapePackets)
        .where(eq(xeriscapePackets.plannerRecordId, recordId))
        .orderBy(desc(xeriscapePackets.generatedAt));
      res.json(packets);
    } catch (error) {
      console.error("List packets error:", error);
      res.status(500).json({ error: "Failed to fetch packets" });
    }
  });

  app.post("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId } = req.params;
      const { packetTitle, packetSummaryText, narrativeIntro, narrativeRecommendation, narrativeNextSteps } = req.body;

      if (!packetTitle || typeof packetTitle !== "string" || !packetTitle.trim()) {
        return res.status(400).json({ error: "packetTitle is required" });
      }

      // Verify the planning record exists and is in a reviewable state
      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, recordId))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Planning record not found" });
      }

      const record = existing[0];
      if (record.status !== "reviewed" && record.status !== "selected_for_estimate") {
        return res.status(400).json({ error: "Packet can only be created for reviewed or selected_for_estimate records" });
      }

      // Supersede any existing active packets for this record
      await db
        .update(xeriscapePackets)
        .set({ packetStatus: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(xeriscapePackets.plannerRecordId, recordId),
            eq(xeriscapePackets.packetStatus, "active_proposal_support")
          )
        );

      const [packet] = await db
        .insert(xeriscapePackets)
        .values({
          plannerRecordId: recordId,
          packetTitle: packetTitle.trim(),
          packetSummaryText: packetSummaryText || null,
          narrativeIntro: narrativeIntro || null,
          narrativeRecommendation: narrativeRecommendation || null,
          narrativeNextSteps: narrativeNextSteps || null,
          packetStatus: "active_proposal_support",
          generatedBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(packet);
    } catch (error) {
      console.error("Create packet error:", error);
      res.status(500).json({ error: "Failed to create packet" });
    }
  });

  app.put("/api/admin/xeriscape/records/:recordId/packets/:packetId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId, packetId } = req.params;
      const { packetTitle, packetSummaryText, narrativeIntro, narrativeRecommendation, narrativeNextSteps, packetStatus } = req.body;

      const existing = await db
        .select()
        .from(xeriscapePackets)
        .where(and(eq(xeriscapePackets.id, packetId), eq(xeriscapePackets.plannerRecordId, recordId)))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "Packet not found" });
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (packetTitle !== undefined) updateData.packetTitle = packetTitle.trim();
      if (packetSummaryText !== undefined) updateData.packetSummaryText = packetSummaryText || null;
      if (narrativeIntro !== undefined) updateData.narrativeIntro = narrativeIntro || null;
      if (narrativeRecommendation !== undefined) updateData.narrativeRecommendation = narrativeRecommendation || null;
      if (narrativeNextSteps !== undefined) updateData.narrativeNextSteps = narrativeNextSteps || null;
      if (packetStatus !== undefined) updateData.packetStatus = packetStatus;

      const [updated] = await db
        .update(xeriscapePackets)
        .set(updateData)
        .where(eq(xeriscapePackets.id, packetId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update packet error:", error);
      res.status(500).json({ error: "Failed to update packet" });
    }
  });

  app.get("/api/contractors", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "User not found" });
      if (actor.role !== "admin" && actor.role !== "property_manager") {
        return res.status(403).json({ error: "Access denied" });
      }
      const communityId = req.query.communityId as string | undefined;
      let contractors: Awaited<ReturnType<typeof storage.getAllContractors>>;
      if (communityId) {
        if (actor.role === "property_manager") {
          const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
          if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
        }
        contractors = await storage.getContractorsForCommunity(communityId);
      } else {
        if (actor.role !== "admin") {
          return res.status(400).json({ error: "communityId is required" });
        }
        contractors = await storage.getAllContractors();
      }
      res.json(contractors.map(({ password: _, ...c }) => c));
    } catch (error) {
      console.error("Get contractors error:", error);
      res.status(500).json({ error: "Failed to fetch contractors" });
    }
  });

  app.get("/api/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      /* Super Admin: return all users */
      if (actor.role === "admin") {
        let allUsers = await storage.getAllUsers();
        const roleFilter = req.query.role as string | undefined;
        if (roleFilter) {
          allUsers = allUsers.filter(u => u.role === roleFilter);
        }
        return res.json(allUsers.map(({ password: _, ...u }) => u));
      }

      /* PM and HOA Admin: community-scoped */
      if (actor.role === "property_manager" || actor.role === "hoa_admin") {
        const communityId = req.query.communityId as string | undefined;
        if (!communityId) {
          return res.status(400).json({ error: "communityId is required for this role" });
        }
        if (actor.role === "property_manager") {
          const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
          if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
        } else if (actor.role === "hoa_admin") {
          if (actor.hoaCommunityId !== communityId) {
            return res.status(403).json({ error: "Access denied" });
          }
        }
        const communityUsers = await storage.getUsersByCommunity(communityId);
        return res.json(communityUsers.map(({ password: _, ...u }) => u));
      }

      return res.status(403).json({ error: "Not authorized" });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.put("/api/users/:id/role", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, hoaCommunityId } = req.body;
      const validRoles = userRoleEnum.enumValues;
      if (!validRoles.includes(role as (typeof validRoles)[number])) {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }
      if (isHoaRole(role) && !hoaCommunityId) {
        return res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (isHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role, req.params.id as string);
        if (limitCheck) {
          return res.status(400).json({ error: limitCheck });
        }
      }
      const updated = await storage.updateUserRole(req.params.id as string, role, isHoaRole(role) ? hoaCommunityId : null);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, password, displayName, role, hoaCommunityId } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "username and password are required" });
      }
      const validRoles = userRoleEnum.enumValues;
      if (role && !validRoles.includes(role as (typeof validRoles)[number])) {
        return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      }
      if (isHoaRole(role) && !hoaCommunityId) {
        return res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (isHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role);
        if (limitCheck) {
          return res.status(400).json({ error: limitCheck });
        }
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ error: "Username already taken" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: role || "contractor",
        hoaCommunityId: isHoaRole(role) ? hoaCommunityId : undefined,
      });
      if (isHoaRole(role) && hoaCommunityId) {
        await storage.addCommunityMembers(hoaCommunityId, [user.id]);
      }
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { displayName, newPassword } = req.body ?? {};

      const updates: { displayName?: string; password?: string } = {};

      if (displayName !== undefined) {
        if (typeof displayName !== "string" || displayName.trim().length === 0) {
          return res.status(400).json({ error: "Display name cannot be empty" });
        }
        updates.displayName = displayName.trim();
      }

      if (newPassword !== undefined) {
        if (typeof newPassword !== "string" || newPassword.length < 6) {
          return res.status(400).json({ error: "New password must be at least 6 characters" });
        }
        updates.password = await bcrypt.hash(newPassword, 10);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No changes provided" });
      }

      const existing = await storage.getUserById(userId);
      if (!existing) {
        return res.status(404).json({ error: "User not found" });
      }

      const updated = await storage.updateUserProfile(userId, updates);
      if (!updated) {
        return res.status(500).json({ error: "Failed to update user" });
      }
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Admin update user error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      if (userId === req.session.userId) {
        return res.status(400).json({ error: "Cannot delete yourself" });
      }
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      await storage.deleteUser(userId);
      res.json({ message: "User deleted" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.get("/api/users/:id/communities", requireAdmin, async (req: Request, res: Response) => {
    try {
      const comms = await storage.getUserCommunitiesList(req.params.id as string);
      res.json(comms);
    } catch (error) {
      console.error("Get user communities error:", error);
      res.status(500).json({ error: "Failed to fetch user communities" });
    }
  });

  /* ── Status toggle (admin, PM, HOA Admin) ───────────────────────────────── */
  app.put("/api/users/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["admin", "property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot change your own status" });
      }

      /* Scope check for PM and HOA Admin */
      if (actor.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId || '');
        if (!targetUser.hoaCommunityId || !isMember) {
          return res.status(403).json({ error: "User is not in your community" });
        }
      } else if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return res.status(403).json({ error: "HOA Admins can only manage HOA Members" });
        }
      }

      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ error: "isActive (boolean) is required" });
      }

      const updated = await storage.updateUserStatus(req.params.id as string, isActive);
      if (!updated) return res.status(404).json({ error: "User not found" });
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update user status error:", error);
      res.status(500).json({ error: "Failed to update user status" });
    }
  });

  /* ── Community-scoped user list (PM, HOA Admin) ─────────────────────────── */
  app.get("/api/portal/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId is required" });

      if (actor.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      } else if (actor.role === "hoa_admin") {
        if (actor.hoaCommunityId !== communityId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        return res.status(403).json({ error: "Not authorized" });
      }

      const communityUsers = await storage.getUsersByCommunity(communityId);
      res.json(communityUsers.map(({ password: _, ...u }) => u));
    } catch (error) {
      console.error("Get portal users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  /* ── Create user in community (PM, HOA Admin) ───────────────────────────── */
  app.post("/api/portal/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { username, password, displayName, role, communityId } = req.body;
      if (!username || !password || !communityId) {
        return res.status(400).json({ error: "username, password, and communityId are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      /* Role restrictions */
      if (actor.role === "hoa_admin") {
        if (role !== "hoa_member") {
          return res.status(403).json({ error: "HOA Admins can only create HOA Member users" });
        }
        if (communityId !== actor.hoaCommunityId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else if (actor.role === "property_manager") {
        const allowedRoles = ["hoa_admin", "hoa_member"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ error: "Property Managers can only create HOA Admin or HOA Member users" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(409).json({ error: "Username already taken" });

      const validPortalRoles = ["hoa_admin", "hoa_member"] as const;
      type PortalRole = typeof validPortalRoles[number];
      const typedRole: PortalRole = validPortalRoles.includes(role) ? (role as PortalRole) : "hoa_member";

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: typedRole,
        hoaCommunityId: communityId,
      });
      await storage.addCommunityMembers(communityId, [user.id]);
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create portal user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  /* ── Edit community user role/status (PM, HOA Admin) ───────────────────── */
  app.put("/api/portal/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot edit yourself" });
      }

      if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return res.status(403).json({ error: "HOA Admins can only edit HOA Members" });
        }
      } else if (actor.role === "property_manager") {
        if (!targetUser.hoaCommunityId) {
          return res.status(403).json({ error: "User has no community assignment" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId);
        if (!isMember) return res.status(403).json({ error: "User is not in your community" });
      }

      const { role, isActive } = req.body;
      let updated = targetUser;

      if (role !== undefined) {
        if (actor.role === "hoa_admin" && role !== "hoa_member") {
          return res.status(403).json({ error: "HOA Admins can only assign HOA Member role" });
        }
        if (actor.role === "property_manager") {
          const allowedRoles = ["hoa_admin", "hoa_member"];
          if (!allowedRoles.includes(role)) {
            return res.status(403).json({ error: "Property Managers can only assign HOA Admin or HOA Member roles" });
          }
        }
        const r = await storage.updateUserRole(req.params.id as string, role, targetUser.hoaCommunityId);
        if (r) updated = r;
      }

      if (typeof isActive === "boolean") {
        const r = await storage.updateUserStatus(req.params.id as string, isActive);
        if (r) updated = r;
      }

      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Edit portal user error:", error);
      res.status(500).json({ error: "Failed to edit user" });
    }
  });

  /* ── Remove user from community (PM, HOA Admin) — unlinks, does not delete ─ */
  app.delete("/api/portal/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }

      if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return res.status(403).json({ error: "HOA Admins can only remove HOA Members" });
        }
      } else if (actor.role === "property_manager") {
        if (!targetUser.hoaCommunityId) {
          return res.status(403).json({ error: "User has no community" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId);
        if (!isMember) return res.status(403).json({ error: "User is not in your community" });
      }

      /* Unlink from community (remove hoaCommunityId and community_members row), do NOT delete account */
      await storage.removeCommunityMember(targetUser.hoaCommunityId!, req.params.id as string);
      await storage.updateUserRole(req.params.id as string, targetUser.role, null);
      res.json({ message: "User removed from community" });
    } catch (error) {
      console.error("Remove portal user error:", error);
      res.status(500).json({ error: "Failed to remove user from community" });
    }
  });

  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.post("/api/push-tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = registerPushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const deviceId = parsed.data.deviceId;
      const newToken = parsed.data.token;
      const now = Date.now();
      const lastReg = pushTokenLastReg.get(deviceId);
      if (lastReg && lastReg.token === newToken && now - lastReg.ts < PUSH_TOKEN_RATE_LIMIT_MS) {
        return res.status(200).json({ rateLimited: true });
      }
      const pushToken = await storage.registerPushToken(
        req.session.userId!,
        newToken,
        parsed.data.platform,
        deviceId,
      );
      pushTokenLastReg.set(deviceId, { ts: now, token: newToken });
      res.status(201).json(pushToken);
    } catch (error) {
      console.error("Register push token error:", error);
      res.status(500).json({ error: "Failed to register push token" });
    }
  });

  app.delete("/api/push-tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const { token, deviceId } = req.body;
      if (deviceId) {
        await storage.removePushTokenByDevice(req.session.userId!, deviceId);
        pushTokenLastReg.delete(deviceId);
      } else if (token) {
        await storage.removePushToken(req.session.userId!, token);
        // Clear any Map entry whose stored token matches, so account-switch flows
        // don't leave a stale throttle behind when there is no deviceId to key on.
        for (const [key, entry] of pushTokenLastReg.entries()) {
          if (entry.token === token) {
            pushTokenLastReg.delete(key);
            break;
          }
        }
      } else {
        return res.status(400).json({ error: "token or deviceId is required" });
      }
      res.json({ message: "Push token removed" });
    } catch (error) {
      console.error("Remove push token error:", error);
      res.status(500).json({ error: "Failed to remove push token" });
    }
  });

  app.post("/api/push/due-reminders", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await sendDueReminders();
      res.json({ message: "Due reminders sent" });
    } catch (error) {
      console.error("Due reminders error:", error);
      res.status(500).json({ error: "Failed to send due reminders" });
    }
  });

  app.get("/api/communities/:communityId/assets", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }
      const type = req.query.type as string | undefined;
      const includeArchived = req.query.includeArchived === "true";
      const assetList = await storage.getAssetsByCommunitySorted(communityId, type, includeArchived);
      res.json(assetList);
    } catch (error) {
      console.error("Get assets error:", error);
      res.status(500).json({ error: "Failed to fetch assets" });
    }
  });

  app.get("/api/assets/by-feature", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      const featureRef = req.query.featureRef as string;
      if (!communityId || !featureRef) return res.status(400).json({ error: "communityId and featureRef are required" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }
      const asset = await storage.getAssetByFeatureRef(communityId, featureRef);
      if (!asset) {
        console.warn(`[by-feature] No asset found for communityId=${communityId} featureRef=${featureRef}`);
      }
      res.json(asset);
    } catch (error) {
      console.error("Get asset by feature error:", error);
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  });

  app.post("/api/assets/bulk/properties", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { assetIds, key, value, mode } = req.body;
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        return res.status(400).json({ error: "assetIds must be a non-empty array" });
      }
      if (!key || typeof key !== "string" || !value || typeof value !== "string") {
        return res.status(400).json({ error: "key and value are required strings" });
      }
      const validMode = mode === "overwrite" ? "overwrite" : "set_if_missing";
      const result = await storage.bulkUpsertAssetProperty(assetIds, key.trim(), value.trim(), validMode);
      res.json(result);
    } catch (error) {
      console.error("Bulk upsert properties error:", error);
      res.status(500).json({ error: "Failed to bulk upsert properties" });
    }
  });

  app.get("/api/assets/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "You do not have access to this asset" });
      }
      const properties = await storage.getAssetProperties(asset.id);
      const missingRequiredKeys = getMissingRequiredKeys(asset.assetType, properties);
      let createdByName: string | null = null;
      let updatedByName: string | null = null;
      if (asset.createdBy) {
        const cbUser = await storage.getUserById(asset.createdBy);
        createdByName = cbUser?.displayName ?? null;
      }
      if (asset.updatedBy) {
        const ubUser = await storage.getUserById(asset.updatedBy);
        updatedByName = ubUser?.displayName ?? null;
      }
      res.json({ ...asset, properties, missingRequiredKeys, createdByName, updatedByName, workHistorySummary: { totalTasks: 0, completedTasks: 0 } });
    } catch (error) {
      console.error("Get asset error:", error);
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  });

  app.get("/api/assets/:id/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "You do not have access to this asset's history" });
      }
      const history = await storage.getAssetWorkHistory(asset.id);
      res.json(history);
    } catch (error) {
      console.error("Get asset history error:", error);
      res.status(500).json({ error: "Failed to fetch asset history" });
    }
  });

  app.get("/api/assets/:id/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }
      const notes = await storage.getAssetNotes(asset.id);
      res.json(notes);
    } catch (error) {
      console.error("Get asset notes error:", error);
      res.status(500).json({ error: "Failed to fetch asset notes" });
    }
  });

  app.post("/api/assets/:id/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = insertAssetNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }
      const note = await storage.createAssetNote({
        assetId: asset.id,
        communityId: asset.communityId,
        createdBy: req.session.userId!,
        noteText: parsed.data.noteText,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      res.status(201).json(note);
    } catch (error) {
      console.error("Create asset note error:", error);
      res.status(500).json({ error: "Failed to create asset note" });
    }
  });

  app.delete("/api/assets/:assetId/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { assetId, noteId } = req.params as { assetId: string; noteId: string };
      const note = await storage.getAssetNoteById(noteId);
      if (!note) return res.status(404).json({ error: "Note not found" });
      if (note.assetId !== assetId) return res.status(404).json({ error: "Note not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin" && note.createdBy !== user.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteAssetNote(noteId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete asset note error:", error);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  app.patch("/api/communities/:id/map-creator-lock", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const { locked } = req.body;
      if (typeof locked !== "boolean") {
        return res.status(400).json({ error: "locked (boolean) is required" });
      }
      const currentUser = (req as any).currentUser;
      const communityId = req.params.id as string;

      if (!locked && isMapCreatorRole(currentUser.role)) {
        return res.status(403).json({ error: "Only admins can unlock a community." });
      }

      if (isMapCreatorRole(currentUser.role)) {
        const isMember = await storage.isUserMemberOfCommunity(currentUser.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }

      const community = await storage.getCommunityById(communityId);
      if (!community) return res.status(404).json({ error: "Community not found" });

      const updated = locked
        ? await storage.lockCommunityForMapCreator(communityId, currentUser.id)
        : await storage.unlockCommunityForMapCreator(communityId);

      if (!updated) return res.status(404).json({ error: "Community not found" });
      res.json({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        isMapCreatorLocked: updated.isMapCreatorLocked,
        mapCreatorLockedAt: updated.mapCreatorLockedAt,
        mapCreatorLockedBy: updated.mapCreatorLockedBy,
        createdAt: updated.createdAt,
      });
    } catch (error) {
      req.log.error({ error }, "Map creator lock error");
      res.status(500).json({ error: "Failed to update lock state" });
    }
  });

  app.post("/api/assets", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return res.status(401).json({ error: "User not found" });

      // Map creator GPS-pin path: communityId + assetType + lat/lng (label optional)
      if (isMapCreatorRole(reqUser.role)) {
        const MC_ASSET_TYPES = [
          "tree", "pet_station", "controller", "backflow", "pump",
          "master_valve", "flow_meter", "quick_connect", "isolation_valve", "zone",
        ] as const;
        type McAssetType = typeof MC_ASSET_TYPES[number];

        const MC_LAYER_MAP_LOCAL: Record<McAssetType, { layerKey: string; subLayerKey: string; displayName: string }> = {
          tree:            { layerKey: "trees",      subLayerKey: "tree",            displayName: "Trees" },
          pet_station:     { layerKey: "community",  subLayerKey: "pet_station",     displayName: "Pet Stations" },
          controller:      { layerKey: "irrigation", subLayerKey: "controller",      displayName: "Controllers" },
          backflow:        { layerKey: "irrigation", subLayerKey: "backflow",        displayName: "Backflows" },
          pump:            { layerKey: "irrigation", subLayerKey: "pump",            displayName: "Pumps" },
          master_valve:    { layerKey: "irrigation", subLayerKey: "master_valve",    displayName: "Master Valves" },
          flow_meter:      { layerKey: "irrigation", subLayerKey: "flow_meter",      displayName: "Flow Meters" },
          quick_connect:   { layerKey: "irrigation", subLayerKey: "quick_connect",   displayName: "Quick Connects" },
          isolation_valve: { layerKey: "irrigation", subLayerKey: "isolation_valve", displayName: "Isolation Valves" },
          zone:            { layerKey: "irrigation", subLayerKey: "zone",            displayName: "Zones" },
        };

        // Authz: communityId required → membership → lock check
        const communityIdForPin = req.body?.communityId as string | undefined;
        if (!communityIdForPin) return res.status(400).json({ error: "communityId is required" });
        const isMemberForPin = await storage.isUserMemberOfCommunity(reqUser.id, communityIdForPin);
        if (!isMemberForPin) return res.status(403).json({ error: "You are not a member of this community" });
        const communityForPin = await storage.getCommunityById(communityIdForPin);
        if (communityForPin?.isMapCreatorLocked) {
          return res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
        }

        const pinSchema = z.object({
          communityId: z.string().min(1),
          assetType:   z.enum(MC_ASSET_TYPES),
          latitude:    z.number(),
          longitude:   z.number(),
          label:       z.string().optional(),
        });

        const parsed = pinSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
        }

        const { communityId, assetType, latitude, longitude, label } = parsed.data;

        const isMember = await storage.isUserMemberOfCommunity(reqUser.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not authorized to create assets in this community" });

        const layerDef = MC_LAYER_MAP_LOCAL[assetType];
        const featureRef = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pinLabel = label || `${layerDef.displayName.replace(/s$/, "")} ${featureRef.slice(-4).toUpperCase()}`;

        const allLayers = await storage.getMapLayersByCommunity(communityId, layerDef.layerKey);
        let layer = allLayers.find((l) => l.subLayerKey === layerDef.subLayerKey) ?? null;
        let isNewLayer = false;

        const newFeature = {
          type: "Feature",
          id: featureRef,
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties: { id: featureRef, label: pinLabel },
        };

        if (!layer) {
          isNewLayer = true;
          const color = getDefaultLayerColor(layerDef.subLayerKey, allLayers.length);
          layer = await storage.createMapLayer({
            communityId,
            layerKey: layerDef.layerKey,
            subLayerKey: layerDef.subLayerKey,
            displayName: layerDef.displayName,
            geojsonData: JSON.stringify({ type: "FeatureCollection", features: [newFeature] }),
            color,
          });
        } else {
          let collection: { type: string; features: any[] } = { type: "FeatureCollection", features: [] };
          if (layer.geojsonData) {
            try { collection = JSON.parse(layer.geojsonData); } catch {}
          }
          collection.features = [...(collection.features || []), newFeature];
          await storage.updateMapLayer(layer.id, layer.version, { geojsonData: JSON.stringify(collection) });
          layer = (await storage.getMapLayerById(layer.id)) ?? layer;
        }

        let asset;
        try {
          asset = await storage.createAsset({
            communityId,
            assetType,
            label: pinLabel,
            featureRef,
            mapLayerId: layer.id,
            geometryType: "point",
            latitude,
            longitude,
            createdBy: reqUser.id,
            updatedBy: reqUser.id,
          });
        } catch (createErr: any) {
          if (createErr?.code === '23505' || createErr?.message?.includes('duplicate') || createErr?.message?.includes('unique')) {
            return res.status(409).json({ error: "A pin with this reference already exists in this community/layer." });
          }
          throw createErr;
        }

        const { geojsonData: _geo, ...layerMeta } = layer;
        return res.status(201).json({ asset, layerId: layer.id, feature: newFeature, isNewLayer, layer: layerMeta });
      }

      // Admin path: full insertAssetSchema validation
      if (reqUser.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const parsed = insertAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      if (reqUser.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(reqUser.id, parsed.data.communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const bodyProps: Record<string, string> = {};
      const rawProps = req.body.properties;
      if (rawProps && typeof rawProps === "object") {
        for (const [k, v] of Object.entries(rawProps)) {
          if (typeof v === "string") bodyProps[k] = v;
        }
      }

      let asset;
      try {
        if (
          parsed.data.assetType === "controller" &&
          isMapCreatorRole(reqUser.role) &&
          (!bodyProps.controllerKey || !bodyProps.controllerColor)
        ) {
          const { asset: newAsset } = await storage.createControllerAssetAtomic({
            communityId: parsed.data.communityId,
            label: parsed.data.label,
            featureRef: parsed.data.featureRef,
            mapLayerId: parsed.data.mapLayerId,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            createdBy: reqUser.id,
            bodyProps,
            controllerColors: CONTROLLER_COLORS,
          });
          asset = newAsset;
        } else {
          asset = await storage.createAsset({
            ...parsed.data,
            createdBy: reqUser.id,
            updatedBy: reqUser.id,
          });
          const properties = Object.entries(bodyProps).map(([key, value]) => ({ key, value }));
          if (properties.length > 0) {
            await storage.upsertAssetProperties(asset.id, properties);
          }
        }
      } catch (err: any) {
        if (err?.code === "23505") {
          return res.status(409).json({ error: "A pin with this ID already exists. Please try again.", code: "DUPLICATE_FEATURE_REF" });
        }
        throw err;
      }

      res.status(201).json(asset);
    } catch (error) {
      req.log.error({ error }, "Create asset error");
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.post("/api/assets/:id/attachments", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const assetId = req.params.id as string;
      const asset = await storage.getAssetById(assetId);
      if (!asset) return res.status(404).json({ error: "Asset not found" });

      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return res.status(401).json({ error: "User not found" });
      if (reqUser.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(reqUser.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }

      const { uploadURL, idempotencyKey, capturedAt } = req.body;
      if (!uploadURL || !idempotencyKey) {
        return res.status(400).json({ error: "uploadURL and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      if (strictValidation) {
        const parsed = parseUploadURL(uploadURL);
        if (!parsed.valid) {
          return res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
        }
      }

      const existing = await storage.getAssetAttachmentByIdempotencyKey(assetId, idempotencyKey);
      if (existing) {
        return res.status(200).json(existing);
      }

      const aclPolicy = buildCommunityAclPolicy(req.session.userId!, asset.communityId);
      const objectStorageService = new ObjectStorageService();
      let objectPath: string;
      try {
        objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, aclPolicy);
      } catch (error) {
        if (strictValidation && error instanceof ObjectNotFoundError) {
          return res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
        }
        throw error;
      }

      const attachment = await storage.addAssetAttachment({
        assetId,
        communityId: asset.communityId,
        fileRef: objectPath,
        url: objectPath,
        uploadedBy: req.session.userId!,
        idempotencyKey,
        capturedAt: capturedAt ? new Date(capturedAt) : undefined,
      });

      res.status(201).json(attachment);
    } catch (error) {
      req.log.error({ error }, "Create asset attachment error");
      res.status(500).json({ error: "Failed to create asset attachment" });
    }
  });

  app.get("/api/assets/:id/attachments", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const assetId = req.params.id as string;
      const asset = await storage.getAssetById(assetId);
      if (!asset) return res.status(404).json({ error: "Asset not found" });

      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return res.status(401).json({ error: "User not found" });
      if (reqUser.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(reqUser.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }

      const assetAttachmentsList = await storage.getAssetAttachments(assetId);
      res.json(assetAttachmentsList);
    } catch (error) {
      req.log.error({ error }, "Get asset attachments error");
      res.status(500).json({ error: "Failed to fetch asset attachments" });
    }
  });

  app.patch("/api/assets/:id", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const parsed = updateAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const currentUser = (req as any).currentUser;
      if (currentUser.role !== "admin") {
        const asset = await storage.getAssetById(req.params.id as string);
        if (!asset) return res.status(404).json({ error: "Asset not found" });
        const isMember = await storage.isUserMemberOfCommunity(currentUser.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
        if (isMapCreatorRole(currentUser.role)) {
          const community = await storage.getCommunityById(asset.communityId);
          if (community?.isMapCreatorLocked) {
            return res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
          }
        }
      }


      const { version, ...data } = parsed.data;
      const updated = await storage.updateAsset(req.params.id as string, version, {
        ...data,
        updatedBy: req.session.userId!,
      });
      if (!updated) {
        const latest = await storage.getAssetById(req.params.id as string);
        if (!latest) return res.status(404).json({ error: "Asset not found" });
        return res.status(409).json({
          error: "Conflict: asset was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestAsset: latest,
        });
      }
      res.json(updated);
    } catch (error) {
      req.log.error({ error }, "Update asset error");
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.put("/api/assets/:id/properties", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const parsed = upsertAssetPropertiesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });

      const currentUser = (req as any).currentUser;
      if (currentUser.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(currentUser.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }
      if (isMapCreatorRole(currentUser.role)) {
        const isMember = await storage.isUserMemberOfCommunity(currentUser.id, asset.communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
        const community = await storage.getCommunityById(asset.communityId);
        if (community?.isMapCreatorLocked) {
          return res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
        }
      }


      const properties = await storage.upsertAssetProperties(asset.id, parsed.data.properties);
      res.json(properties);
    } catch (error) {
      req.log.error({ error }, "Upsert properties error");
      res.status(500).json({ error: "Failed to update properties" });
    }
  });

  app.put("/api/tasks/:id/link", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = setTaskLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (task.version !== parsed.data.version) {
        return res.status(409).json({
          error: "Conflict: task was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: task,
        });
      }
      const { version: _, ...linkData } = parsed.data;
      const link = await storage.setTaskLink(task.id, linkData);
      res.json(link);
    } catch (error) {
      console.error("Set task link error:", error);
      res.status(500).json({ error: "Failed to set task link" });
    }
  });

  app.get("/api/tasks/:id/link", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed, task } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!allowed) return res.status(403).json({ error: "You do not have access to this task" });
      const link = await storage.getTaskLink(task.id);
      res.json(link);
    } catch (error) {
      console.error("Get task link error:", error);
      res.status(500).json({ error: "Failed to fetch task link" });
    }
  });

  app.get("/api/map-layers", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId is required" });
      const user = await storage.getUserById(req.session.userId!);
      if (user?.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }
      const layerKey = req.query.layerKey as string | undefined;
      const layers = await storage.getMapLayersByCommunity(communityId, layerKey);
      const result = layers.map(({ geojsonData, ...rest }) => rest);
      res.json(result);
    } catch (error) {
      console.error("Get map layers error:", error);
      res.status(500).json({ error: "Failed to fetch map layers" });
    }
  });

  app.get("/api/map-layers/:id/geojson", requireAuth, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const reqUser = await storage.getUserById(req.session.userId!);
      if (reqUser?.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, layer.communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }
      if (!layer.geojsonData) return res.json(null);
      res.setHeader("Content-Type", "application/json");
      res.send(layer.geojsonData);
    } catch (error) {
      console.error("Get geojson error:", error);
      res.status(500).json({ error: "Failed to fetch GeoJSON" });
    }
  });

  app.get("/api/layer-hierarchy", requireAuth, async (_req: Request, res: Response) => {
    res.json(CANONICAL_LAYER_HIERARCHY);
  });

  app.post("/api/map-layers", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertMapLayerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const keyValidation = validateLayerKeys(parsed.data.layerKey, parsed.data.subLayerKey);
      if (!keyValidation.valid) return res.status(400).json({ error: keyValidation.error });

      if (!parsed.data.color) {
        const count = (await storage.getMapLayersByCommunity(parsed.data.communityId, parsed.data.layerKey)).length;
        parsed.data.color = getDefaultLayerColor(parsed.data.subLayerKey, count);
      }

      const layer = await storage.createMapLayer(parsed.data);
      let syncResult = null;
      let featureCount = 0;
      if (layer.geojsonData) {
        try {
          const geo = JSON.parse(layer.geojsonData);
          featureCount = geo.features?.length || 0;
        } catch {}
        syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
      }
      const { geojsonData, ...rest } = layer;
      res.status(201).json({ ...rest, featureCount, syncResult });
    } catch (error: any) {
      if (error?.constraint === "map_layers_community_layer_sub_idx") {
        return res.status(409).json({ error: "A layer with that key combination already exists" });
      }
      console.error("Create map layer error:", error);
      res.status(500).json({ error: "Failed to create map layer" });
    }
  });

  app.post("/api/map-layers/upload-validate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, layerKey, subLayerKey, geojsonData } = req.body;
      if (!communityId || !layerKey || !subLayerKey) {
        return res.status(400).json({ error: "communityId, layerKey, subLayerKey are required" });
      }

      const existingLayers = await storage.getMapLayersByCommunity(communityId, layerKey);
      const matchingLayer = existingLayers.find(l => l.subLayerKey === subLayerKey);

      if (matchingLayer) {
        const result = await previewSyncFromLayer(communityId, matchingLayer.id, layerKey, subLayerKey, geojsonData || null);
        return res.json(result);
      }

      let featureCount = 0;
      try {
        const parsed = JSON.parse(geojsonData);
        featureCount = parsed.features?.length || 0;
      } catch {}

      res.json({
        featureCount,
        wouldCreateCount: featureCount,
        wouldUpdateCount: 0,
        wouldArchiveCount: 0,
        wouldSkipCount: 0,
        wouldCreateSamples: [],
        wouldArchiveSamples: [],
      });
    } catch (error) {
      console.error("Upload validate error:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  app.post("/api/map-layers/upload", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const { communityId, layerKey, subLayerKey, displayName } = req.body;
      if (!communityId || !layerKey || !subLayerKey || !displayName) {
        return res.status(400).json({ error: "communityId, layerKey, subLayerKey, and displayName are required" });
      }

      const keyValidation = validateLayerKeys(layerKey, subLayerKey);
      if (!keyValidation.valid) return res.status(400).json({ error: keyValidation.error });

      let geojsonData: string;
      let sourceFormat: "kml" | "geojson" = "geojson";

      if (req.file) {
        const fileContent = req.file.buffer.toString("utf-8");
        const fileName = (req.file.originalname || "").toLowerCase();

        if (fileName.endsWith(".kml")) {
          sourceFormat = "kml";
          const result = convertKmlToGeojson(fileContent);
          geojsonData = JSON.stringify(result.geojson);
        } else {
          sourceFormat = "geojson";
          const result = normalizeGeojsonFeatureIds(fileContent);
          geojsonData = JSON.stringify(result.geojson);
        }
      } else if (req.body.geojsonData) {
        const raw = req.body.geojsonData;
        const result = normalizeGeojsonFeatureIds(raw);
        geojsonData = JSON.stringify(result.geojson);
      } else {
        return res.status(400).json({ error: "No file or GeoJSON data provided" });
      }

      const featureCount = JSON.parse(geojsonData).features?.length || 0;

      const existingLayer = req.body.layerId ? await storage.getMapLayerById(req.body.layerId) : null;

      if (existingLayer) {
        const version = parseInt(req.body.version || "1", 10);
        const updated = await storage.updateMapLayer(existingLayer.id, version, {
          displayName,
          sourceFormat,
          geojsonData,
        });
        if (!updated) {
          return res.status(409).json({
            error: "Conflict: layer was modified. Please refresh and try again.",
            code: "VERSION_CONFLICT",
          });
        }
        const syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
        const { geojsonData: _, ...rest } = updated;
        return res.json({ ...rest, featureCount, syncResult });
      } else {
        const uploadCount = (await storage.getMapLayersByCommunity(communityId, layerKey)).length;
        const autoColor = getDefaultLayerColor(subLayerKey, uploadCount);
        const layer = await storage.createMapLayer({
          communityId,
          layerKey,
          subLayerKey,
          displayName,
          sourceFormat,
          geojsonData,
          color: autoColor,
        });
        const syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
        const { geojsonData: _, ...rest } = layer;
        return res.status(201).json({ ...rest, featureCount, syncResult });
      }
    } catch (error: any) {
      if (error?.constraint === "map_layers_community_layer_sub_idx") {
        return res.status(409).json({ error: "A layer with that key combination already exists for this community" });
      }
      console.error("Map layer upload error:", error);
      res.status(500).json({ error: error.message || "Failed to process upload" });
    }
  });

  app.post("/api/map-layers/upload-irrigation", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const { communityId, displayName } = req.body;
      if (!communityId) {
        return res.status(400).json({ error: "communityId is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "KML file is required" });
      }

      const fileContent = req.file.buffer.toString("utf-8");
      const fileName = (req.file.originalname || "").toLowerCase();

      if (!fileName.endsWith(".kml")) {
        return res.status(400).json({ error: "Only KML files are supported for irrigation controller+zone upload" });
      }

      const parseResult = parseIrrigationKml(fileContent);

      if (parseResult.controllers.length === 0) {
        return res.status(400).json({
          error: "No controller/zone data found in this KML file. Make sure the file contains controller folders with zone placemarks.",
          warnings: parseResult.warnings,
        });
      }

      const controllerDisplayName = displayName || "Controllers";
      const zoneDisplayName = (displayName ? displayName.replace(/controller/i, "Zone").replace(/Controller/i, "Zone") : "Zones");

      const existingLayers = await storage.getMapLayersByCommunity(communityId, "irrigation");
      let controllerLayer = existingLayers.find(l => l.subLayerKey === "controller");
      let zoneLayer = existingLayers.find(l => l.subLayerKey === "zone");

      const controllerGeojsonStr = JSON.stringify(parseResult.controllerGeojson);
      const zoneGeojsonStr = JSON.stringify(parseResult.zoneGeojson);

      const irrLayerCount = existingLayers.length;

      if (controllerLayer) {
        const updated = await storage.updateMapLayer(controllerLayer.id, controllerLayer.version, {
          displayName: controllerDisplayName,
          sourceFormat: "kml",
          geojsonData: controllerGeojsonStr,
        });
        if (updated) controllerLayer = updated;
      } else {
        controllerLayer = await storage.createMapLayer({
          communityId,
          layerKey: "irrigation",
          subLayerKey: "controller",
          displayName: controllerDisplayName,
          sourceFormat: "kml",
          geojsonData: controllerGeojsonStr,
          color: getDefaultLayerColor("controller", irrLayerCount),
        });
      }

      if (zoneLayer) {
        const updated = await storage.updateMapLayer(zoneLayer.id, zoneLayer.version, {
          displayName: zoneDisplayName.includes("Zone") ? zoneDisplayName : "Zones",
          sourceFormat: "kml",
          geojsonData: zoneGeojsonStr,
        });
        if (updated) zoneLayer = updated;
      } else {
        zoneLayer = await storage.createMapLayer({
          communityId,
          layerKey: "irrigation",
          subLayerKey: "zone",
          displayName: "Zones",
          sourceFormat: "kml",
          geojsonData: zoneGeojsonStr,
          color: getDefaultLayerColor("zone", irrLayerCount + 1),
        });
      }

      const syncResult = await syncIrrigationAssets(
        communityId,
        controllerLayer.id,
        zoneLayer.id,
        parseResult.controllers,
        req.session.userId!,
      );

      res.json({
        controllerLayerId: controllerLayer.id,
        zoneLayerId: zoneLayer.id,
        controllerCount: parseResult.controllers.length,
        zoneCount: parseResult.controllers.reduce((sum, c) => sum + c.zones.length, 0),
        syncResult,
        warnings: parseResult.warnings,
      });
    } catch (error: any) {
      console.error("Irrigation upload error:", error);
      res.status(500).json({ error: error.message || "Failed to process irrigation KML" });
    }
  });

  app.patch("/api/map-layers/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = updateMapLayerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const { version, ...data } = parsed.data;
      const updated = await storage.updateMapLayer(req.params.id as string, version, data);
      if (!updated) {
        const existing = await storage.getMapLayerById(req.params.id as string);
        if (!existing) return res.status(404).json({ error: "Layer not found" });
        return res.status(409).json({
          error: "Conflict: layer was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestLayer: { ...existing, geojsonData: undefined },
        });
      }
      let syncResult = null;
      let featureCount = 0;
      if (parsed.data.geojsonData) {
        try {
          const geo = JSON.parse(updated.geojsonData || "{}");
          featureCount = geo.features?.length || 0;
        } catch {}
        syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
      }
      const { geojsonData, ...rest } = updated;
      res.json({ ...rest, featureCount, syncResult });
    } catch (error) {
      console.error("Update map layer error:", error);
      res.status(500).json({ error: "Failed to update map layer" });
    }
  });

  app.delete("/api/map-layers/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteMapLayer(req.params.id as string);
      if (!deleted) return res.status(404).json({ error: "Layer not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete map layer error:", error);
      res.status(500).json({ error: "Failed to delete map layer" });
    }
  });

  app.post("/api/map-layers/:id/sync-assets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const result = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
      res.json(result);
    } catch (error) {
      console.error("Sync assets from layer error:", error);
      res.status(500).json({ error: "Failed to sync assets" });
    }
  });

  app.post("/api/map-layers/:id/validate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      if (!layer.geojsonData) return res.json({ featureCount: 0, geometryCounts: { points: 0, lines: 0, polygons: 0, other: 0 }, missingIdCount: 0, missingIdSamples: [], duplicateIdCount: 0, duplicateIdSamples: [], invalidGeometryCount: 0, invalidGeometrySamples: [], warnings: [], errors: ["No GeoJSON data in this layer"], valid: false });
      const geojson = JSON.parse(layer.geojsonData);
      const result = validateLayerGeoJSON(geojson, { layerKey: layer.layerKey, subLayerKey: layer.subLayerKey });
      res.json(result);
    } catch (error) {
      console.error("Validate layer error:", error);
      res.status(500).json({ error: "Failed to validate layer" });
    }
  });

  app.post("/api/map-layers/:id/sync-preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const geojsonData = req.body?.geojsonData || layer.geojsonData;
      const result = await previewSyncFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, geojsonData);
      res.json(result);
    } catch (error) {
      console.error("Sync preview error:", error);
      res.status(500).json({ error: "Failed to generate sync preview" });
    }
  });

  app.get("/api/map-layers/:id/unlinked-features", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const unlinked = getUnlinkedFeatures(layer.geojsonData, existingAssets);
      res.json(unlinked);
    } catch (error) {
      console.error("Unlinked features error:", error);
      res.status(500).json({ error: "Failed to fetch unlinked features" });
    }
  });

  app.post("/api/map-layers/:id/create-missing-assets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });

      const assetType = resolveAssetType(layer.layerKey, layer.subLayerKey);
      if (!assetType) return res.status(400).json({ error: "Cannot resolve asset type for this layer" });

      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const unlinked = getUnlinkedFeatures(layer.geojsonData, existingAssets);

      const requestedIds = req.body?.featureIds as string[] | undefined;
      const toCreate = requestedIds
        ? unlinked.filter(u => requestedIds.includes(u.featureId) && u.reason !== "invalid_id")
        : unlinked.filter(u => u.reason !== "invalid_id");

      let created = 0;
      let reactivated = 0;

      for (const item of toCreate) {
        if (item.reason === "archived_asset_exists") {
          const existing = existingAssets.find(a => a.featureRef === item.featureId && a.isArchived);
          if (existing) {
            await storage.updateAssetArchived(existing.id, false);
            reactivated++;
            continue;
          }
        }

        let features: any[] = [];
        try {
          const parsed = JSON.parse(layer.geojsonData!);
          features = parsed.features || [];
        } catch {}

        const feature = features.find((f: any, i: number) => {
          const fId = extractFeatureId(f, i);
          return fId === item.featureId;
        });

        if (feature) {
          const label = extractLabel(feature, assetType, 0);
          const { geometryType, lat, lng } = resolveGeometry(feature);
          const newAsset = await storage.createAssetFromFeature({
            communityId: layer.communityId,
            assetType: assetType as any,
            label,
            featureRef: item.featureId,
            mapLayerId: layer.id,
            geometryType,
            latitude: lat,
            longitude: lng,
            createdBy: req.session.userId!,
          });

          const sqFt = computeAreaSqFt(feature);
          if (sqFt != null) {
            await storage.upsertAssetProperty(newAsset.id, "sqFt", String(sqFt));
          }

          created++;
        }
      }

      res.json({ created, reactivated, total: created + reactivated });
    } catch (error) {
      console.error("Create missing assets error:", error);
      res.status(500).json({ error: "Failed to create missing assets" });
    }
  });

  app.get("/api/map-layers/:id/collisions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const collisions = getGeoJsonCollisions(layer.geojsonData, existingAssets);
      res.json(collisions);
    } catch (error) {
      console.error("Collisions error:", error);
      res.status(500).json({ error: "Failed to fetch collisions" });
    }
  });

  app.get("/api/map-layers/:id/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });

      let featureCount = 0;
      if (layer.geojsonData) {
        try {
          const geo = JSON.parse(layer.geojsonData);
          featureCount = geo.features?.length || 0;
        } catch {}
      }

      const summary = await storage.getMapLayerSummary(layer.id, layer.communityId);
      res.json({
        featureCount,
        sourceFormat: layer.sourceFormat,
        ...summary,
      });
    } catch (error) {
      console.error("Map layer summary error:", error);
      res.status(500).json({ error: "Failed to fetch layer summary" });
    }
  });

  app.get("/api/communities/:communityId/assets/completeness", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const type = req.query.type as string | undefined;
      const allAssets = await storage.getAssetsByCommunitySorted(communityId, type, true);
      const active = allAssets.filter(a => !a.isArchived);
      const archived = allAssets.filter(a => a.isArchived);

      const missingRequired: { id: string; label: string; assetType: string; missingKeys: string[] }[] = [];
      for (const asset of active) {
        const props = await storage.getAssetProperties(asset.id);
        const missing = getMissingRequiredKeys(asset.assetType, props);
        if (missing.length > 0) {
          missingRequired.push({ id: asset.id, label: asset.label, assetType: asset.assetType, missingKeys: missing });
        }
      }

      res.json({
        total: allAssets.length,
        active: active.length,
        archived: archived.length,
        missingRequired: missingRequired.length,
        missingRequiredAssets: missingRequired,
      });
    } catch (error) {
      console.error("Get asset completeness error:", error);
      res.status(500).json({ error: "Failed to fetch asset completeness" });
    }
  });

  app.get("/api/communities/:communityId/assets/incomplete", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const assetType = req.query.assetType as string | undefined;
      const mapLayerId = req.query.mapLayerId as string | undefined;
      const missingKey = req.query.missingKey as string | undefined;
      const results = await storage.getIncompleteAssets(communityId, assetType, mapLayerId, missingKey);
      res.json(results);
    } catch (error) {
      console.error("Get incomplete assets error:", error);
      res.status(500).json({ error: "Failed to fetch incomplete assets" });
    }
  });

  app.get("/api/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || '').trim();
      if (!q) return res.json([]);

      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });

      const isAdmin = user.role === "admin";
      let communityIds: string[] = [];

      const communityId = req.query.communityId as string | undefined;
      if (communityId) {
        if (!isAdmin) {
          const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
          if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
        }
        communityIds = [communityId];
      } else {
        const memberships = await storage.getUserCommunities(user.id);
        communityIds = memberships.map(m => m.community.id);
        if (isAdmin) {
          const allComms = await storage.getCommunities();
          communityIds = allComms.map(c => c.id);
        }
      }

      const typesStr = (req.query.types as string) || '';
      const types = typesStr ? typesStr.split(',').map(t => t.trim()).filter(Boolean) : [];

      const results = await storage.searchAll(q, communityIds, types, user.id, isAdmin);
      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/asset-type-templates", requireAuth, async (_req: Request, res: Response) => {
    res.json(ASSET_TYPE_TEMPLATES);
  });

  app.get("/api/communities/:communityId/offline-pack", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }
      const pack = await storage.getLatestOfflinePack(communityId);
      if (!pack) return res.json(null);
      res.json({
        id: pack.id,
        communityId: pack.communityId,
        packVersion: pack.packVersion,
        updatedAt: pack.updatedAt,
        checksum: pack.checksum,
      });
    } catch (error) {
      console.error("Get offline pack error:", error);
      res.status(500).json({ error: "Failed to fetch offline pack" });
    }
  });

  app.post("/api/offline-packs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertOfflinePackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const pack = await storage.createOfflinePack(parsed.data);
      res.status(201).json(pack);
    } catch (error: any) {
      if (error?.constraint === "offline_packs_community_version_idx") {
        return res.status(409).json({ error: "A pack with that version already exists for this community" });
      }
      console.error("Create offline pack error:", error);
      res.status(500).json({ error: "Failed to create offline pack" });
    }
  });

  app.post("/api/offline-packs/:id/download-urls", requireAuth, async (req: Request, res: Response) => {
    try {
      const pack = await storage.getOfflinePackById(req.params.id as string);
      if (!pack) return res.status(404).json({ error: "Pack not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, pack.communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }
      res.json({
        mbtilesRef: pack.mbtilesRef,
        manifestRef: pack.manifestRef,
        geojsonBundleRef: pack.geojsonBundleRef,
        assetIndexRef: pack.assetIndexRef,
        searchIndexRef: pack.searchIndexRef,
      });
    } catch (error) {
      console.error("Get download URLs error:", error);
      res.status(500).json({ error: "Failed to get download URLs" });
    }
  });

  app.get("/api/offline-packs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId query parameter is required" });
      const packs = await storage.listOfflinePacks(communityId);
      res.json(packs);
    } catch (error) {
      console.error("List offline packs error:", error);
      res.status(500).json({ error: "Failed to list offline packs" });
    }
  });

  app.delete("/api/offline-packs/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteOfflinePack(req.params.id as string);
      if (!deleted) return res.status(404).json({ error: "Pack not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete offline pack error:", error);
      res.status(500).json({ error: "Failed to delete offline pack" });
    }
  });

  app.post("/api/communities/:communityId/generate-offline-pack", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const community = await storage.getCommunityById(communityId);
      if (!community) return res.status(404).json({ error: "Community not found" });

      const existingPack = await storage.getLatestOfflinePack(communityId);
      const newVersion = existingPack ? existingPack.packVersion + 1 : 1;

      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot, searchIndex] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId),
        storage.generateSearchIndex(communityId),
      ]);

      const pack = await storage.createOfflinePack({
        communityId,
        packVersion: newVersion,
      });

      res.status(201).json({
        pack,
        manifest,
        assetIndex,
        geojsonBundle,
        workHistorySnapshot,
        searchIndex,
      });
    } catch (error) {
      console.error("Generate offline pack error:", error);
      res.status(500).json({ error: "Failed to generate offline pack" });
    }
  });

  app.get("/api/communities/:communityId/offline-pack-data", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "You are not a member of this community" });
      }

      const pack = await storage.getLatestOfflinePack(communityId);
      if (!pack) return res.status(404).json({ error: "No offline pack available for this community" });

      const isAdmin = user.role === 'admin';
      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot, searchIndex] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId),
        storage.generateSearchIndex(communityId, user.id, isAdmin),
      ]);

      res.json({
        pack: {
          id: pack.id,
          communityId: pack.communityId,
          packVersion: pack.packVersion,
          updatedAt: pack.updatedAt,
          checksum: pack.checksum,
        },
        manifest,
        assetIndex,
        geojsonBundle,
        workHistorySnapshot,
        searchIndex,
      });
    } catch (error) {
      console.error("Get offline pack data error:", error);
      res.status(500).json({ error: "Failed to fetch offline pack data" });
    }
  });

  // Task Templates CRUD
  app.get("/api/task-templates", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const templates = await storage.getTaskTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Get task templates error:", error);
      res.status(500).json({ error: "Failed to fetch task templates" });
    }
  });

  app.post("/api/task-templates", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const template = await storage.createTaskTemplate({
        ...parsed.data,
        description: parsed.data.description ?? null,
        dueDaysOffset: parsed.data.dueDaysOffset ?? null,
        targetAssetType: parsed.data.targetAssetType ?? null,
        targetMapLayerId: parsed.data.targetMapLayerId ?? null,
        targetAssetId: parsed.data.targetAssetId ?? null,
        createdBy: req.session.userId!,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Create task template error:", error);
      res.status(500).json({ error: "Failed to create task template" });
    }
  });

  app.patch("/api/task-templates/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const updated = await storage.updateTaskTemplate(req.params.id as string, parsed.data);
      if (!updated) return res.status(404).json({ error: "Template not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update task template error:", error);
      res.status(500).json({ error: "Failed to update task template" });
    }
  });

  app.delete("/api/task-templates/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskTemplate(req.params.id as string);
      res.json({ message: "Template deleted" });
    } catch (error) {
      console.error("Delete task template error:", error);
      res.status(500).json({ error: "Failed to delete task template" });
    }
  });

  // Template preview — returns count of tasks that would be generated
  app.post("/api/task-templates/:id/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      if (template.targetType === 'none') {
        return res.json({ taskCount: 1, assets: [] });
      }

      const targetAssets = await storage.getTargetAssets(
        communityId, template.targetType, template.targetAssetType,
        template.targetMapLayerId, template.targetAssetId,
        includeArchivedAssets, assetLimit,
      );

      res.json({
        taskCount: targetAssets.length,
        assets: targetAssets.slice(0, 10).map(a => ({ id: a.id, label: a.label, assetType: a.assetType })),
      });
    } catch (error) {
      console.error("Template preview error:", error);
      res.status(500).json({ error: "Failed to preview template" });
    }
  });

  // Generate tasks from template
  app.post("/api/task-templates/:id/generate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, dueDate: dueDateStr, assignToUserId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      let dueDate: Date | undefined;
      if (dueDateStr) {
        dueDate = new Date(dueDateStr);
      } else if (template.dueDaysOffset != null) {
        dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.dueDaysOffset);
      }

      const createdTasks: any[] = [];

      if (template.targetType === 'none') {
        const task = await storage.createTask({
          communityId,
          title: template.title,
          description: template.description || undefined,
          priority: template.priority,
          assignedTo: assignToUserId,
          createdBy: req.session.userId!,
          dueDate,
        });
        createdTasks.push(task);
      } else {
        const targetAssets = await storage.getTargetAssets(
          communityId, template.targetType, template.targetAssetType,
          template.targetMapLayerId, template.targetAssetId,
          includeArchivedAssets, assetLimit,
        );

        for (const asset of targetAssets) {
          const task = await storage.createTask({
            communityId,
            title: `${template.title} — ${asset.label || asset.featureRef || asset.id.substring(0, 8)}`,
            description: template.description || undefined,
            priority: template.priority,
            latitude: asset.latitude ?? undefined,
            longitude: asset.longitude ?? undefined,
            assignedTo: assignToUserId,
            createdBy: req.session.userId!,
            dueDate,
          });

          await storage.setTaskLink(task.id, {
            linkType: 'asset',
            assetId: asset.id,
          });

          createdTasks.push(task);
        }
      }

      const run = await storage.createTemplateRun({
        templateId: template.id,
        communityId,
        createdBy: req.session.userId!,
        taskCountCreated: createdTasks.length,
        assignmentUserId: assignToUserId || null,
      });

      res.status(201).json({
        runId: run.id,
        createdCount: createdTasks.length,
        skippedCount: 0,
        sample: createdTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status })),
      });
    } catch (error) {
      console.error("Generate from template error:", error);
      res.status(500).json({ error: "Failed to generate tasks from template" });
    }
  });

  // Bulk assign tasks
  app.post("/api/tasks/bulk/assign", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { taskIds, assignedTo } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0 || !assignedTo) {
        return res.status(400).json({ error: "taskIds[] and assignedTo are required" });
      }
      const count = await storage.bulkAssignTasks(taskIds, assignedTo);
      res.json({ updated: count });
    } catch (error) {
      console.error("Bulk assign error:", error);
      res.status(500).json({ error: "Failed to bulk assign tasks" });
    }
  });

  // CSV Task Import
  app.post("/api/tasks/import-csv", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const { parse } = await import("csv-parse/sync");
      const communityId = req.body.communityId;
      const mode = req.body.mode || "preview"; // "preview" or "commit"

      if (!communityId) {
        return res.status(400).json({ error: "communityId is required" });
      }

      const community = await storage.getCommunityById(communityId);
      if (!community) {
        return res.status(404).json({ error: "Community not found" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "CSV file is required" });
      }

      const csvContent = req.file.buffer.toString("utf-8");
      const firstLine = csvContent.split(/\r?\n/)[0] || "";
      const delimiter = firstLine.includes("\t") ? "\t" : ",";
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        delimiter,
      });

      if (records.length === 0) {
        return res.status(400).json({ error: "CSV file is empty" });
      }

      const priorityMap: Record<string, string> = {
        "low": "low",
        "medium": "medium",
        "high": "high",
        "urgent": "urgent",
        "critical": "urgent",
        "core": "high",
        "ongoing": "medium",
      };

      const rows: any[] = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const title = r["Ticket Title"] || r["Title"] || r["title"] || "";
        const ticketType = r["Ticket Type"] || r["Type"] || r["ticket_type"] || "";
        const rawPriority = (r["Priority"] || r["priority"] || "medium").toLowerCase();
        const priority = priorityMap[rawPriority] || "medium";
        const description = r["Description"] || r["description"] || "";
        const frequency = r["Frequency"] || r["frequency"] || "";
        const totalVisits = parseInt(r["Total Visits"] || r["total_visits"] || "1", 10) || 1;
        const address = r["Address"] || r["address"] || "";
        const lat = parseFloat(r["Latitude"] || r["latitude"] || r["lat"] || "");
        const lng = parseFloat(r["Longitude"] || r["longitude"] || r["lng"] || "");

        // Parse dates - handle M/D/YYYY format
        const rawStart = r["Start Date"] || r["start_date"] || r["startDate"] || "";
        const rawEnd = r["End Date"] || r["Due Date"] || r["end_date"] || r["dueDate"] || r["due_date"] || "";

        let startDate: Date | null = null;
        let dueDate: Date | null = null;

        if (rawStart) {
          const d = new Date(rawStart);
          if (!isNaN(d.getTime())) startDate = d;
        }
        if (rawEnd) {
          const d = new Date(rawEnd);
          if (!isNaN(d.getTime())) dueDate = d;
        }

        const errors: string[] = [];
        if (!title) errors.push("Title is required");

        rows.push({
          row: i + 1,
          title,
          ticketType,
          priority,
          description,
          frequency,
          totalVisits,
          address: address || null,
          latitude: isNaN(lat) ? null : lat,
          longitude: isNaN(lng) ? null : lng,
          startDate: startDate?.toISOString() || null,
          dueDate: dueDate?.toISOString() || null,
          errors,
          valid: errors.length === 0,
        });
      }

      const validRows = rows.filter(r => r.valid);
      const invalidRows = rows.filter(r => !r.valid);

      if (mode === "preview") {
        return res.json({
          mode: "preview",
          totalRows: rows.length,
          validCount: validRows.length,
          invalidCount: invalidRows.length,
          rows,
        });
      }

      // Commit mode - create tasks
      const created: any[] = [];
      const skipped: any[] = [];

      for (const row of rows) {
        if (!row.valid) {
          skipped.push({ row: row.row, title: row.title, reason: row.errors.join(", ") });
          continue;
        }
        try {
          const task = await storage.createTask({
            communityId,
            title: row.title,
            description: row.description || undefined,
            priority: row.priority as any,
            address: row.address || undefined,
            latitude: row.latitude ?? undefined,
            longitude: row.longitude ?? undefined,
            createdBy: req.session.userId!,
            startDate: row.startDate ? new Date(row.startDate) : undefined,
            dueDate: row.dueDate ? new Date(row.dueDate) : undefined,
            ticketType: row.ticketType || undefined,
          });
          created.push({ row: row.row, id: task.id, title: task.title });
        } catch (err: any) {
          skipped.push({ row: row.row, title: row.title, reason: err.message });
        }
      }

      res.json({
        mode: "commit",
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      });
    } catch (error: any) {
      console.error("CSV import error:", error);
      res.status(500).json({ error: error.message || "Failed to import CSV" });
    }
  });

  // Task Schedules CRUD
  app.get("/api/task-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const schedules = await storage.getTaskSchedules(communityId);
      res.json(schedules);
    } catch (error) {
      console.error("Get schedules error:", error);
      res.status(500).json({ error: "Failed to fetch schedules" });
    }
  });

  app.post("/api/task-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { communityId, templateId, frequency, daysOfWeek, dayOfMonth, timezone, startDate: startDateStr, endDate: endDateStr, assignToUserId, isEnabled } = parsed.data;

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
  });

  app.patch("/api/task-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getTaskScheduleById(req.params.id as string);
      if (!existing) return res.status(404).json({ error: "Schedule not found" });

      const parsed = insertTaskScheduleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
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
  });

  app.delete("/api/task-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskSchedule(req.params.id as string);
      res.json({ message: "Schedule deleted" });
    } catch (error) {
      console.error("Delete schedule error:", error);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  app.get("/api/task-schedules/:id/runs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const runs = await storage.getScheduleRuns(req.params.id as string);
      res.json(runs);
    } catch (error) {
      console.error("Get schedule runs error:", error);
      res.status(500).json({ error: "Failed to fetch schedule runs" });
    }
  });

  app.post("/api/task-schedules/run-now", requireAdmin, async (_req: Request, res: Response) => {
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
  });

  // ── Export endpoints ──

  app.post("/api/exports/proof-of-work", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, dateFrom, dateTo, assetType, contractorId, status, includePhotosZip } = req.body;
      if (!communityId || !dateFrom || !dateTo) {
        return res.status(400).json({ error: "communityId, dateFrom, and dateTo are required" });
      }

      const filters = {
        communityId,
        dateFrom,
        dateTo,
        assetType: assetType || undefined,
        contractorId: contractorId || undefined,
        status: status || "completed",
        includePhotosZip: !!includePhotosZip,
      };

      const [exportRow] = await db
        .insert(exportsTable)
        .values({
          communityId,
          createdBy: req.session.userId!,
          type: "proof_of_work",
          status: "queued",
          filters,
        })
        .returning();

      runExportGeneration(exportRow.id).catch((err) =>
        console.error("Background export failed:", err)
      );

      res.json({ exportId: exportRow.id });
    } catch (error) {
      console.error("Create export error:", error);
      res.status(500).json({ error: "Failed to create export" });
    }
  });

  app.get("/api/exports", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const conditions = communityId
        ? [eq(exportsTable.communityId, communityId)]
        : [];

      const rows = await db
        .select({
          id: exportsTable.id,
          communityId: exportsTable.communityId,
          createdBy: exportsTable.createdBy,
          type: exportsTable.type,
          status: exportsTable.status,
          filters: exportsTable.filters,
          pdfFileRef: exportsTable.pdfFileRef,
          photosZipRef: exportsTable.photosZipRef,
          createdAt: exportsTable.createdAt,
          completedAt: exportsTable.completedAt,
          errorMessage: exportsTable.errorMessage,
        })
        .from(exportsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(exportsTable.createdAt))
        .limit(50);

      res.json(rows);
    } catch (error) {
      console.error("List exports error:", error);
      res.status(500).json({ error: "Failed to list exports" });
    }
  });

  app.get("/api/exports/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow) {
        return res.status(404).json({ error: "Export not found" });
      }

      res.json(exportRow);
    } catch (error) {
      console.error("Get export error:", error);
      res.status(500).json({ error: "Failed to fetch export" });
    }
  });

  app.get("/api/exports/:id/download/pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.pdfFileRef) {
        return res.status(404).json({ error: "PDF not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.pdfFileRef);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="proof_of_work_${exportRow.id}.pdf"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download PDF error:", error);
      res.status(500).json({ error: "Failed to download PDF" });
    }
  });

  app.get("/api/exports/:id/download/zip", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.photosZipRef) {
        return res.status(404).json({ error: "ZIP not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.photosZipRef);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="photos_${exportRow.id}.zip"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download ZIP error:", error);
      res.status(500).json({ error: "Failed to download ZIP" });
    }
  });

  app.get("/api/communities/:communityId/service-schedules", requireAuth, async (req: Request, res: Response) => {
    try {
      const schedules = await storage.getServiceSchedulesByCommunity(req.params.communityId as string);
      res.json(schedules);
    } catch (error) {
      console.error("Get service schedules error:", error);
      res.status(500).json({ error: "Failed to get service schedules" });
    }
  });

  app.post("/api/communities/:communityId/service-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertServiceScheduleSchema.safeParse({
        ...req.body,
        communityId: req.params.communityId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.createServiceSchedule(parsed.data);
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create service schedule error:", error);
      res.status(500).json({ error: "Failed to create service schedule" });
    }
  });

  app.patch("/api/service-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = updateServiceScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.updateServiceSchedule(req.params.id as string, parsed.data);
      if (!schedule) {
        return res.status(404).json({ error: "Service schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      console.error("Update service schedule error:", error);
      res.status(500).json({ error: "Failed to update service schedule" });
    }
  });

  app.delete("/api/service-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteServiceSchedule(req.params.id as string);
      if (!deleted) {
        return res.status(404).json({ error: "Service schedule not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete service schedule error:", error);
      res.status(500).json({ error: "Failed to delete service schedule" });
    }
  });

  app.get("/api/service-schedules/:scheduleId/visits", requireAuth, async (req: Request, res: Response) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisits(req.params.scheduleId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  });

  app.get("/api/communities/:communityId/service-visits", requireAuth, async (req: Request, res: Response) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisitsByCommunity(req.params.communityId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get community service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  });

  app.post("/api/service-schedules/:scheduleId/log", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = logServiceVisitSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.getServiceScheduleById(req.params.scheduleId as string);
      if (!schedule) {
        return res.status(404).json({ error: "Service schedule not found" });
      }
      const visit = await storage.upsertServiceVisit({
        scheduleId: schedule.id,
        communityId: schedule.communityId,
        serviceDate: parsed.data.serviceDate,
        completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date(),
        completedBy: req.session.userId || null,
        employeeSignOffName: parsed.data.employeeSignOffName,
        notes: parsed.data.notes ?? null,
      });
      res.status(201).json(visit);
    } catch (error) {
      console.error("Log service visit error:", error);
      res.status(500).json({ error: "Failed to log service visit" });
    }
  });

  app.post("/api/admin/import/contract-tasks/parse", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const sheetName = req.body?.sheetName || undefined;
      const result = parseFile(req.file.buffer, req.file.originalname, sheetName);
      res.json(result);
    } catch (error: any) {
      console.error("Parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/admin/import/contract-tasks/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, mappings, mowingConfig, defaultPriority, importMode, parsedData } = req.body;
      if (!communityId || !mappings || !mowingConfig || !parsedData) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!mappings.title || !mappings.windowStart || !mappings.windowEnd) {
        return res.status(400).json({ error: "Title, Window Start, and Window End mappings are required" });
      }
      const result = await generatePreview(
        parsedData,
        communityId,
        mappings,
        mowingConfig,
        defaultPriority || "medium",
        importMode || "create"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/admin/import/contract-tasks/commit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, tasksPreview, mowingSchedulePreview, defaultPriority } = req.body;
      if (!communityId || !tasksPreview) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const result = await commitImport(
        tasksPreview,
        mowingSchedulePreview || null,
        communityId,
        req.session.userId!,
        defaultPriority || "medium"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Commit error:", error);
      res.status(500).json({ error: error.message || "Failed to commit import" });
    }
  });

  app.get("/api/hoa/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      if (!isHoaRole(user.role) || !user.hoaCommunityId) {
        return res.status(403).json({ error: "This endpoint is only available to HOA users" });
      }
      const data = await storage.getHoaDashboardData(user.hoaCommunityId);
      res.json(data);
    } catch (error) {
      console.error("HOA dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch HOA dashboard data" });
    }
  });

  app.get("/api/hoa/requests", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      if (!isHoaRole(user.role) || !user.hoaCommunityId) {
        return res.status(403).json({ error: "This endpoint is only available to HOA users" });
      }
      const requests = await storage.getHoaRequests(user.hoaCommunityId);
      res.json(requests);
    } catch (error) {
      console.error("Get HOA requests error:", error);
      res.status(500).json({ error: "Failed to fetch HOA requests" });
    }
  });

  app.get("/api/hoa/requests/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) {
        return res.status(404).json({ error: "Request not found" });
      }
      if (task.origin !== "HOA") {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (isHoaRole(user.role)) {
        if (user.hoaCommunityId !== task.communityId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else if (user.role === "admin") {
      } else {
        const { allowed } = await storage.canUserAccessTask(user.id, task.id);
        if (!allowed) {
          return res.status(403).json({ error: "Access denied" });
        }
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
  });

  app.post("/api/hoa/requests", requireAuth, async (req: Request, res: Response) => {
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
      if (!user || user.role !== "hoa_admin") {
        return res.status(403).json({ error: "Only HOA Admins can create requests" });
      }

      const communityId = user.hoaCommunityId || req.session.hoaCommunityId;
      if (!communityId) {
        console.error(`[HOA Request] No communityId: user.hoaCommunityId=${user.hoaCommunityId}, session=${req.session.hoaCommunityId}`);
        return res.status(400).json({ error: "No HOA community associated with this user" });
      }
      if (!user.hoaCommunityId && req.session.hoaCommunityId) {
        console.warn(`[HOA Request] Using session fallback for communityId=${communityId}`);
      }

      const parsed = createHoaRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        console.error("[HOA Request] Validation failed:", parsed.error.flatten());
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
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
          return res.status(404).json({ error: "Asset not found" });
        }
        if (asset.communityId !== communityId) {
          return res.status(403).json({ error: "Asset does not belong to your community" });
        }
        latitude = asset.latitude ?? undefined;
        longitude = asset.longitude ?? undefined;
        resolvedAssetId = asset.id;
      } else {
        if (pinLat != null && pinLng != null) {
          latitude = pinLat;
          longitude = pinLng;
        } else if ((pinLat != null) !== (pinLng != null)) {
          return res.status(400).json({ error: "Both pinLat and pinLng must be provided together, or omit both" });
        }
      }

      let validatedAssignedTo: string | undefined;
      if (assignedTo) {
        console.log(`[HOA Request] Calling getCommunityMembers: communityId=${communityId}`);
        const members = await storage.getCommunityMembers(communityId);
        console.log(`[HOA Request] getCommunityMembers done (${Date.now() - startTime}ms), count=${members.length}`);
        const match = members.find((m: any) => m.userId === assignedTo && (m.user.role === 'contractor' || m.user.role === 'admin'));
        if (!match) {
          return res.status(400).json({ error: "Selected contractor is not a member of this community" });
        }
        validatedAssignedTo = assignedTo;
      }

      const mappedPriority = priority === "Urgent" ? "urgent" as const : "medium" as const;

      if (timeoutFired) return;

      console.log(`[HOA Request] Calling createTask: communityId=${communityId}, createdBy=${userId}`);
      const task = await storage.createTask({
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
      });
      console.log(`[HOA Request] createTask done (${Date.now() - startTime}ms), taskId=${task.id}`);

      if (timeoutFired) return;

      if (resolvedAssetId) {
        console.log(`[HOA Request] Calling setTaskLink: taskId=${task.id}, assetId=${resolvedAssetId}`);
        await storage.setTaskLink(task.id, {
          linkType: "asset",
          assetId: resolvedAssetId,
          latitude,
          longitude,
        });
        console.log(`[HOA Request] setTaskLink done (${Date.now() - startTime}ms)`);
      }

      if (timeoutFired) return;

      notifyHoaRequestSubmitted(task).catch(err => console.error("notifyHoaRequestSubmitted error:", err));

      if (!res.headersSent) {
        console.log(`[HOA Request] Success in ${Date.now() - startTime}ms, taskId=${task.id}`);
        res.status(201).json(task);
      }
    } catch (error: any) {
      console.error("[HOA Request] Error:", error);
      if (!timeoutFired && !res.headersSent) {
        res.status(500).json({ error: "Failed to create HOA request" });
      }
    } finally {
      clearTimeout(requestTimer);
    }
  });

  app.get("/api/notification-preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const prefs = await storage.getUserNotificationPreferences(req.session.userId!);
      res.json(prefs);
    } catch (error) {
      console.error("Get notification preferences error:", error);
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  });

  app.put("/api/notification-preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const { taskAssigned, dueReminders, syncFailure, taskCompleted, requestSubmitted, requestCompleted, requestStatusUpdates } = req.body;
      const prefs = {
        taskAssigned: typeof taskAssigned === 'boolean' ? taskAssigned : true,
        dueReminders: typeof dueReminders === 'boolean' ? dueReminders : true,
        syncFailure: typeof syncFailure === 'boolean' ? syncFailure : true,
        taskCompleted: typeof taskCompleted === 'boolean' ? taskCompleted : true,
        requestSubmitted: typeof requestSubmitted === 'boolean' ? requestSubmitted : true,
        requestCompleted: typeof requestCompleted === 'boolean' ? requestCompleted : true,
        requestStatusUpdates: typeof requestStatusUpdates === 'boolean' ? requestStatusUpdates : true,
      };
      await storage.setUserNotificationPreferences(req.session.userId!, prefs);
      res.json(prefs);
    } catch (error) {
      console.error("Set notification preferences error:", error);
      res.status(500).json({ error: "Failed to save notification preferences" });
    }
  });

  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const notifs = await storage.getNotificationsForUser(user.id, limit, offset);
      res.json(notifs);
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  app.put("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.markAllNotificationsRead(req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  app.put("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const notif = await storage.markNotificationRead(req.params.id, req.session.userId!);
      if (!notif) return res.status(404).json({ error: "Notification not found" });
      res.json(notif);
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  });

  const invoiceReadRoles = ['admin', 'property_manager', 'hoa_admin', 'hoa_member'];
  const invoiceMutateRoles = ['admin'];

  app.get("/api/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role === 'contractor') return res.status(403).json({ error: "Access denied" });

      if (user.role === 'admin') {
        const communityId = req.query.communityId as string | undefined;
        const rows = await storage.getInvoices(communityId || undefined);
        return res.json(rows);
      }

      if (isHoaRole(user.role) && user.hoaCommunityId) {
        const rows = await storage.getInvoices(user.hoaCommunityId);
        return res.json(rows);
      }

      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId is required" });
      const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
      if (!isMember) return res.status(403).json({ error: "Access denied" });
      const rows = await storage.getInvoices(communityId);
      return res.json(rows);
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.role === 'contractor') return res.status(403).json({ error: "Access denied" });

      const invoice = await storage.getInvoiceById(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      if (user.role !== 'admin') {
        if (isHoaRole(user.role) && user.hoaCommunityId) {
          if (invoice.communityId !== user.hoaCommunityId) return res.status(403).json({ error: "Access denied" });
        } else {
          const isMember = await storage.isUserMemberOfCommunity(user.id, invoice.communityId);
          if (!isMember) return res.status(403).json({ error: "Access denied" });
        }
      }

      res.json(invoice);
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertInvoiceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      if (parsed.data.attachmentLayerId) {
        const layer = await storage.getMapLayerById(parsed.data.attachmentLayerId);
        if (!layer || layer.communityId !== parsed.data.communityId) {
          return res.status(400).json({ error: "Attachment layer does not belong to the selected community" });
        }
      }
      const invoice = await storage.createInvoice(parsed.data);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.put("/api/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getInvoiceById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });
      const parsed = updateInvoiceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const targetCommunityId = parsed.data.communityId || existing.communityId;
      if (parsed.data.attachmentLayerId) {
        const layer = await storage.getMapLayerById(parsed.data.attachmentLayerId);
        if (!layer || layer.communityId !== targetCommunityId) {
          return res.status(400).json({ error: "Attachment layer does not belong to the selected community" });
        }
      }
      const updated = await storage.updateInvoice(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update invoice error:", error);
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete("/api/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getInvoiceById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });
      await storage.deleteInvoice(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });

  /* ─── Reports ────────────────────────────────────────────────────────── */

  const reportReadRoles = ['admin', 'property_manager', 'hoa_admin', 'hoa_member'];

  async function resolveReportCommunityId(user: any, queryCommunityId: string | undefined, res: Response): Promise<string | null> {
    if (user.role === 'admin') {
      if (!queryCommunityId) { res.status(400).json({ error: "communityId is required" }); return null; }
      return queryCommunityId;
    }
    if (isHoaRole(user.role) && user.hoaCommunityId) {
      return user.hoaCommunityId;
    }
    const communityId = queryCommunityId;
    if (!communityId) { res.status(400).json({ error: "communityId is required" }); return null; }
    const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
    if (!isMember) { res.status(403).json({ error: "Access denied" }); return null; }
    return communityId;
  }

  app.get("/api/reports/water-usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !reportReadRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });
      const communityId = await resolveReportCommunityId(user, req.query.communityId as string | undefined, res);
      if (!communityId) return;

      const rows = await pool.query(
        `SELECT month, year, usage_amount, unit, notes FROM water_usage WHERE community_id = $1 ORDER BY year DESC, month DESC`,
        [communityId]
      );
      res.json(rows.rows);
    } catch (error) {
      console.error("Water usage report error:", error);
      res.status(500).json({ error: "Failed to fetch water usage report" });
    }
  });

  app.get("/api/reports/tree-inventory", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !reportReadRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });
      const communityId = await resolveReportCommunityId(user, req.query.communityId as string | undefined, res);
      if (!communityId) return;

      const rows = await pool.query(
        `SELECT ap.value AS species, COUNT(a.id)::int AS count
         FROM assets a
         LEFT JOIN asset_properties ap ON ap.asset_id = a.id AND ap.key = 'species'
         WHERE a.community_id = $1 AND a.asset_type = 'tree' AND a.is_archived = false
         GROUP BY ap.value
         ORDER BY count DESC, ap.value ASC NULLS LAST`,
        [communityId]
      );
      const totalRows = await pool.query(
        `SELECT COUNT(a.id)::int AS total FROM assets a WHERE a.community_id = $1 AND a.asset_type = 'tree' AND a.is_archived = false`,
        [communityId]
      );
      res.json({ groups: rows.rows, total: totalRows.rows[0]?.total || 0 });
    } catch (error) {
      console.error("Tree inventory report error:", error);
      res.status(500).json({ error: "Failed to fetch tree inventory report" });
    }
  });

  app.get("/api/reports/invoices/monthly", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !reportReadRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });
      const communityId = await resolveReportCommunityId(user, req.query.communityId as string | undefined, res);
      if (!communityId) return;

      const month = parseInt(req.query.month as string, 10);
      const year = parseInt(req.query.year as string, 10);
      if (!month || !year || month < 1 || month > 12) {
        return res.status(400).json({ error: "Valid month (1-12) and year are required" });
      }

      const rows = await pool.query(
        `SELECT id, contractor, completion_date, service_type, cost, notes, pdf_object_key, attachment_label
         FROM invoices
         WHERE community_id = $1
           AND EXTRACT(MONTH FROM completion_date::date) = $2
           AND EXTRACT(YEAR FROM completion_date::date) = $3
         ORDER BY completion_date DESC`,
        [communityId, month, year]
      );

      const grouped: Record<string, { serviceType: string; invoices: any[]; subtotal: number }> = {};
      let total = 0;
      for (const inv of rows.rows) {
        const key = inv.service_type || 'Other';
        if (!grouped[key]) grouped[key] = { serviceType: key, invoices: [], subtotal: 0 };
        grouped[key].invoices.push({
          id: inv.id,
          contractor: inv.contractor,
          completionDate: inv.completion_date,
          serviceType: inv.service_type,
          cost: inv.cost,
          notes: inv.notes,
          pdfObjectKey: inv.pdf_object_key,
          attachmentLabel: inv.attachment_label,
        });
        grouped[key].subtotal += Number(inv.cost || 0);
        total += Number(inv.cost || 0);
      }

      res.json({ groups: Object.values(grouped), total });
    } catch (error) {
      console.error("Monthly invoices report error:", error);
      res.status(500).json({ error: "Failed to fetch monthly invoice report" });
    }
  });

  app.get("/api/contracts", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!['admin', 'property_manager'].includes(user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const communityId = req.query.communityId as string | undefined;
      const contractorUserId = req.query.contractorUserId as string | undefined;

      if (user.role === 'property_manager') {
        if (!communityId) return res.status(400).json({ error: "communityId is required" });
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }

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
  });

  app.get("/api/contracts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!['admin', 'property_manager'].includes(user.role)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const contract = await storage.getContractById(req.params.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });

      if (user.role === 'property_manager') {
        const isMember = await storage.isUserMemberOfCommunity(user.id, contract.communityId);
        if (!isMember) return res.status(403).json({ error: "Access denied" });
      }

      res.json(contract);
    } catch (error) {
      console.error("Get contract error:", error);
      res.status(500).json({ error: "Failed to fetch contract" });
    }
  });

  app.post("/api/contracts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertContractSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      if (parsed.data.startDate && parsed.data.endDate && parsed.data.endDate < parsed.data.startDate) {
        return res.status(400).json({ error: "End date must be on or after start date" });
      }

      const contractorUser = await storage.getUserById(parsed.data.contractorUserId);
      if (!contractorUser || contractorUser.role !== 'contractor') {
        return res.status(400).json({ error: "Selected user is not a contractor" });
      }

      const contract = await storage.createContract(parsed.data);
      res.status(201).json(contract);
    } catch (error) {
      console.error("Create contract error:", error);
      res.status(500).json({ error: "Failed to create contract" });
    }
  });

  app.put("/api/contracts/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContractById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Contract not found" });
      const parsed = updateContractSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const startDate = parsed.data.startDate || existing.startDate;
      const endDate = parsed.data.endDate || existing.endDate;
      if (endDate < startDate) {
        return res.status(400).json({ error: "End date must be on or after start date" });
      }

      if (parsed.data.contractorUserId) {
        const contractorUser = await storage.getUserById(parsed.data.contractorUserId);
        if (!contractorUser || contractorUser.role !== 'contractor') {
          return res.status(400).json({ error: "Selected user is not a contractor" });
        }
      }

      const updated = await storage.updateContract(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update contract error:", error);
      res.status(500).json({ error: "Failed to update contract" });
    }
  });

  app.delete("/api/contracts/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContractById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Contract not found" });
      await storage.deleteContract(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete contract error:", error);
      res.status(500).json({ error: "Failed to delete contract" });
    }
  });

  const driveMutateRoles = ['admin', 'property_manager', 'hoa_admin'];
  const driveReadRoles = ['admin', 'property_manager', 'hoa_admin', 'hoa_member'];

  async function requireDriveAccess(req: Request, res: Response, roles: string[]): Promise<ReturnType<typeof storage.getUserById> | null> {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Access denied" });
      return null;
    }
    return user;
  }

  async function checkCommunityAccess(user: NonNullable<Awaited<ReturnType<typeof storage.getUserById>>>, communityId: string, res: Response): Promise<boolean> {
    if (user.role === 'admin') return true;
    const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
    if (!isMember) {
      res.status(403).json({ error: "Access denied" });
      return false;
    }
    return true;
  }

  app.get("/api/drive", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveReadRoles);
      if (!user) return;
      const communityId = req.query.communityId as string;
      if (!communityId) return res.status(400).json({ error: "communityId is required" });
      if (!(await checkCommunityAccess(user, communityId, res))) return;
      const folderId = (req.query.folderId as string) || null;
      const [folders, files] = await Promise.all([
        storage.getDriveFolders(communityId, folderId),
        storage.getDriveFiles(communityId, folderId),
      ]);
      res.json({ folders, files });
    } catch (error) {
      console.error("Drive list error:", error);
      res.status(500).json({ error: "Failed to list drive contents" });
    }
  });

  app.post("/api/drive/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const parsed = insertDriveFolderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      if (!(await checkCommunityAccess(user, parsed.data.communityId, res))) return;
      if (parsed.data.parentId) {
        const parentFolder = await storage.getDriveFolder(parsed.data.parentId);
        if (!parentFolder || parentFolder.communityId !== parsed.data.communityId) {
          return res.status(400).json({ error: "Parent folder not found or belongs to a different community" });
        }
      }
      const folder = await storage.createDriveFolder({ ...parsed.data, createdBy: user.id });
      res.status(201).json(folder);
    } catch (error) {
      console.error("Create drive folder error:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.patch("/api/drive/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const folder = await storage.getDriveFolder(req.params.id);
      if (!folder) return res.status(404).json({ error: "Folder not found" });
      if (!(await checkCommunityAccess(user, folder.communityId, res))) return;
      const parsed = updateDriveFolderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      const updated = await storage.updateDriveFolder(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update drive folder error:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/drive/folders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const folder = await storage.getDriveFolder(req.params.id);
      if (!folder) return res.status(404).json({ error: "Folder not found" });
      if (!(await checkCommunityAccess(user, folder.communityId, res))) return;
      await storage.deleteDriveFolder(req.params.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === "FOLDER_NOT_EMPTY") {
        return res.status(409).json({ error: "Cannot delete a folder that contains files or subfolders. Please remove its contents first." });
      }
      console.error("Delete drive folder error:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  app.post("/api/drive/files", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const parsed = insertDriveFileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      if (!parsed.data.fileRef.startsWith('/objects/')) {
        return res.status(400).json({ error: "Invalid file reference" });
      }
      if (parsed.data.folderId) {
        const parentFolder = await storage.getDriveFolder(parsed.data.folderId);
        if (!parentFolder || parentFolder.communityId !== parsed.data.communityId) {
          return res.status(400).json({ error: "Folder not found or belongs to a different community" });
        }
      }
      if (!(await checkCommunityAccess(user, parsed.data.communityId, res))) return;
      const file = await storage.createDriveFile({ ...parsed.data, uploadedBy: user.id });
      res.status(201).json(file);
    } catch (error) {
      console.error("Create drive file error:", error);
      res.status(500).json({ error: "Failed to create file record" });
    }
  });

  app.patch("/api/drive/files/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const file = await storage.getDriveFile(req.params.id);
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const parsed = updateDriveFileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      const updated = await storage.updateDriveFile(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update drive file error:", error);
      res.status(500).json({ error: "Failed to update file" });
    }
  });

  app.delete("/api/drive/files/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveMutateRoles);
      if (!user) return;
      const file = await storage.getDriveFile(req.params.id);
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObject(file.fileRef);
      await storage.deleteDriveFile(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete drive file error:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  app.get("/api/drive/files/:id/download", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, driveReadRoles);
      if (!user) return;
      const file = await storage.getDriveFile(req.params.id);
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(file.fileRef);
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "File not found in storage" });
      }
      console.error("Drive file download error:", error);
      res.status(500).json({ error: "Failed to download file" });
    }
  });

  /* ─── Contacts ──────────────────────────────────────────────────────────── */

  app.get("/api/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });

      if (user.role === "admin") {
        const communityId = req.query.communityId as string | undefined;
        const results = await storage.getContacts(communityId || undefined);
        return res.json(results);
      }

      if (user.role === "property_manager") {
        const communityId = req.query.communityId as string | undefined;
        if (communityId) {
          const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
          if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
          const results = await storage.getContacts(communityId);
          return res.json(results);
        }
        // No communityId filter: return contacts for all PM's authorized communities
        const pmCommunities = await storage.getUserCommunitiesList(user.id);
        const pmCommunityIds = pmCommunities.map(c => c.id);
        if (pmCommunityIds.length === 0) return res.json([]);
        const results = await storage.getContactsForCommunities(pmCommunityIds);
        return res.json(results);
      }

      if (isHoaRole(user.role) && user.hoaCommunityId) {
        const results = await storage.getContacts(user.hoaCommunityId);
        return res.json(results);
      }

      return res.status(403).json({ error: "Access denied" });
    } catch (err) {
      console.error("Get contacts error:", err);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.post("/api/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const contactsWriteRoles = ["admin", "property_manager", "hoa_admin"];
      if (!contactsWriteRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });

      const parsed = insertContactSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId } = parsed.data;

      if (user.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }

      if (isHoaRole(user.role) && user.hoaCommunityId && communityId !== user.hoaCommunityId) {
        return res.status(403).json({ error: "Cannot create contacts for other communities" });
      }

      const contact = await storage.createContact({
        communityId,
        name: parsed.data.name,
        title: parsed.data.title ?? null,
        company: parsed.data.company ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        contactType: parsed.data.contactType,
        notes: parsed.data.notes ?? null,
      });
      res.status(201).json(contact);
    } catch (err) {
      console.error("Create contact error:", err);
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  app.put("/api/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const contactsWriteRoles = ["admin", "property_manager", "hoa_admin"];
      if (!contactsWriteRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });

      const contact = await storage.getContactById(req.params.id);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      if (user.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, contact.communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }

      if (user.role === "hoa_admin" && user.hoaCommunityId && contact.communityId !== user.hoaCommunityId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parsed = updateContactSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      // Validate communityId changes are authorized
      if (parsed.data.communityId && parsed.data.communityId !== contact.communityId) {
        if (user.role === "hoa_admin") {
          return res.status(403).json({ error: "Cannot move contacts to another community" });
        }
        if (user.role === "property_manager") {
          const isMember = await storage.isUserMemberOfCommunity(user.id, parsed.data.communityId);
          if (!isMember) return res.status(403).json({ error: "Not a member of the target community" });
        }
        // admin: unrestricted
      }

      const updated = await storage.updateContact(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ error: "Contact not found" });
      res.json(updated);
    } catch (err) {
      console.error("Update contact error:", err);
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.delete("/api/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const contactsWriteRoles = ["admin", "property_manager", "hoa_admin"];
      if (!contactsWriteRoles.includes(user.role)) return res.status(403).json({ error: "Access denied" });

      const contact = await storage.getContactById(req.params.id);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      if (user.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, contact.communityId);
        if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      }

      if (user.role === "hoa_admin" && user.hoaCommunityId && contact.communityId !== user.hoaCommunityId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteContact(req.params.id);
      res.status(204).send();
    } catch (err) {
      console.error("Delete contact error:", err);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
