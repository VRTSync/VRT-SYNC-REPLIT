import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { insertTaskSchema, completeTaskSchema, updateTaskManagerSchema, updateTaskFieldSchema, setTaskLinkSchema } from "@workspace/db";
import { notifyTaskAssigned, notifyTaskCompleted, notifyRequestAcknowledged } from "../pushNotifications";
import { ObjectStorageService, ObjectNotFoundError, ObjectForbiddenError, parseUploadURL } from "../objectStorage";
import { buildCommunityAclPolicy } from "../objectAcl";
import { upload } from "./upload";
import { route } from "./handler";

export function registerTaskRoutes(app: Express): void {
  app.get("/api/tasks/page-data", requireAuth, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return void res.status(401).json({ error: "User not found" });
      }
      const actor = policy.actorFrom(req);
      const scope = policy.taskListScope(actor, "page-data");

      let communityId: string | null = (req.query.communityId as string | undefined) ?? null;

      if (scope.hoaCommunityId) {
        communityId = scope.hoaCommunityId;
      } else if (!communityId && scope.defaultCommunity) {
        const memberships = await storage.getUserCommunities(user.id);
        communityId = memberships.length > 0 ? memberships[0].community.id : null;
      }

      policy.assertCan(await policy.canListTasks(actor, communityId, "page-data"), "You are not a member of this community");

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

      res.json(storage.toTaskResponse(viewModel, user));
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get task page data error:");
      res.status(500).json({ error: "Failed to fetch task page data" });
    }
  }));

  app.get("/api/tasks", requireAuth, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return void res.status(401).json({ error: "User not found" });
      }
      const actor = policy.actorFrom(req);
      const scope = policy.taskListScope(actor, "list");
      let communityId = req.query.communityId as string | undefined;

      if (scope.hoaCommunityId) {
        communityId = scope.hoaCommunityId;
        const rawTasks = await storage.getTasksByCommunity(communityId);
        const tasks = await storage.enrichTasksWithAssigneeName(rawTasks);
        console.log(`[GET /api/tasks] hoa user=${user.id} community=${communityId} count=${tasks.length} (${Date.now() - t0}ms)`);
        return void res.json(tasks);
      }

      if (scope.communityWide) {
        if (communityId) {
          policy.assertCan(await policy.canListTasks(actor, communityId), "You are not a member of this community");
          const rawTasks = await storage.getTasksByCommunity(communityId);
          const allTasks = await storage.enrichTasksWithAssigneeName(rawTasks);
          console.log(`[GET /api/tasks] role=${user.role} community=${communityId} count=${allTasks.length} (${Date.now() - t0}ms)`);
          return void res.json(allTasks);
        }
        if (scope.allCommunities) {
          const rawTasks = await storage.getAllTasks();
          const allTasks = await storage.enrichTasksWithAssigneeName(rawTasks);
          console.log(`[GET /api/tasks] admin all-tasks count=${allTasks.length} (${Date.now() - t0}ms)`);
          return void res.json(allTasks);
        }
        return void res.json([]);
      }

      if (!communityId && scope.defaultCommunity) {
        const memberships = await storage.getUserCommunities(user.id);
        if (memberships.length > 0) {
          communityId = memberships[0].community.id;
        }
      }

      policy.assertCan(await policy.canListTasks(actor, communityId), "You are not a member of this community");

      const rawUserTasks = await storage.getTasksForUser(req.session.userId!, communityId);
      const userTasks = await storage.enrichTasksWithAssigneeName(rawUserTasks);
      console.log(`[GET /api/tasks] user=${user.id} community=${communityId ?? "none"} count=${userTasks.length} (${Date.now() - t0}ms)`);
      res.json(storage.toTaskResponse(userTasks, user));
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get tasks error:");
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  }));

  app.get("/api/tasks/:id", requireAuth, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const task = await storage.getTaskById(req.params.id as string);
      const allowed = !!task && await policy.canReadTask(policy.actorFrom(req), task);
      if (!task) {
        console.log(`[GET /api/tasks/:id] task=${req.params.id} not found (${Date.now() - t0}ms)`);
        return void res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        console.log(`[GET /api/tasks/:id] task=${req.params.id} access denied for user=${req.session.userId} (${Date.now() - t0}ms)`);
        return void res.status(403).json({ error: "You do not have access to this task" });
      }
      console.log(`[GET /api/tasks/:id] task=${req.params.id} served (${Date.now() - t0}ms)`);
      res.json(storage.toTaskView(task, (await storage.getUserById(req.session.userId!))!));
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get task error:");
      res.status(500).json({ error: "Failed to fetch task" });
    }
  }));

  app.get("/api/tasks/:id/detail", requireAuth, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const taskId = req.params.id as string;
      const task = await storage.getTaskById(taskId);
      const allowed = !!task && await policy.canReadTask(policy.actorFrom(req), task);
      if (!task) return void res.status(404).json({ error: "Task not found" });
      if (!allowed) return void res.status(403).json({ error: "You do not have access to this task" });

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
      res.json({ task: storage.toTaskView({ ...task, assignedToName }, (await storage.getUserById(req.session.userId!))!), completions, taskAttachments, taskLink: taskLink ?? null });
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get task detail bundle error:");
      res.status(500).json({ error: "Failed to fetch task detail" });
    }
  }));

  app.post("/api/tasks", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFrom(req);
      policy.assertCan(policy.canStartTaskCreation(actor), "Only admins and property managers can create tasks");
      const parsed = insertTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      policy.assertCan(!policy.hasFixedTaskCompany(actor) || !!actor.companyId, "Access denied");
      policy.assertCan(await policy.canCreateTask(actor, parsed.data.communityId), "You are not a member of this community");
      if (parsed.data.assignedTo) {
        const assignee = await storage.validateTaskAssignee(parsed.data.communityId, parsed.data.assignedTo);
        if (!policy.canAssignTaskTo(actor, assignee)) {
          return void res.status(400).json({ error: "Assignee works for a different contractor" });
        }
      }
      const task = await storage.createTask({
        contractorCompanyId: policy.hasFixedTaskCompany(actor) ? actor.companyId : parsed.data.contractorCompanyId,
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
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      req.log?.error({ err: error }, "Create task error:");
      res.status(500).json({ error: "Failed to create task" });
    }
  }));

  app.put("/api/tasks/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const task = await storage.getTaskById(req.params.id as string);
      const allowed = !!task && await policy.canReadTask(policy.actorFrom(req), task);
      if (!task) {
        return void res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task" });
      }
      const updatingUser = await storage.getUserById(req.session.userId!);
      const actor = policy.actorFrom(req);
      const editLevel = await policy.taskEditLevel(actor, task);
      policy.assertCan(!!editLevel, "You cannot edit this task");
      const isManager = editLevel === "manager" || editLevel === "manager_fixed_company";
      const { version, ...input } = req.body;
      if (typeof version !== "number") {
        return void res.status(400).json({ error: "version is required" });
      }
      if (input.status === "completed" && !policy.canSetCompletedStatus(actor)) {
        return void res.status(400).json({ error: "Use the completion form to complete a task" });
      }
      const schema = editLevel === "manager_fixed_company"
        ? updateTaskManagerSchema.omit({ contractorCompanyId: true })
        : isManager ? updateTaskManagerSchema : updateTaskFieldSchema;
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const data: ReturnType<typeof updateTaskManagerSchema.parse> = parsed.data;
      if (editLevel === "manager_fixed_company") delete data.contractorCompanyId;
      if (data.assignedTo !== undefined && data.assignedTo !== null) {
        await storage.validateTaskAssignee(task.communityId, data.assignedTo);
      }

      if (task!.origin === "HOA") {
        // Preserve the existing explicit priority-lock response, even though the
        // field-worker schema has already stripped this key from writable data.
        if (!policy.canEditHoaTaskPriority(actor) && input.priority !== undefined) {
          return void res.status(403).json({ error: "Contractors cannot change priority on HOA requests" });
        }
        if (data.status === "acknowledged") {
          policy.assertCan(policy.canAcknowledgeHoaTask(actor), "Only contractors and admins can acknowledge HOA requests");
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
              return void res.status(400).json({ error: "HOA requests must be completed via the completion form, not status update" });
            }
            return void res.status(400).json({ error: `Invalid HOA request status transition: ${currentStatus} → ${newStatus}` });
          }
        }
      }

      if (data.windowStart) {
        data.windowStart = String(data.windowStart);
      }
      if (data.windowEnd) {
        data.windowEnd = String(data.windowEnd);
      }
      const previousAssignee = task!.assignedTo;
      const updated = await storage.updateTask(req.params.id as string, version, {
        ...data,
        startDate: typeof data.startDate === "string" ? new Date(data.startDate) : data.startDate,
        dueDate: typeof data.dueDate === "string" ? new Date(data.dueDate) : data.dueDate,
      });
      if (!updated) {
        const latest = await storage.getTaskById(req.params.id as string);
        return void res.status(409).json({
          error: "Conflict: task was modified by another user. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: storage.toTaskResponse(latest, updatingUser!),
        });
      }

      if (updated.assignedTo && updated.assignedTo !== previousAssignee) {
        const community = await storage.getCommunityById(updated.communityId);
        notifyTaskAssigned(updated.id, updated.title, community?.name || 'Unknown', updated.assignedTo).catch(() => {});
      }

      if (updated.origin === "HOA" && data.status === "acknowledged") {
        notifyRequestAcknowledged(updated.id).catch(() => {});
      }

      res.json(storage.toTaskView(updated, updatingUser!));
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      req.log?.error({ err: error }, "Update task error:");
      res.status(500).json({ error: "Failed to update task" });
    }
  }));

  app.delete("/api/tasks/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      policy.assertCan(policy.canDeleteTask(policy.actorFrom(req)), "Admin access required");
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) {
        return void res.status(404).json({ error: "Task not found" });
      }
      await storage.deleteTask(req.params.id as string);
      res.json({ message: "Task deleted" });
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Delete task error:");
      res.status(500).json({ error: "Failed to delete task" });
    }
  }));

  app.post("/api/tasks/:id/complete", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const existingTask = await storage.getTaskById(req.params.id as string);
      const allowed = !!existingTask && await policy.canReadTask(policy.actorFrom(req), existingTask);
      if (!existingTask) {
        return void res.status(404).json({ error: "Task not found" });
      }
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task" });
      }
      const completingUser = await storage.getUserById(req.session.userId!);
      const actor = policy.actorFrom(req);
      policy.assertCan(await policy.canCompleteTask(actor, existingTask), "Only the assigned contractor can complete this task");

      if (existingTask.origin === "HOA" && existingTask.status !== "acknowledged" && existingTask.status !== "in_progress") {
        return void res.status(400).json({ error: "HOA requests must be acknowledged or in progress before completing" });
      }

      const parsed = completeTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      if (existingTask.version !== parsed.data.version) {
        return void res.status(409).json({
          error: "Conflict: task was modified by another user. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: storage.toTaskView(existingTask, completingUser!),
        });
      }

      if (!policy.canCompleteOutsideTaskWindow(actor) && existingTask.windowStart && existingTask.windowEnd) {
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
        const today = new Date(todayStr + 'T00:00:00');
        const wsVal = typeof existingTask.windowStart === 'object' ? (existingTask.windowStart as Date).toISOString().split('T')[0] : String(existingTask.windowStart).split('T')[0];
        const weVal = typeof existingTask.windowEnd === 'object' ? (existingTask.windowEnd as Date).toISOString().split('T')[0] : String(existingTask.windowEnd).split('T')[0];
        const startDate = new Date(wsVal + 'T00:00:00');
        const endDate = new Date(weVal + 'T00:00:00');
        if (today < startDate || today > endDate) {
          return void res.status(400).json({
            error: "This task can only be completed within its execution window.",
            code: "OUTSIDE_EXECUTION_WINDOW",
            windowStart: existingTask.windowStart,
            windowEnd: existingTask.windowEnd,
          });
        }
      }

      const result = await storage.completeTaskAtomically(req.params.id as string, parsed.data.version, {
        completedBy: req.session.userId!,
        notes: parsed.data.notes,
        employeeSignOffName: parsed.data.employeeSignOffName,
        timeSpentMinutes: parsed.data.timeSpentMinutes,
        materialsUsed: parsed.data.materialsUsed,
        followUpNeeded: parsed.data.followUpNeeded,
      });
      const updated = result?.task;
      if (!updated) {
        const latest = await storage.getTaskById(req.params.id as string);
        return void res.status(409).json({
          error: "Conflict: task was modified by another user.",
          code: "VERSION_CONFLICT",
          latestTask: storage.toTaskResponse(latest, completingUser!),
        });
      }

      const completion = result!.completion;

      notifyTaskCompleted(updated).catch(err => console.error("notifyTaskCompleted error:", err));

      res.json({ task: storage.toTaskView(updated, completingUser!), completion });
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Complete task error:");
      res.status(500).json({ error: "Failed to complete task" });
    }
  }));

  app.post("/api/tasks/:id/attachments", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const accessTask = await storage.getTaskById(taskId);
      const allowed = !!accessTask && await policy.canReadTask(policy.actorFrom(req), accessTask);
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task" });
      }
      const { taskCompletionId, uploadURL, idempotencyKey } = req.body;
      if (taskCompletionId) {
        const completion = await storage.getCompletionById(taskCompletionId);
        if (!completion || completion.taskId !== taskId) {
          return void res.status(403).json({ error: "Completion does not belong to this task" });
        }
      }
      if (!uploadURL || !idempotencyKey) {
        return void res.status(400).json({ error: "uploadURL and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      if (strictValidation) {
        const parsed = parseUploadURL(uploadURL);
        if (!parsed.valid) {
          return void res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
        }
      }

      if (taskCompletionId) {
        const existing = await storage.getAttachmentByIdempotencyKey(taskCompletionId, idempotencyKey);
        if (existing) {
          return void res.status(200).json(existing);
        }
      } else {
        const existing = await storage.getAttachmentByTaskIdAndIdempotencyKey(taskId, idempotencyKey);
        if (existing) {
          return void res.status(200).json(existing);
        }
      }

      const task = await storage.getTaskById(taskId);
      const objectStorageService = new ObjectStorageService();
      const aclPolicy = task?.communityId
        ? buildCommunityAclPolicy(req.session.userId!, task.communityId)
        : { owner: req.session.userId!, visibility: "private" as const };
      let objectPath: string;
      try {
        objectPath = await objectStorageService.claimObjectForCaller(uploadURL, req.session.userId!, aclPolicy);
      } catch (error) {
        if (strictValidation && error instanceof ObjectNotFoundError) {
          return void res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
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
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof ObjectForbiddenError) {
        return void res.status(403).json({ error: "You do not own this file" });
      }
      req.log?.error({ err: error }, "Create attachment error:");
      res.status(500).json({ error: "Failed to create attachment" });
    }
  }));

  app.post("/api/task-completions/:id/attachments", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const completionId = req.params.id as string;
      const completion = await storage.getCompletionById(completionId);
      if (!completion) {
        return void res.status(404).json({ error: "Completion not found" });
      }
      const accessTask = await storage.getTaskById(completion.taskId);
      const allowed = !!accessTask && await policy.canReadTask(policy.actorFrom(req), accessTask);
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task completion" });
      }
      const { fileRef, url, idempotencyKey } = req.body;
      if (!fileRef || !url || !idempotencyKey) {
        return void res.status(400).json({ error: "fileRef, url, and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      let validatedHttpsUrl: string | undefined;
      if (strictValidation) {
        const candidateUrl = url.startsWith("https://") ? url : fileRef.startsWith("https://") ? fileRef : undefined;
        if (candidateUrl) {
          const parsed = parseUploadURL(candidateUrl);
          if (!parsed.valid) {
            return void res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
          }
          validatedHttpsUrl = candidateUrl;
        }
      }

      const existing = await storage.getAttachmentByIdempotencyKey(completionId, idempotencyKey);
      if (existing) {
        return void res.status(200).json(existing);
      }

      if (strictValidation && validatedHttpsUrl) {
        const objectStorageService = new ObjectStorageService();
        const normalizedPath = objectStorageService.normalizeObjectEntityPath(validatedHttpsUrl);
        if (normalizedPath.startsWith("/objects/")) {
          try {
            await objectStorageService.getObjectEntityFile(normalizedPath);
          } catch (error) {
            if (error instanceof ObjectNotFoundError) {
              return void res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
            }
            throw error;
          }
        }
      }

      const task = await storage.getTaskById(completion.taskId);
      if (task?.communityId && fileRef.startsWith("/objects/")) {
        const objectStorageService = new ObjectStorageService();
        await objectStorageService.claimObjectForCaller(
          fileRef,
          req.session.userId!,
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
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof ObjectForbiddenError) {
        return void res.status(403).json({ error: "You do not own this file" });
      }
      req.log?.error({ err: error }, "Create attachment (completion) error:");
      res.status(500).json({ error: "Failed to create attachment" });
    }
  }));

  app.get("/api/task-completions/:id/attachments", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const completionId = req.params.id as string;
      const completion = await storage.getCompletionById(completionId);
      if (!completion) {
        return void res.status(404).json({ error: "Completion not found" });
      }
      const accessTask = await storage.getTaskById(completion.taskId);
      const allowed = !!accessTask && await policy.canReadTask(policy.actorFrom(req), accessTask);
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task completion" });
      }
      const atts = await storage.getAttachmentsByCompletion(completionId);
      res.json(atts);
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "List attachments error:");
      res.status(500).json({ error: "Failed to fetch attachments" });
    }
  }));

  app.get("/api/tasks/:id/completions", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const accessTask = await storage.getTaskById(req.params.id as string);
      const allowed = !!accessTask && await policy.canReadTask(policy.actorFrom(req), accessTask);
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task" });
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
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get completions error:");
      res.status(500).json({ error: "Failed to fetch completions" });
    }
  }));

  app.get("/api/tasks/:id/task-attachments", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const task = await storage.getTaskById(taskId);
      const allowed = !!task && await policy.canReadTask(policy.actorFrom(req), task);
      if (!allowed) {
        return void res.status(403).json({ error: "You do not have access to this task" });
      }
      const atts = await storage.getAttachmentsByTaskId(taskId);
      res.json(atts);
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get task attachments error:");
      res.status(500).json({ error: "Failed to fetch task attachments" });
    }
  }));

  app.put("/api/tasks/:id/link", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      policy.assertCan(policy.canEditTaskLink(policy.actorFrom(req)), "Admin access required");
      const parsed = setTaskLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const task = await storage.getTaskById(req.params.id as string);
      if (!task) return void res.status(404).json({ error: "Task not found" });
      if (task.version !== parsed.data.version) {
        return void res.status(409).json({
          error: "Conflict: task was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestTask: task,
        });
      }
      const { version: _, ...linkData } = parsed.data;
      const link = await storage.setTaskLink(task.id, linkData);
      res.json(link);
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Set task link error:");
      res.status(500).json({ error: "Failed to set task link" });
    }
  }));

  app.get("/api/tasks/:id/link", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const task = await storage.getTaskById(req.params.id as string);
      const allowed = !!task && await policy.canReadTask(policy.actorFrom(req), task);
      if (!task) return void res.status(404).json({ error: "Task not found" });
      if (!allowed) return void res.status(403).json({ error: "You do not have access to this task" });
      const link = await storage.getTaskLink(task.id);
      res.json(link);
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      req.log?.error({ err: error }, "Get task link error:");
      res.status(500).json({ error: "Failed to fetch task link" });
    }
  }));

  app.post("/api/tasks/bulk/assign", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const actor = policy.actorFrom(req);
      policy.assertCan(policy.canBulkAssign(actor), "Admin access required");
      const { taskIds, assignedTo } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0 || !assignedTo) {
        return void res.status(400).json({ error: "taskIds[] and assignedTo are required" });
      }
      const count = await storage.bulkAssignTasks(taskIds, assignedTo, policy.hasFixedTaskCompany(actor) ? actor.id : undefined);
      res.json({ updated: count });
    } catch (error) {
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      if (error instanceof storage.WorkAccessError) return void res.status(403).json({ error: error.message });
      req.log?.error({ err: error }, "Bulk assign error:");
      res.status(500).json({ error: "Failed to bulk assign tasks" });
    }
  }));

  app.post("/api/tasks/import-csv", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      policy.assertCan(policy.canImportTasks(policy.actorFrom(req)), "Admin access required");
      const { parse } = await import("csv-parse/sync");
      const communityId = req.body.communityId;
      const mode = req.body.mode || "preview"; // "preview" or "commit"

      if (!communityId) {
        return void res.status(400).json({ error: "communityId is required" });
      }

      const community = await storage.getCommunityById(communityId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      if (!req.file) {
        return void res.status(400).json({ error: "CSV file is required" });
      }

      if (req.body.assignedTo) await storage.validateTaskAssignee(communityId, req.body.assignedTo);
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
        return void res.status(400).json({ error: "CSV file is empty" });
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
        const r = records[i] as any;
        const title = r["Ticket Title"] || r["Title"] || r["title"] || "";
        const assignedTo = r["Assigned To"] || r["assigned_to"] || r["assignedTo"] || req.body.assignedTo || undefined;
        if (assignedTo) await storage.validateTaskAssignee(communityId, assignedTo);
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
          assignedTo,
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
        return void res.json({
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
            assignedTo: row.assignedTo,
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
      if (error instanceof policy.ForbiddenError || error instanceof policy.UnauthenticatedError) throw error;
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      req.log?.error({ err: error }, "CSV import error:");
      res.status(500).json({ error: error.message || "Failed to import CSV" });
    }
  }));
}
