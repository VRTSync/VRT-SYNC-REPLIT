import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { requireAuth, requireAdmin, registerAuthRoutes, setupSession } from "./auth";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import * as storage from "./storage";
import { notifyTaskAssigned, sendDueReminders } from "./pushNotifications";
import { syncAssetsFromLayer, getMissingRequiredKeys, ASSET_TYPE_TEMPLATES } from "./assetSync";
import {
  insertCommunitySchema, insertTaskSchema, completeTaskSchema, registerPushTokenSchema,
  insertAssetSchema, updateAssetSchema, upsertAssetPropertiesSchema, setTaskLinkSchema,
  insertMapLayerSchema, updateMapLayerSchema, insertOfflinePackSchema,
} from "@shared/schema";

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
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const member = await storage.addCommunityMember(req.params.id as string, userId);
      res.status(201).json(member);
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
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate as any) : undefined,
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
      const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, communityId);
      if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
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
      const isMember = await storage.isUserMemberOfCommunity(req.session.userId!, layer.communityId);
      if (!isMember) return res.status(403).json({ error: "Not a member of this community" });
      if (!layer.geojsonData) return res.json(null);
      res.setHeader("Content-Type", "application/json");
      res.send(layer.geojsonData);
    } catch (error) {
      console.error("Get geojson error:", error);
      res.status(500).json({ error: "Failed to fetch GeoJSON" });
    }
  });

  app.post("/api/map-layers", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertMapLayerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const layer = await storage.createMapLayer(parsed.data);
      let syncResult = null;
      if (layer.geojsonData) {
        syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData);
      }
      const { geojsonData, ...rest } = layer;
      res.status(201).json({ ...rest, syncResult });
    } catch (error: any) {
      if (error?.constraint === "map_layers_community_layer_sub_idx") {
        return res.status(409).json({ error: "A layer with that key combination already exists" });
      }
      console.error("Create map layer error:", error);
      res.status(500).json({ error: "Failed to create map layer" });
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
      if (parsed.data.geojsonData) {
        syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData);
      }
      const { geojsonData, ...rest } = updated;
      res.json({ ...rest, syncResult });
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

      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId),
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

      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId),
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
      });
    } catch (error) {
      console.error("Get offline pack data error:", error);
      res.status(500).json({ error: "Failed to fetch offline pack data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
