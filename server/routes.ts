import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import bcrypt from "bcryptjs";
import { requireAuth, requireAdmin, registerAuthRoutes, setupSession } from "./auth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import * as storage from "./storage";
import { notifyTaskAssigned, sendDueReminders } from "./pushNotifications";
import { syncAssetsFromLayer, syncIrrigationAssets, getMissingRequiredKeys, ASSET_TYPE_TEMPLATES, previewSyncFromLayer, getUnlinkedFeatures, getGeoJsonCollisions, resolveAssetType, extractFeatureId, extractLabel, resolveGeometry } from "./assetSync";
import { parseIrrigationKml } from "./kmlIrrigationParser";
import { validateLayerGeoJSON } from "./layerValidation";
import { validateLayerKeys, CANONICAL_LAYER_HIERARCHY } from "./layerKeys";
import { convertKmlToGeojson, normalizeGeojsonFeatureIds } from "./kmlConverter";
import {
  insertCommunitySchema, insertTaskSchema, completeTaskSchema, registerPushTokenSchema,
  insertAssetSchema, updateAssetSchema, upsertAssetPropertiesSchema, setTaskLinkSchema,
  insertMapLayerSchema, updateMapLayerSchema, insertOfflinePackSchema,
  insertTaskTemplateSchema, generateFromTemplateSchema, insertTaskScheduleSchema,
} from "@shared/schema";
import { runDueSchedules, computeInitialNextRunAt } from "./scheduler";
import { runExportGeneration } from "./exportGenerator";
import { exports as exportsTable } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export async function registerRoutes(app: Express): Promise<Server> {
  setupSession(app);
  registerAuthRoutes(app);

  app.get("/public-objects/{filePath}", async (req: Request, res: Response) => {
    const filePath = req.params.filePath as string;
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

  app.get("/objects/{objectPath}", requireAuth, async (req: Request, res: Response) => {
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
    const { uploadURL } = req.body;
    if (!uploadURL) {
      return res.status(400).json({ error: "uploadURL is required" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, {
        owner: req.session.userId!,
        visibility: "public",
      });
      res.json({ objectPath });
    } catch (error) {
      console.error("Confirm upload error:", error);
      res.status(500).json({ error: "Failed to confirm upload" });
    }
  });

  app.get("/api/communities", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (user?.role === "admin") {
        const allCommunities = await storage.getCommunities();
        return res.json(allCommunities);
      }
      const memberships = await storage.getUserCommunities(req.session.userId!);
      res.json(memberships.map((m) => m.community));
    } catch (error) {
      console.error("Get communities error:", error);
      res.status(500).json({ error: "Failed to fetch communities" });
    }
  });

  app.post("/api/communities", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertCommunitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const community = await storage.createCommunity({
        name: parsed.data.name,
        description: parsed.data.description ?? undefined,
      });
      res.status(201).json(community);
    } catch (error) {
      console.error("Create community error:", error);
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

  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const communityId = req.query.communityId as string | undefined;

      if (user.role === "admin") {
        if (communityId) {
          const allTasks = await storage.getTasksByCommunity(communityId);
          return res.json(allTasks);
        }
        const allTasks = await storage.getAllTasks();
        return res.json(allTasks);
      }

      if (communityId) {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const userTasks = await storage.getTasksForUser(req.session.userId!, communityId);
      res.json(userTasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed, task } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      res.json(task);
    } catch (error) {
      console.error("Get task error:", error);
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
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
      if (data.startDate) {
        data.startDate = new Date(data.startDate);
      }
      if (data.dueDate) {
        data.dueDate = new Date(data.dueDate);
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

      res.json(updated);
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ error: "Failed to update task" });
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

      res.json({ task: updated, completion });
    } catch (error) {
      console.error("Complete task error:", error);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.post("/api/tasks/:id/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const { allowed } = await storage.canUserAccessTask(req.session.userId!, req.params.id as string);
      if (!allowed) {
        return res.status(403).json({ error: "You do not have access to this task" });
      }
      const { taskCompletionId, uploadURL, idempotencyKey } = req.body;
      if (!taskCompletionId || !uploadURL || !idempotencyKey) {
        return res.status(400).json({ error: "taskCompletionId, uploadURL, and idempotencyKey are required" });
      }

      const existing = await storage.getAttachmentByIdempotencyKey(taskCompletionId, idempotencyKey);
      if (existing) {
        return res.status(200).json(existing);
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadURL, {
        owner: req.session.userId!,
        visibility: "public",
      });

      const attachment = await storage.createAttachment({
        taskCompletionId,
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

      const existing = await storage.getAttachmentByIdempotencyKey(completionId, idempotencyKey);
      if (existing) {
        return res.status(200).json(existing);
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

  app.get("/api/contractors", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const contractors = await storage.getAllContractors();
      res.json(contractors.map(({ password: _, ...c }) => c));
    } catch (error) {
      console.error("Get contractors error:", error);
      res.status(500).json({ error: "Failed to fetch contractors" });
    }
  });

  app.get("/api/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers.map(({ password: _, ...u }) => u));
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.put("/api/users/:id/role", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role } = req.body;
      if (role !== "admin" && role !== "contractor") {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }
      const updated = await storage.updateUserRole(req.params.id as string, role);
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
      const { username, password, displayName, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "username and password are required" });
      }
      if (role && role !== "contractor" && role !== "admin") {
        return res.status(400).json({ error: "role must be contractor or admin" });
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
      });
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
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

  app.post("/api/push-tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = registerPushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const pushToken = await storage.registerPushToken(
        req.session.userId!,
        parsed.data.token,
        parsed.data.platform,
        parsed.data.deviceId,
      );
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
      } else if (token) {
        await storage.removePushToken(req.session.userId!, token);
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
      res.json({ ...asset, properties, missingRequiredKeys, workHistorySummary: { totalTasks: 0, completedTasks: 0 } });
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

  app.post("/api/assets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.createAsset(parsed.data);
      res.status(201).json(asset);
    } catch (error) {
      console.error("Create asset error:", error);
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.patch("/api/assets/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = updateAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { version, ...data } = parsed.data;
      const updated = await storage.updateAsset(req.params.id as string, version, data);
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
      console.error("Update asset error:", error);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.put("/api/assets/:id/properties", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = upsertAssetPropertiesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      const properties = await storage.upsertAssetProperties(asset.id, parsed.data.properties);
      res.json(properties);
    } catch (error) {
      console.error("Upsert properties error:", error);
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

      const layer = await storage.createMapLayer(parsed.data);
      let syncResult = null;
      let featureCount = 0;
      if (layer.geojsonData) {
        try {
          const geo = JSON.parse(layer.geojsonData);
          featureCount = geo.features?.length || 0;
        } catch {}
        syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData);
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
        const syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData);
        const { geojsonData: _, ...rest } = updated;
        return res.json({ ...rest, featureCount, syncResult });
      } else {
        const layer = await storage.createMapLayer({
          communityId,
          layerKey,
          subLayerKey,
          displayName,
          sourceFormat,
          geojsonData,
        });
        const syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData);
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
        });
      }

      const syncResult = await syncIrrigationAssets(
        communityId,
        controllerLayer.id,
        zoneLayer.id,
        parseResult.controllers,
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
        syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData);
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

  app.get("/api/assets/by-feature", requireAuth, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      const featureRef = req.query.featureRef as string;
      if (!communityId || !featureRef) return res.status(400).json({ error: "communityId and featureRef are required" });
      const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, communityId);
      if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
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

  app.post("/api/map-layers/:id/sync-assets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return res.status(404).json({ error: "Layer not found" });
      const result = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData);
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
          await storage.createAssetFromFeature({
            communityId: layer.communityId,
            assetType: assetType as any,
            label,
            featureRef: item.featureId,
            mapLayerId: layer.id,
            geometryType,
            latitude: lat,
            longitude: lng,
          });
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
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
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

  const httpServer = createServer(app);
  return httpServer;
}
