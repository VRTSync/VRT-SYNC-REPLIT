import { eq, and, desc, asc, ne, inArray, gte, lte, lt, gt, isNotNull, isNull, ilike, or, sql, count } from "drizzle-orm";
import { db } from "./db";
import {
  users, communities, communityMembers, tasks, taskCompletions, attachments, pushTokens,
  assets, assetProperties, taskLinks, mapLayers, offlinePacks, taskTemplates, templateRuns,
  taskSchedules, scheduleRuns, scheduleRunItems, serviceSchedules, serviceVisits, assetNotes,
  notifications, driveFolders, driveFiles, invoices, contracts, contacts, pushTickets,
  type User, type InsertUser, type Community, type CommunityMember,
  type Task, type TaskCompletion, type Attachment, type PushToken,
  type Asset, type AssetProperty, type TaskLink, type MapLayer, type OfflinePack,
  type TaskTemplate, type TemplateRun,
  type TaskSchedule, type ScheduleRun, type ScheduleRunItem,
  type ServiceSchedule, type ServiceVisit, type AssetNote, type Notification,
  type DriveFolder, type DriveFile, type Invoice, type Contract,
  type Contact, type InsertContact, type PushTicket,
  type TaskPageViewModel, type TaskPageTaskItem, type TaskPageCompletionItem,
  userRoleEnum,
} from "@workspace/db";

export async function createUser(data: InsertUser): Promise<User> {
  const [user] = await db.insert(users).values(data).returning();
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user;
}

export async function getAllContractors(): Promise<User[]> {
  return db.select().from(users).where(eq(users.role, "contractor"));
}

export async function createCommunity(data: { name: string; description?: string }): Promise<Community> {
  const [community] = await db.insert(communities).values(data).returning();
  return community;
}

export async function getCommunities(): Promise<Community[]> {
  return db.select().from(communities).orderBy(communities.name);
}

export async function getCommunityById(id: string): Promise<Community | undefined> {
  const [community] = await db.select().from(communities).where(eq(communities.id, id));
  return community;
}

export async function updateCommunity(id: string, data: { name?: string; description?: string | null }): Promise<Community | undefined> {
  const [updated] = await db.update(communities).set(data).where(eq(communities.id, id)).returning();
  return updated;
}

export async function lockCommunityForMapCreator(id: string, lockedBy: string): Promise<Community | undefined> {
  const [updated] = await db.update(communities)
    .set({ isMapCreatorLocked: true, mapCreatorLockedAt: new Date(), mapCreatorLockedBy: lockedBy })
    .where(eq(communities.id, id))
    .returning();
  return updated;
}

export async function unlockCommunityForMapCreator(id: string): Promise<Community | undefined> {
  const [updated] = await db.update(communities)
    .set({ isMapCreatorLocked: false, mapCreatorLockedAt: null, mapCreatorLockedBy: null })
    .where(eq(communities.id, id))
    .returning();
  return updated;
}

export async function addCommunityMember(communityId: string, userId: string): Promise<CommunityMember> {
  const [member] = await db.insert(communityMembers).values({ communityId, userId }).returning();
  return member;
}

export async function removeCommunityMember(communityId: string, userId: string): Promise<void> {
  await db.delete(communityMembers).where(
    and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))
  );
}

export async function getUserCommunities(userId: string): Promise<(CommunityMember & { community: Community })[]> {
  const members = await db.select().from(communityMembers)
    .innerJoin(communities, eq(communityMembers.communityId, communities.id))
    .where(eq(communityMembers.userId, userId));
  return members.map(m => ({ ...m.community_members, community: m.communities }));
}

export async function getCommunityMembers(communityId: string): Promise<(CommunityMember & { user: User })[]> {
  const members = await db.select().from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .where(eq(communityMembers.communityId, communityId));
  return members.map(m => ({ ...m.community_members, user: m.users }));
}

export async function createTask(data: {
  communityId: string;
  title: string;
  description?: string;
  status?: "pending" | "in_progress" | "completed" | "submitted" | "acknowledged";
  priority?: "low" | "medium" | "high" | "urgent";
  latitude?: number;
  longitude?: number;
  address?: string;
  assignedTo?: string;
  createdBy: string;
  startDate?: Date;
  dueDate?: Date;
  ticketType?: string;
  windowStart?: string;
  windowEnd?: string;
  origin?: string;
  category?: string;
}): Promise<Task> {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function getTaskById(id: string): Promise<Task | undefined> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task;
}

export async function getAllTasks(): Promise<Task[]> {
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function getTasksByCommunity(communityId: string): Promise<Task[]> {
  return db.select().from(tasks)
    .where(eq(tasks.communityId, communityId))
    .orderBy(desc(tasks.createdAt));
}

export async function enrichTasksWithAssigneeName(taskList: Task[]): Promise<(Task & { assignedToName: string | null })[]> {
  const assigneeIds = [...new Set(taskList.map(t => t.assignedTo).filter((id): id is string => !!id))];
  const assigneeMap = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const assignees = await db.select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, assigneeIds));
    assignees.forEach(a => assigneeMap.set(a.id, a.displayName));
  }
  return taskList.map(t => ({
    ...t,
    assignedToName: t.assignedTo ? (assigneeMap.get(t.assignedTo) ?? null) : null,
  }));
}

export async function getTasksDueInRange(from: Date, to: Date): Promise<Task[]> {
  return db.select().from(tasks)
    .where(and(
      gte(tasks.dueDate, from),
      lt(tasks.dueDate, to),
      ne(tasks.status, 'completed'),
      isNotNull(tasks.assignedTo),
    ));
}

export async function getTasksForUser(userId: string, communityId?: string): Promise<Task[]> {
  if (communityId) {
    return db.select().from(tasks)
      .where(and(
        eq(tasks.communityId, communityId),
        or(eq(tasks.assignedTo, userId), isNull(tasks.assignedTo))
      ))
      .orderBy(desc(tasks.createdAt));
  }
  return db.select().from(tasks)
    .where(eq(tasks.assignedTo, userId))
    .orderBy(desc(tasks.createdAt));
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  return result.length > 0;
}

export async function updateTask(id: string, expectedVersion: number, data: Partial<{
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "submitted" | "acknowledged";
  priority: "low" | "medium" | "high" | "urgent";
  latitude: number;
  longitude: number;
  address: string;
  assignedTo: string;
  dueDate: Date;
  windowStart: string;
  windowEnd: string;
}>): Promise<Task | null> {
  const setData: Record<string, unknown> = { ...data, version: expectedVersion + 1, updatedAt: new Date() };
  if (data.status === 'acknowledged') {
    setData.acknowledgedAt = new Date();
  }
  const [updated] = await db.update(tasks)
    .set(setData)
    .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
    .returning();
  return updated || null;
}

export async function createTaskCompletion(data: {
  taskId: string;
  completedBy: string;
  notes?: string;
  employeeSignOffName: string;
  timeSpentMinutes?: number;
  materialsUsed?: string;
  followUpNeeded?: string;
}): Promise<TaskCompletion> {
  const [completion] = await db.insert(taskCompletions).values(data).returning();
  return completion;
}

export async function getTaskCompletions(taskId: string): Promise<TaskCompletion[]> {
  return db.select().from(taskCompletions)
    .where(eq(taskCompletions.taskId, taskId))
    .orderBy(desc(taskCompletions.completedAt));
}

export async function createAttachment(data: {
  taskCompletionId?: string | null;
  taskId?: string | null;
  assetId?: string | null;
  fileRef: string;
  url: string;
  uploadedBy: string;
  idempotencyKey: string;
}): Promise<Attachment> {
  const [attachment] = await db.insert(attachments).values(data).returning();
  return attachment;
}

export async function getAttachmentsByAssetId(assetId: string): Promise<Attachment[]> {
  return db.select().from(attachments)
    .where(eq(attachments.assetId, assetId))
    .orderBy(desc(attachments.createdAt));
}

export async function getAttachmentByAssetIdAndIdempotencyKey(assetId: string, idempotencyKey: string): Promise<Attachment | null> {
  const [row] = await db.select().from(attachments).where(
    and(eq(attachments.assetId, assetId), eq(attachments.idempotencyKey, idempotencyKey))
  );
  return row ?? null;
}

export async function getAttachmentsByTaskId(taskId: string): Promise<Attachment[]> {
  return db.select().from(attachments)
    .where(and(eq(attachments.taskId, taskId), isNull(attachments.taskCompletionId)))
    .orderBy(desc(attachments.createdAt));
}

export async function getAttachmentByIdempotencyKey(taskCompletionId: string, idempotencyKey: string): Promise<Attachment | null> {
  const [row] = await db.select().from(attachments).where(
    and(eq(attachments.taskCompletionId, taskCompletionId), eq(attachments.idempotencyKey, idempotencyKey))
  );
  return row || null;
}

export async function getAttachmentByTaskIdAndIdempotencyKey(taskId: string, idempotencyKey: string): Promise<Attachment | null> {
  const [row] = await db.select().from(attachments).where(
    and(eq(attachments.taskId, taskId), eq(attachments.idempotencyKey, idempotencyKey))
  );
  return row || null;
}

export async function getCompletionById(completionId: string): Promise<TaskCompletion | undefined> {
  const [row] = await db.select().from(taskCompletions).where(eq(taskCompletions.id, completionId));
  return row;
}

export async function getAttachmentsByCompletion(taskCompletionId: string): Promise<Attachment[]> {
  return db.select().from(attachments)
    .where(eq(attachments.taskCompletionId, taskCompletionId))
    .orderBy(desc(attachments.createdAt));
}

export async function registerPushToken(userId: string, token: string, platform: string, deviceId: string): Promise<PushToken> {
  const existing = await db.select().from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.deviceId, deviceId)));
  if (existing.length > 0) {
    const [updated] = await db.update(pushTokens)
      .set({ token, platform, updatedAt: new Date() })
      .where(eq(pushTokens.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(pushTokens).values({ userId, token, platform, deviceId }).returning();
  return created;
}

export async function removePushTokenByDevice(userId: string, deviceId: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.deviceId, deviceId)));
}

export async function removePushToken(userId: string, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

export async function getTokensForUser(userId: string): Promise<PushToken[]> {
  return db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
}

export async function pruneInvalidToken(token: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.token, token));
}

export async function getCompletedTasksWithDetails(communityId: string) {
  const completedTasks = await db.select().from(tasks)
    .where(and(eq(tasks.communityId, communityId), eq(tasks.status, 'completed')))
    .orderBy(desc(tasks.updatedAt));

  const result = await Promise.all(
    completedTasks.map(async (task) => {
      const completions = await getTaskCompletions(task.id);
      const completionsWithAttachments = await Promise.all(
        completions.map(async (c) => {
          const atts = await getAttachmentsByCompletion(c.id);
          return { ...c, attachments: atts };
        }),
      );
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        address: task.address,
        completions: completionsWithAttachments,
      };
    }),
  );
  return result;
}

export async function isUserMemberOfCommunity(userId: string, communityId: string): Promise<boolean> {
  const [row] = await db.select().from(communityMembers)
    .where(and(eq(communityMembers.userId, userId), eq(communityMembers.communityId, communityId)));
  return !!row;
}

export async function canUserAccessTask(userId: string, taskId: string): Promise<{ allowed: boolean; task: Task | undefined }> {
  const t0 = Date.now();
  const [[task], [user]] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.id, taskId)),
    db.select().from(users).where(eq(users.id, userId)),
  ]);
  if (!task) { console.log(`[canUserAccessTask] task=${taskId} not found (${Date.now() - t0}ms)`); return { allowed: false, task: undefined }; }
  if (!user) { console.log(`[canUserAccessTask] user=${userId} not found (${Date.now() - t0}ms)`); return { allowed: false, task }; }
  if (user.role === 'admin') { console.log(`[canUserAccessTask] admin access granted (${Date.now() - t0}ms)`); return { allowed: true, task }; }
  if (user.role === 'hoa_admin' || user.role === 'hoa_member') {
    const allowed = user.hoaCommunityId === task.communityId;
    console.log(`[canUserAccessTask] hoa role check allowed=${allowed} (${Date.now() - t0}ms)`);
    return { allowed, task };
  }
  if (task.assignedTo === userId) { console.log(`[canUserAccessTask] assignee access granted (${Date.now() - t0}ms)`); return { allowed: true, task }; }
  const [membership] = await db.select({ id: communityMembers.id })
    .from(communityMembers)
    .where(and(eq(communityMembers.userId, userId), eq(communityMembers.communityId, task.communityId)));
  const isMember = !!membership;
  console.log(`[canUserAccessTask] membership join isMember=${isMember} (${Date.now() - t0}ms)`);
  return { allowed: isMember, task };
}

export async function getAllUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(users.displayName);
}

export async function getUsersByCommunity(communityId: string): Promise<User[]> {
  return db.select().from(users)
    .where(eq(users.hoaCommunityId, communityId))
    .orderBy(users.displayName);
}

export async function updateUserProfile(
  userId: string,
  updates: { displayName?: string; password?: string },
): Promise<User | null> {
  if (Object.keys(updates).length === 0) {
    const [existing] = await db.select().from(users).where(eq(users.id, userId));
    return existing || null;
  }
  const [updated] = await db.update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning();
  return updated || null;
}

export async function updateUserStatus(userId: string, isActive: boolean): Promise<User | null> {
  const [updated] = await db.update(users)
    .set({ isActive })
    .where(eq(users.id, userId))
    .returning();
  return updated || null;
}

export async function updateUserRole(userId: string, role: string, hoaCommunityId?: string | null): Promise<User | null> {
  const [updated] = await db.update(users)
    .set({ role: role as any, hoaCommunityId: hoaCommunityId ?? null })
    .where(eq(users.id, userId))
    .returning();
  return updated || null;
}

export async function getHoaUserCountByCommunity(communityId: string, role: string, excludeUserId?: string): Promise<number> {
  const conditions = [
    eq(users.hoaCommunityId, communityId),
    eq(users.role, role as any),
  ];
  if (excludeUserId) {
    conditions.push(ne(users.id, excludeUserId));
  }
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(...conditions));
  return Number(result[0]?.count ?? 0);
}

export async function deleteUser(userId: string): Promise<boolean> {
  await db.delete(communityMembers).where(eq(communityMembers.userId, userId));
  await db.delete(pushTokens).where(eq(pushTokens.userId, userId));
  const result = await db.delete(users).where(eq(users.id, userId)).returning();
  return result.length > 0;
}

export async function addCommunityMembers(communityId: string, userIds: string[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const userId of userIds) {
    try {
      await db.insert(communityMembers).values({ communityId, userId });
      added++;
    } catch (err: any) {
      if (err?.code === '23505' || err?.message?.includes('duplicate')) {
        skipped++;
      } else {
        throw err;
      }
    }
  }
  return { added, skipped };
}

export async function getUserCommunitiesList(userId: string): Promise<Community[]> {
  const rows = await db.select({ community: communities })
    .from(communityMembers)
    .innerJoin(communities, eq(communityMembers.communityId, communities.id))
    .where(eq(communityMembers.userId, userId))
    .orderBy(communities.name);
  return rows.map(r => r.community);
}

export async function getAdminSummary(communityId?: string) {
  const communityFilter = communityId ? eq(communities.id, communityId) : undefined;
  const assetCommunityFilter = communityId ? eq(assets.communityId, communityId) : undefined;
  const taskCommunityFilter = communityId ? eq(tasks.communityId, communityId) : undefined;
  const layerCommunityFilter = communityId ? eq(mapLayers.communityId, communityId) : undefined;

  const [commRes] = await db.select({ count: count() }).from(communities).where(communityFilter);
  const [activeRes] = await db.select({ count: count() }).from(assets).where(
    assetCommunityFilter ? and(assetCommunityFilter, eq(assets.isArchived, false)) : eq(assets.isArchived, false)
  );
  const [archivedRes] = await db.select({ count: count() }).from(assets).where(
    assetCommunityFilter ? and(assetCommunityFilter, eq(assets.isArchived, true)) : eq(assets.isArchived, true)
  );
  const [taskRes] = await db.select({ count: count() }).from(tasks).where(taskCommunityFilter);
  const [pendingRes] = await db.select({ count: count() }).from(tasks).where(
    taskCommunityFilter ? and(taskCommunityFilter, eq(tasks.status, 'pending')) : eq(tasks.status, 'pending')
  );
  const [completedRes] = await db.select({ count: count() }).from(tasks).where(
    taskCommunityFilter ? and(taskCommunityFilter, eq(tasks.status, 'completed')) : eq(tasks.status, 'completed')
  );
  const [layerRes] = await db.select({ count: count() }).from(mapLayers).where(layerCommunityFilter);

  let incompleteAssetsCount = 0;
  const layerStats: { layerId: string; activeAssets: number; archivedAssets: number }[] = [];

  if (communityId) {
    const allActiveAssets = await db.select().from(assets).where(
      and(eq(assets.communityId, communityId), eq(assets.isArchived, false))
    );
    const allProps = allActiveAssets.length > 0
      ? await db.select().from(assetProperties).where(inArray(assetProperties.assetId, allActiveAssets.map(a => a.id)))
      : [];
    const propsByAsset = new Map<string, string[]>();
    allProps.forEach(p => {
      const existing = propsByAsset.get(p.assetId) || [];
      existing.push(p.key);
      propsByAsset.set(p.assetId, existing);
    });

    const { ASSET_TYPE_TEMPLATES } = await import("./assetSync");
    for (const asset of allActiveAssets) {
      const template = ASSET_TYPE_TEMPLATES[asset.assetType as keyof typeof ASSET_TYPE_TEMPLATES];
      const required = template?.requiredKeys || [];
      const propKeys = propsByAsset.get(asset.id) || [];
      if (required.some((k: string) => !propKeys.includes(k))) {
        incompleteAssetsCount++;
      }
    }

    const communityLayers = await db.select().from(mapLayers).where(eq(mapLayers.communityId, communityId));
    for (const layer of communityLayers) {
      const [active] = await db.select({ count: count() }).from(assets).where(
        and(eq(assets.mapLayerId, layer.id), eq(assets.isArchived, false))
      );
      const [archived] = await db.select({ count: count() }).from(assets).where(
        and(eq(assets.mapLayerId, layer.id), eq(assets.isArchived, true))
      );
      layerStats.push({ layerId: layer.id, activeAssets: active.count, archivedAssets: archived.count });
    }
  }

  return {
    communitiesCount: commRes.count,
    activeAssetsCount: activeRes.count,
    archivedAssetsCount: archivedRes.count,
    incompleteAssetsCount,
    tasksCount: taskRes.count,
    pendingTasksCount: pendingRes.count,
    completedTasksCount: completedRes.count,
    mapLayersCount: layerRes.count,
    layerStats,
  };
}

export async function createAsset(data: {
  communityId: string;
  assetType: Asset["assetType"];
  label: string;
  featureRef?: string;
  geometryType?: Asset["geometryType"];
  latitude?: number;
  longitude?: number;
  tags?: string[];
  createdBy?: string;
  updatedBy?: string;
}): Promise<Asset> {
  const [asset] = await db.insert(assets).values(data).returning();
  return asset;
}

export async function getAssetById(id: string): Promise<Asset | undefined> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, id));
  return asset;
}

export async function getAssetsByMapLayer(communityId: string, mapLayerId: string): Promise<Asset[]> {
  return db.select().from(assets).where(
    and(eq(assets.communityId, communityId), eq(assets.mapLayerId, mapLayerId))
  );
}

export async function updateAssetArchived(id: string, isArchived: boolean): Promise<void> {
  await db.update(assets)
    .set({ isArchived, archivedAt: isArchived ? new Date() : null, updatedAt: new Date() })
    .where(eq(assets.id, id));
}

export async function createAssetFromFeature(data: {
  communityId: string;
  assetType: Asset["assetType"];
  label: string;
  featureRef: string;
  mapLayerId: string;
  geometryType: "point" | "polygon" | "line" | null;
  latitude: number | null;
  longitude: number | null;
  createdBy?: string;
}): Promise<Asset> {
  const [asset] = await db.insert(assets).values({
    communityId: data.communityId,
    assetType: data.assetType,
    label: data.label,
    featureRef: data.featureRef,
    mapLayerId: data.mapLayerId,
    geometryType: data.geometryType,
    latitude: data.latitude,
    longitude: data.longitude,
    isArchived: false,
    sourceUpdatedAt: new Date(),
    createdBy: data.createdBy,
  }).returning();
  return asset;
}

/** Convert a 0-based index to alphabetical key: 0→A, 25→Z, 26→AA … */
function toControllerKey(n: number): string {
  let result = "";
  let i = n;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

/**
 * Atomically count existing controllers, auto-assign controllerKey + controllerColor,
 * insert the controller asset, and write its initial properties — all in one transaction.
 * Uses SELECT … FOR UPDATE to prevent key/color duplication under concurrent creates.
 */
export async function createControllerAssetAtomic(data: {
  communityId: string;
  label: string;
  featureRef?: string | null;
  mapLayerId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdBy: string;
  bodyProps: Record<string, string>;
  controllerColors: string[];
}): Promise<{ asset: Asset; resolvedKey: string; resolvedColor: string }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.communityId, data.communityId),
          eq(assets.assetType, "controller"),
          eq(assets.isArchived, false),
        ),
      )
      .for("update");

    const count = existing.length;
    const resolvedKey = data.bodyProps.controllerKey || toControllerKey(count);
    const resolvedColor =
      data.bodyProps.controllerColor ||
      data.controllerColors[count % data.controllerColors.length];

    const [asset] = await tx
      .insert(assets)
      .values({
        communityId: data.communityId,
        assetType: "controller",
        label: data.label,
        featureRef: data.featureRef,
        mapLayerId: data.mapLayerId,
        latitude: data.latitude,
        longitude: data.longitude,
        isArchived: false,
        sourceUpdatedAt: new Date(),
        createdBy: data.createdBy,
      })
      .returning();

    const propsToWrite = [
      { assetId: asset.id, key: "controllerKey", value: resolvedKey },
      { assetId: asset.id, key: "controllerColor", value: resolvedColor },
      ...Object.entries(data.bodyProps)
        .filter(([k]) => k !== "controllerKey" && k !== "controllerColor")
        .map(([key, value]) => ({ assetId: asset.id, key, value })),
    ];

    if (propsToWrite.length > 0) {
      await tx
        .insert(assetProperties)
        .values(propsToWrite)
        .onConflictDoUpdate({
          target: [assetProperties.assetId, assetProperties.key],
          set: { value: sql`excluded.value` },
        });
    }

    return { asset, resolvedKey, resolvedColor };
  });
}

export async function getAssetsByCommunitySorted(communityId: string, assetType?: string, includeArchived?: boolean): Promise<Asset[]> {
  const conditions = [eq(assets.communityId, communityId)];
  if (assetType) {
    conditions.push(eq(assets.assetType, assetType as Asset["assetType"]));
  }
  if (!includeArchived) {
    conditions.push(eq(assets.isArchived, false));
  }
  return db.select().from(assets)
    .where(and(...conditions))
    .orderBy(assets.label);
}

export async function updateAsset(id: string, expectedVersion: number, data: Partial<{
  label: string;
  featureRef: string | null;
  geometryType: Asset["geometryType"] | null;
  latitude: number | null;
  longitude: number | null;
  tags: string[];
  isArchived: boolean;
  updatedBy: string;
}>): Promise<Asset | null> {
  const [updated] = await db.update(assets)
    .set({ ...data, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.version, expectedVersion)))
    .returning();
  return updated || null;
}

export async function getAssetProperties(assetId: string): Promise<AssetProperty[]> {
  return db.select().from(assetProperties)
    .where(eq(assetProperties.assetId, assetId))
    .orderBy(assetProperties.key);
}

export async function getAssetPropertiesBulk(assetIds: string[]): Promise<{ assetId: string; key: string; value: string }[]> {
  if (assetIds.length === 0) return [];
  const rows = await db.select({
    assetId: assetProperties.assetId,
    key: assetProperties.key,
    value: assetProperties.value,
  }).from(assetProperties)
    .where(inArray(assetProperties.assetId, assetIds));
  return rows;
}

export async function upsertAssetProperty(assetId: string, key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(assetProperties)
    .where(and(eq(assetProperties.assetId, assetId), eq(assetProperties.key, key)));
  if (existing) {
    await db.update(assetProperties)
      .set({ value, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(assetProperties.id, existing.id));
  } else {
    await db.insert(assetProperties).values({ assetId, key, value });
  }
}

export async function upsertAssetProperties(assetId: string, props: { key: string; value: string }[]): Promise<AssetProperty[]> {
  const results: AssetProperty[] = [];
  for (const p of props) {
    const [existing] = await db.select().from(assetProperties)
      .where(and(eq(assetProperties.assetId, assetId), eq(assetProperties.key, p.key)));
    if (existing) {
      const [updated] = await db.update(assetProperties)
        .set({ value: p.value, version: existing.version + 1, updatedAt: new Date() })
        .where(eq(assetProperties.id, existing.id))
        .returning();
      results.push(updated);
    } else {
      const [created] = await db.insert(assetProperties).values({ assetId, key: p.key, value: p.value }).returning();
      results.push(created);
    }
  }
  return results;
}

export async function bulkUpsertAssetProperty(
  assetIds: string[],
  key: string,
  value: string,
  mode: "set_if_missing" | "overwrite"
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0, skipped = 0;
  for (const assetId of assetIds) {
    const [existing] = await db.select().from(assetProperties)
      .where(and(eq(assetProperties.assetId, assetId), eq(assetProperties.key, key)));
    if (existing) {
      if (mode === "overwrite") {
        await db.update(assetProperties)
          .set({ value, version: existing.version + 1, updatedAt: new Date() })
          .where(eq(assetProperties.id, existing.id));
        updated++;
      } else {
        skipped++;
      }
    } else {
      await db.insert(assetProperties).values({ assetId, key, value }).returning();
      created++;
    }
  }
  return { created, updated, skipped };
}

export async function getIncompleteAssets(
  communityId: string,
  assetType?: string,
  mapLayerId?: string,
  missingKey?: string,
): Promise<(Asset & { missingRequiredKeys: string[] })[]> {
  const conditions = [eq(assets.communityId, communityId), eq(assets.isArchived, false)];
  if (assetType) conditions.push(eq(assets.assetType, assetType as Asset["assetType"]));
  if (mapLayerId) conditions.push(eq(assets.mapLayerId, mapLayerId));

  const allAssets = await db.select().from(assets)
    .where(and(...conditions))
    .orderBy(assets.label);

  const { getMissingRequiredKeys } = await import("./assetSync");

  const results: (Asset & { missingRequiredKeys: string[] })[] = [];
  for (const asset of allAssets) {
    const props = await getAssetProperties(asset.id);
    const missing = getMissingRequiredKeys(asset.assetType, props);
    if (missing.length === 0) continue;
    if (missingKey && !missing.includes(missingKey)) continue;
    results.push({ ...asset, missingRequiredKeys: missing });
  }
  return results;
}

export async function getTaskLink(taskId: string): Promise<(TaskLink & { asset?: Asset }) | null> {
  const [link] = await db.select().from(taskLinks).where(eq(taskLinks.taskId, taskId));
  if (!link) return null;
  if (link.assetId) {
    const asset = await getAssetById(link.assetId);
    return { ...link, asset };
  }
  return link;
}

export async function setTaskLink(taskId: string, data: {
  linkType: "asset" | "pin";
  assetId?: string;
  latitude?: number;
  longitude?: number;
}): Promise<TaskLink> {
  await db.delete(taskLinks).where(eq(taskLinks.taskId, taskId));
  const [link] = await db.insert(taskLinks).values({ taskId, ...data }).returning();
  return link;
}

export async function createMapLayer(data: {
  communityId: string;
  layerKey: string;
  subLayerKey: string;
  displayName: string;
  sourceFormat?: string;
  geojsonData?: string;
  color?: string;
}): Promise<MapLayer> {
  const [layer] = await db.insert(mapLayers).values(data).returning();
  return layer;
}

export async function getMapLayersByCommunity(communityId: string, layerKey?: string): Promise<MapLayer[]> {
  if (layerKey) {
    return db.select().from(mapLayers)
      .where(and(eq(mapLayers.communityId, communityId), eq(mapLayers.layerKey, layerKey)))
      .orderBy(mapLayers.displayName);
  }
  return db.select().from(mapLayers)
    .where(eq(mapLayers.communityId, communityId))
    .orderBy(mapLayers.layerKey, mapLayers.displayName);
}

export async function getMapLayerById(id: string): Promise<MapLayer | undefined> {
  const [layer] = await db.select().from(mapLayers).where(eq(mapLayers.id, id));
  return layer;
}

export async function updateMapLayer(id: string, expectedVersion: number, data: Partial<{
  displayName: string;
  sourceFormat: string;
  geojsonData: string;
  color: string;
  strokeColor: string;
  strokeWeight: number;
  fillOpacity: string;
  isEnabled: boolean;
}>): Promise<MapLayer | null> {
  const [updated] = await db.update(mapLayers)
    .set({ ...data, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(mapLayers.id, id), eq(mapLayers.version, expectedVersion)))
    .returning();
  return updated || null;
}

export async function getMapLayerSummary(mapLayerId: string, communityId: string): Promise<{
  activeAssetCount: number;
  archivedAssetCount: number;
  incompleteAssetCount: number;
}> {
  const allLayerAssets = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId), eq(assets.mapLayerId, mapLayerId)));
  
  const active = allLayerAssets.filter(a => !a.isArchived);
  const archived = allLayerAssets.filter(a => a.isArchived);
  
  let incompleteCount = 0;
  const { ASSET_TYPE_TEMPLATES } = await import("./assetSync");
  for (const asset of active) {
    const template = ASSET_TYPE_TEMPLATES[asset.assetType];
    if (template && template.requiredKeys.length > 0) {
      const props = await db.select().from(assetProperties)
        .where(eq(assetProperties.assetId, asset.id));
      const propKeys = new Set(props.map(p => p.key));
      const missing = template.requiredKeys.filter(k => !propKeys.has(k));
      if (missing.length > 0) incompleteCount++;
    }
  }
  
  return {
    activeAssetCount: active.length,
    archivedAssetCount: archived.length,
    incompleteAssetCount: incompleteCount,
  };
}

export async function deleteMapLayer(id: string): Promise<boolean> {
  const [deleted] = await db.delete(mapLayers).where(eq(mapLayers.id, id)).returning();
  return !!deleted;
}

export async function getAssetByFeatureRef(communityId: string, featureRef: string): Promise<(Asset & { properties: AssetProperty[] }) | null> {
  const [asset] = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId), eq(assets.featureRef, featureRef), eq(assets.isArchived, false)));
  if (!asset) return null;
  const props = await getAssetProperties(asset.id);
  return { ...asset, properties: props };
}

export async function createOfflinePack(data: {
  communityId: string;
  packVersion?: number;
  mbtilesRef?: string;
  manifestRef?: string;
  geojsonBundleRef?: string;
  assetIndexRef?: string;
  checksum?: string;
}): Promise<OfflinePack> {
  const [pack] = await db.insert(offlinePacks).values(data).returning();
  return pack;
}

export async function getLatestOfflinePack(communityId: string): Promise<OfflinePack | undefined> {
  const [pack] = await db.select().from(offlinePacks)
    .where(eq(offlinePacks.communityId, communityId))
    .orderBy(desc(offlinePacks.packVersion))
    .limit(1);
  return pack;
}

export async function getOfflinePackById(id: string): Promise<OfflinePack | undefined> {
  const [pack] = await db.select().from(offlinePacks).where(eq(offlinePacks.id, id));
  return pack;
}

export async function updateOfflinePack(id: string, data: Partial<{
  mbtilesRef: string;
  manifestRef: string;
  geojsonBundleRef: string;
  assetIndexRef: string;
  searchIndexRef: string;
  checksum: string;
}>): Promise<OfflinePack | null> {
  const [updated] = await db.update(offlinePacks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(offlinePacks.id, id))
    .returning();
  return updated || null;
}

export async function listOfflinePacks(communityId: string): Promise<OfflinePack[]> {
  return db.select().from(offlinePacks)
    .where(eq(offlinePacks.communityId, communityId))
    .orderBy(desc(offlinePacks.packVersion));
}

export async function deleteOfflinePack(id: string): Promise<boolean> {
  const [deleted] = await db.delete(offlinePacks).where(eq(offlinePacks.id, id)).returning();
  return !!deleted;
}

export async function generateAssetIndex(communityId: string) {
  const communityAssets = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId), eq(assets.isArchived, false)));
  const allIds = communityAssets.map(a => a.id);
  let propsMap = new Map<string, { key: string; value: string }[]>();
  if (allIds.length > 0) {
    const allProps = await db.select().from(assetProperties)
      .where(inArray(assetProperties.assetId, allIds));
    for (const p of allProps) {
      const list = propsMap.get(p.assetId) || [];
      list.push({ key: p.key, value: p.value });
      propsMap.set(p.assetId, list);
    }
  }
  const index: Record<string, {
    assetId: string;
    label: string;
    assetType: string;
    properties: { key: string; value: string }[];
  }> = {};
  for (const a of communityAssets) {
    if (a.featureRef) {
      index[a.featureRef] = {
        assetId: a.id,
        label: a.label,
        assetType: a.assetType,
        properties: propsMap.get(a.id) || [],
      };
    }
  }
  return index;
}

export async function generatePackManifest(communityId: string) {
  const layers = await getMapLayersByCommunity(communityId);
  const community = await getCommunityById(communityId);
  return {
    communityId,
    communityName: community?.name || '',
    generatedAt: new Date().toISOString(),
    layers: layers.map(l => ({
      id: l.id,
      layerKey: l.layerKey,
      subLayerKey: l.subLayerKey,
      displayName: l.displayName,
      updatedAt: l.updatedAt,
    })),
  };
}

export async function generateGeojsonBundle(communityId: string) {
  const layers = await getMapLayersByCommunity(communityId);
  const bundle: Record<string, any> = {};
  for (const l of layers) {
    if (l.geojsonData) {
      try {
        bundle[l.id] = JSON.parse(l.geojsonData);
      } catch {
        bundle[l.id] = null;
      }
    }
  }
  return bundle;
}

export async function generateWorkHistorySnapshot(communityId: string, limit = 5) {
  const communityAssets = await db.select({ id: assets.id }).from(assets)
    .where(eq(assets.communityId, communityId));
  if (communityAssets.length === 0) return {};

  const assetIds = communityAssets.map(a => a.id);
  const snapshot: Record<string, any[]> = {};

  for (const assetId of assetIds) {
    const history = await getAssetWorkHistory(assetId);
    if (history.length > 0) {
      snapshot[assetId] = history.slice(0, limit);
    }
  }
  return snapshot;
}

export async function generateSearchIndex(communityId: string, userId?: string, isAdmin = true) {
  const communityAssets = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId)));
  const allIds = communityAssets.map(a => a.id);
  let propsMap = new Map<string, Record<string, string>>();
  if (allIds.length > 0) {
    const allProps = await db.select().from(assetProperties)
      .where(inArray(assetProperties.assetId, allIds));
    for (const p of allProps) {
      const map = propsMap.get(p.assetId) || {};
      map[p.key] = p.value;
      propsMap.set(p.assetId, map);
    }
  }

  const searchAssets = communityAssets.map(a => {
    const props = propsMap.get(a.id) || {};
    return {
      id: a.id,
      assetType: a.assetType,
      label: a.label,
      featureRef: a.featureRef,
      isArchived: a.isArchived,
      latitude: a.latitude,
      longitude: a.longitude,
      props: {
        ...(props.serialNumber ? { serialNumber: props.serialNumber } : {}),
        ...(props.species ? { species: props.species } : {}),
        ...(props.brand ? { brand: props.brand } : {}),
        ...(props.zoneNumber ? { zoneNumber: props.zoneNumber } : {}),
        ...(props.size ? { size: props.size } : {}),
        ...(props.controllerRef ? { controllerRef: props.controllerRef } : {}),
        ...(props.name ? { name: props.name } : {}),
        ...(props.address ? { address: props.address } : {}),
      },
    };
  });

  const taskConditions: any[] = [eq(tasks.communityId, communityId)];
  if (!isAdmin && userId) {
    taskConditions.push(eq(tasks.assignedTo, userId));
  }
  const communityTasks = await db.select().from(tasks)
    .where(and(...taskConditions));

  const taskLinksAll = communityTasks.length > 0
    ? await db.select({
        taskId: taskLinks.taskId,
        assetId: taskLinks.assetId,
      }).from(taskLinks)
        .where(and(
          inArray(taskLinks.taskId, communityTasks.map(t => t.id)),
          eq(taskLinks.linkType, 'asset'),
        ))
    : [];
  const taskLinkMap = new Map<string, string>();
  for (const tl of taskLinksAll) {
    if (tl.assetId) taskLinkMap.set(tl.taskId, tl.assetId);
  }

  const searchTasks = communityTasks.map(t => {
    const linkedAssetId = taskLinkMap.get(t.id);
    const linkedAsset = linkedAssetId
      ? communityAssets.find(a => a.id === linkedAssetId)
      : undefined;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString() || null,
      address: t.address,
      latitude: t.latitude,
      longitude: t.longitude,
      linkedAssetLabel: linkedAsset?.label || null,
      linkedAssetType: linkedAsset?.assetType || null,
    };
  });

  return { assets: searchAssets, tasks: searchTasks };
}

export async function getAssetWorkHistory(assetId: string) {
  const linkedTasks = await db.select({ taskId: taskLinks.taskId })
    .from(taskLinks)
    .where(and(eq(taskLinks.assetId, assetId), eq(taskLinks.linkType, 'asset')));

  if (linkedTasks.length === 0) return [];

  const taskIds = linkedTasks.map(t => t.taskId);

  const completionRows = await db.select({
    id: taskCompletions.id,
    taskId: taskCompletions.taskId,
    completedBy: taskCompletions.completedBy,
    notes: taskCompletions.notes,
    employeeSignOffName: taskCompletions.employeeSignOffName,
    timeSpentMinutes: taskCompletions.timeSpentMinutes,
    materialsUsed: taskCompletions.materialsUsed,
    followUpNeeded: taskCompletions.followUpNeeded,
    completedAt: taskCompletions.completedAt,
    taskTitle: tasks.title,
    userDisplayName: users.displayName,
  })
    .from(taskCompletions)
    .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
    .innerJoin(users, eq(taskCompletions.completedBy, users.id))
    .where(inArray(taskCompletions.taskId, taskIds))
    .orderBy(desc(taskCompletions.completedAt));

  if (completionRows.length === 0) return [];

  const completionIds = completionRows.map(c => c.id);
  const allAttachments = await db.select({
    id: attachments.id,
    url: attachments.url,
    taskCompletionId: attachments.taskCompletionId,
  })
    .from(attachments)
    .where(inArray(attachments.taskCompletionId, completionIds));

  const attachmentMap = new Map<string, { id: string; url: string }[]>();
  for (const a of allAttachments) {
    const list = attachmentMap.get(a.taskCompletionId) || [];
    list.push({ id: a.id, url: a.url });
    attachmentMap.set(a.taskCompletionId, list);
  }

  return completionRows.map(c => ({
    id: c.id,
    type: 'task_completion' as const,
    completedAt: c.completedAt,
    completedBy: {
      id: c.completedBy,
      displayName: c.userDisplayName,
    },
    employeeSignOffName: c.employeeSignOffName,
    notes: c.notes,
    timeSpentMinutes: c.timeSpentMinutes,
    materialsUsed: c.materialsUsed,
    followUpNeeded: c.followUpNeeded,
    task: {
      id: c.taskId,
      title: c.taskTitle,
    },
    attachments: attachmentMap.get(c.id) || [],
  }));
}

export async function getDashboardData(userId: string, communityId: string, isAdmin: boolean) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const baseConditions = isAdmin
    ? [eq(tasks.communityId, communityId), ne(tasks.status, "completed")]
    : [eq(tasks.communityId, communityId), eq(tasks.assignedTo, userId), ne(tasks.status, "completed")];

  const dueTodayTasks = await db.select().from(tasks)
    .where(and(
      ...baseConditions,
      gte(tasks.dueDate, todayStart),
      lt(tasks.dueDate, todayEnd),
    ))
    .orderBy(asc(tasks.dueDate))
    .limit(5);

  const upcomingTasks = await db.select().from(tasks)
    .where(and(
      ...baseConditions,
      gte(tasks.dueDate, todayEnd),
      lte(tasks.dueDate, weekEnd),
    ))
    .orderBy(asc(tasks.dueDate))
    .limit(8);

  const followUpResults = await db
    .select({
      id: taskCompletions.id,
      taskId: taskCompletions.taskId,
      followUpNeeded: taskCompletions.followUpNeeded,
      completedAt: taskCompletions.completedAt,
      taskTitle: tasks.title,
      taskPriority: tasks.priority,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
    .where(and(
      eq(tasks.communityId, communityId),
      ne(tasks.status, "completed"),
      isNotNull(taskCompletions.followUpNeeded),
      ne(taskCompletions.followUpNeeded, ''),
      ...(isAdmin ? [] : [eq(tasks.assignedTo, userId)]),
    ))
    .orderBy(desc(taskCompletions.completedAt))
    .limit(5);

  const noDueDateTasks = await db.select().from(tasks)
    .where(and(
      ...baseConditions,
      ...[isAdmin ? undefined : eq(tasks.assignedTo, userId)].filter(Boolean) as any[],
    ))
    .orderBy(desc(tasks.priority), desc(tasks.createdAt))
    .limit(10);

  const overdueTasks = noDueDateTasks.length === 0
    ? await db.select().from(tasks)
        .where(and(
          ...baseConditions,
          lt(tasks.dueDate, todayStart),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(5)
    : [];

  const hoaRequestCounts = await db.select({
    priority: tasks.priority,
    count: sql<number>`count(*)::int`,
  }).from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      eq(tasks.origin, "HOA"),
      inArray(tasks.status, ["submitted", "acknowledged"]),
      ...(isAdmin ? [] : [eq(tasks.assignedTo, userId)]),
    ))
    .groupBy(tasks.priority);

  let urgentRequestCount = 0;
  let normalRequestCount = 0;
  for (const row of hoaRequestCounts) {
    if (row.priority === "urgent") {
      urgentRequestCount = row.count;
    } else {
      normalRequestCount += row.count;
    }
  }

  const hoaStatusCounts = await db.select({
    status: tasks.status,
    count: sql<number>`count(*)::int`,
  }).from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      eq(tasks.origin, "HOA"),
      inArray(tasks.status, ["submitted", "acknowledged"]),
      ...(isAdmin ? [] : [eq(tasks.assignedTo, userId)]),
    ))
    .groupBy(tasks.status);

  let newRequestCount = 0;
  let acknowledgedRequestCount = 0;
  for (const row of hoaStatusCounts) {
    if (row.status === "submitted") {
      newRequestCount = row.count;
    } else if (row.status === "acknowledged") {
      acknowledgedRequestCount = row.count;
    }
  }

  const todayDateStr = todayStart.toISOString().split("T")[0];
  const inWindowTasks = await db.select().from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      ne(tasks.status, "completed"),
      isNotNull(tasks.windowStart),
      isNotNull(tasks.windowEnd),
      lte(tasks.windowStart, new Date(todayDateStr + "T23:59:59.999Z")),
      gte(tasks.windowEnd, new Date(todayDateStr + "T00:00:00.000Z")),
      ...(isAdmin ? [] : [eq(tasks.assignedTo, userId)]),
    ))
    .orderBy(asc(tasks.windowEnd), asc(tasks.priority))
    .limit(20);

  const comingUpTasks = await db.select().from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      ne(tasks.status, "completed"),
      isNotNull(tasks.windowStart),
      isNotNull(tasks.windowEnd),
      gt(tasks.windowStart, new Date(todayDateStr + "T23:59:59.999Z")),
      ...(isAdmin ? [] : [eq(tasks.assignedTo, userId)]),
    ))
    .orderBy(asc(tasks.windowStart))
    .limit(3);

  return {
    dueTodayTasks,
    upcomingTasks,
    overdueTasks,
    urgentRequestCount,
    normalRequestCount,
    newRequestCount,
    acknowledgedRequestCount,
    inWindowTasks,
    comingUpTasks,
    followUpTasks: followUpResults.map(r => ({
      id: r.id,
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      taskPriority: r.taskPriority,
      followUpNeeded: r.followUpNeeded,
      completedAt: r.completedAt,
    })),
  };
}

export type TaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  windowStart: string | null;
  windowEnd: string | null;
  origin: string | null;
  assignedTo: string | null;
  communityId: string;
};

export type RecentCompletionSummary = {
  id: string;
  title: string;
  completedAt: Date;
  origin: string | null;
  priority: string;
  hasPhotos: boolean;
};

export type FollowUpSummary = {
  id: string;
  taskId: string;
  taskTitle: string;
  taskPriority: string;
  followUpNeeded: string | null;
  completedAt: Date;
};

export type HoaRequestSummary = {
  submittedCount: number;
  acknowledgedCount: number;
  topRequests: {
    id: string;
    title: string;
    priority: string;
    status: string;
    createdAt: Date;
  }[];
};

export type ServiceScheduleSummary = {
  id: string;
  serviceType: string;
  dayOfWeek: number;
  seasonStart: string | null;
  seasonEnd: string | null;
};

export type MapLayerAvailability = {
  layerKey: string;
  subLayerKey: string;
  displayName: string;
};

export type DashboardViewModel = {
  role: string;
  communityId: string;
  contractorWork?: {
    assignedActiveTasks: TaskSummary[];
    overdueTasks: TaskSummary[];
    requestsNeedingAcknowledgment: TaskSummary[];
    recentCompletions: RecentCompletionSummary[];
    followUpTasks: FollowUpSummary[];
    inWindowTasks: TaskSummary[];
    comingUpTasks: TaskSummary[];
  };
  hoaRequests?: {
    byLifecycleStatus: {
      submittedCount: number;
      acknowledgedCount: number;
      inProgressCount: number;
      completedRecentCount: number;
    };
    recentCommunityCompletions: RecentCompletionSummary[];
    upcomingWorkWindows: TaskSummary[];
    mapLayerAvailability: MapLayerAvailability[];
    mowingSchedules: ServiceScheduleSummary[];
  };
  communityActivity?: {
    recentCompletions: RecentCompletionSummary[];
    upcomingCommunityWork: TaskSummary[];
    serviceSchedules: ServiceScheduleSummary[];
    requestsSummary: HoaRequestSummary;
  };
  pmOverview?: {
    openRequests: TaskSummary[];
    overdueItems: TaskSummary[];
    recentCompletions: RecentCompletionSummary[];
    nextScheduledServiceWindows: TaskSummary[];
  };
};

async function buildRecentCompletions(communityId: string, limit = 8, assignedTo?: string): Promise<RecentCompletionSummary[]> {
  const conditions = [
    eq(tasks.communityId, communityId),
    eq(tasks.status, "completed" as const),
    ...(assignedTo ? [eq(tasks.assignedTo, assignedTo)] : []),
  ] as const;

  const completedTaskRows = await db.select().from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);

  const completedTaskIds = completedTaskRows.map(t => t.id);
  if (completedTaskIds.length === 0) return [];

  const completionRows = await db.select({
    taskId: taskCompletions.taskId,
    completedAt: taskCompletions.completedAt,
    id: taskCompletions.id,
  }).from(taskCompletions)
    .where(inArray(taskCompletions.taskId, completedTaskIds))
    .orderBy(desc(taskCompletions.completedAt));

  const completionMap = new Map<string, Date>();
  for (const c of completionRows) {
    if (!completionMap.has(c.taskId)) completionMap.set(c.taskId, c.completedAt);
  }

  const completionIds = completionRows.map(c => c.id);
  const attachmentCountMap = new Map<string, number>();
  if (completionIds.length > 0) {
    const attRows = await db.select({
      taskCompletionId: attachments.taskCompletionId,
      cnt: sql<number>`count(*)`,
    }).from(attachments)
      .where(inArray(attachments.taskCompletionId, completionIds))
      .groupBy(attachments.taskCompletionId);
    const completionToTask = new Map<string, string>();
    for (const c of completionRows) completionToTask.set(c.id, c.taskId);
    for (const row of attRows) {
      const tId = completionToTask.get(row.taskCompletionId);
      if (tId) attachmentCountMap.set(tId, (attachmentCountMap.get(tId) || 0) + Number(row.cnt));
    }
  }

  return completedTaskRows.map(t => ({
    id: t.id,
    title: t.title,
    completedAt: completionMap.get(t.id) ?? t.updatedAt,
    origin: t.origin,
    priority: t.priority,
    hasPhotos: (attachmentCountMap.get(t.id) || 0) > 0,
  }));
}

export async function getDashboardDataForRole(
  role: string,
  userId: string,
  communityId: string,
  _selectedCommunityId?: string,
): Promise<DashboardViewModel> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todayDateStr = todayStart.toISOString().split("T")[0];

  const viewModel: DashboardViewModel = { role, communityId };

  if (role === "contractor") {
    const [assignedActiveTasks, overdueTasks, requestsNeedingAcknowledgment, followUpResults, inWindowTasks, comingUpTasks] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
        ))
        .orderBy(asc(tasks.dueDate), asc(tasks.priority))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          lt(tasks.dueDate, todayStart),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(10),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          eq(tasks.origin, "HOA"),
          eq(tasks.status, "submitted"),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(10),
      db.select({
        id: taskCompletions.id,
        taskId: taskCompletions.taskId,
        followUpNeeded: taskCompletions.followUpNeeded,
        completedAt: taskCompletions.completedAt,
        taskTitle: tasks.title,
        taskPriority: tasks.priority,
      }).from(taskCompletions)
        .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          isNotNull(taskCompletions.followUpNeeded),
          ne(taskCompletions.followUpNeeded, ''),
        ))
        .orderBy(desc(taskCompletions.completedAt))
        .limit(5),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
          isNotNull(tasks.windowEnd),
          lte(tasks.windowStart, new Date(todayDateStr + "T23:59:59.999Z")),
          gte(tasks.windowEnd, new Date(todayDateStr + "T00:00:00.000Z")),
        ))
        .orderBy(asc(tasks.windowEnd), asc(tasks.priority))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
          gt(tasks.windowStart, new Date(todayDateStr + "T23:59:59.999Z")),
        ))
        .orderBy(asc(tasks.windowStart))
        .limit(5),
    ]);

    const recentCompletions = await buildRecentCompletions(communityId, 8, userId);

    const toSummary = (t: typeof tasks.$inferSelect): TaskSummary => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      dueDate: t.dueDate, windowStart: t.windowStart, windowEnd: t.windowEnd,
      origin: t.origin, assignedTo: t.assignedTo, communityId: t.communityId,
    });

    viewModel.contractorWork = {
      assignedActiveTasks: assignedActiveTasks.map(toSummary),
      overdueTasks: overdueTasks.map(toSummary),
      requestsNeedingAcknowledgment: requestsNeedingAcknowledgment.map(toSummary),
      recentCompletions,
      followUpTasks: followUpResults.map(r => ({
        id: r.id,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        taskPriority: r.taskPriority,
        followUpNeeded: r.followUpNeeded,
        completedAt: r.completedAt,
      })),
      inWindowTasks: inWindowTasks.map(toSummary),
      comingUpTasks: comingUpTasks.map(toSummary),
    };

  } else if (role === "hoa_admin") {
    const [upcomingWorkWindows, hoaStatusCounts, mapLayerRows, mowingScheduleRows, recentCompletedCount] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
        ))
        .orderBy(asc(tasks.windowStart), asc(tasks.dueDate))
        .limit(10),
      db.select({
        status: tasks.status,
        cnt: sql<number>`count(*)::int`,
      }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged", "in_progress"]),
        ))
        .groupBy(tasks.status),
      db.select({
        layerKey: mapLayers.layerKey,
        subLayerKey: mapLayers.subLayerKey,
        displayName: mapLayers.displayName,
      }).from(mapLayers)
        .where(and(
          eq(mapLayers.communityId, communityId),
          eq(mapLayers.isEnabled, true),
        )),
      db.select().from(serviceSchedules)
        .where(and(
          eq(serviceSchedules.communityId, communityId),
          eq(serviceSchedules.isActive, true),
        )),
      db.select({ cnt: sql<number>`count(*)::int` }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.status, "completed"),
        )),
    ]);

    let submittedCount = 0;
    let acknowledgedCount = 0;
    let inProgressCount = 0;
    for (const row of hoaStatusCounts) {
      if (row.status === "submitted") submittedCount = row.cnt;
      else if (row.status === "acknowledged") acknowledgedCount = row.cnt;
      else if (row.status === "in_progress") inProgressCount = row.cnt;
    }
    const completedRecentCount = recentCompletedCount[0]?.cnt ?? 0;

    const recentCompletions = await buildRecentCompletions(communityId, 8);

    const toSummary = (t: typeof tasks.$inferSelect): TaskSummary => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      dueDate: t.dueDate, windowStart: t.windowStart, windowEnd: t.windowEnd,
      origin: t.origin, assignedTo: t.assignedTo, communityId: t.communityId,
    });

    viewModel.hoaRequests = {
      byLifecycleStatus: {
        submittedCount,
        acknowledgedCount,
        inProgressCount,
        completedRecentCount,
      },
      recentCommunityCompletions: recentCompletions,
      upcomingWorkWindows: upcomingWorkWindows.map(toSummary),
      mapLayerAvailability: mapLayerRows,
      mowingSchedules: mowingScheduleRows.map(s => ({
        id: s.id,
        serviceType: s.serviceType,
        dayOfWeek: s.dayOfWeek,
        seasonStart: s.seasonStart,
        seasonEnd: s.seasonEnd,
      })),
    };

  } else if (role === "hoa_member") {
    const [upcomingCommunityWork, mowingScheduleRows] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
        ))
        .orderBy(asc(tasks.windowStart), asc(tasks.dueDate))
        .limit(10),
      db.select().from(serviceSchedules)
        .where(and(
          eq(serviceSchedules.communityId, communityId),
          eq(serviceSchedules.isActive, true),
        )),
    ]);

    const recentCompletions = await buildRecentCompletions(communityId, 8);

    const [memberCountRows, topRequests] = await Promise.all([
      db.select({
        status: tasks.status,
        cnt: sql<number>`count(*)::int`,
      })
        .from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged"]),
        ))
        .groupBy(tasks.status),
      db.select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        createdAt: tasks.createdAt,
      })
        .from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged"]),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(5),
    ]);

    const submittedCount = memberCountRows.find(r => r.status === "submitted")?.cnt ?? 0;
    const acknowledgedCount = memberCountRows.find(r => r.status === "acknowledged")?.cnt ?? 0;

    const toSummary = (t: typeof tasks.$inferSelect): TaskSummary => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      dueDate: t.dueDate, windowStart: t.windowStart, windowEnd: t.windowEnd,
      origin: t.origin, assignedTo: t.assignedTo, communityId: t.communityId,
    });

    viewModel.communityActivity = {
      recentCompletions,
      upcomingCommunityWork: upcomingCommunityWork.map(toSummary),
      serviceSchedules: mowingScheduleRows.map(s => ({
        id: s.id,
        serviceType: s.serviceType,
        dayOfWeek: s.dayOfWeek,
        seasonStart: s.seasonStart,
        seasonEnd: s.seasonEnd,
      })),
      requestsSummary: {
        submittedCount,
        acknowledgedCount,
        topRequests,
      },
    };

  } else if (role === "property_manager" || role === "admin") {
    const [openRequests, overdueItems, nextServiceWindows] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged"]),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          lt(tasks.dueDate, todayStart),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(10),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
          gt(tasks.windowStart, new Date(todayDateStr + "T23:59:59.999Z")),
        ))
        .orderBy(asc(tasks.windowStart))
        .limit(5),
    ]);

    const recentCompletions = await buildRecentCompletions(communityId, 10);

    const toSummary = (t: typeof tasks.$inferSelect): TaskSummary => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      dueDate: t.dueDate, windowStart: t.windowStart, windowEnd: t.windowEnd,
      origin: t.origin, assignedTo: t.assignedTo, communityId: t.communityId,
    });

    viewModel.pmOverview = {
      openRequests: openRequests.map(toSummary),
      overdueItems: overdueItems.map(toSummary),
      recentCompletions,
      nextScheduledServiceWindows: nextServiceWindows.map(toSummary),
    };
  }

  return viewModel;
}

export type TaskPageFilters = {
  status?: string;
  priority?: string;
  assignedTo?: string;
};

function toTaskPageItem(t: typeof tasks.$inferSelect): TaskPageTaskItem {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    windowStart: t.windowStart,
    windowEnd: t.windowEnd,
    origin: t.origin,
    assignedTo: t.assignedTo,
    communityId: t.communityId,
    acknowledgedAt: t.acknowledgedAt,
  };
}

async function buildTaskPageCompletions(communityId: string, limit = 8, assignedTo?: string): Promise<TaskPageCompletionItem[]> {
  return buildRecentCompletions(communityId, limit, assignedTo);
}

export async function getTaskPageDataForRole(
  role: string,
  userId: string,
  communityId: string | null,
  filters: TaskPageFilters = {},
  _mode?: string,
): Promise<TaskPageViewModel> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const meta = {
    generatedAt: now.toISOString(),
    role,
    communityId,
    filters: {
      status: filters.status,
      priority: filters.priority,
      assignedTo: filters.assignedTo,
    },
  };

  const VALID_ROLES = new Set(userRoleEnum.enumValues);
  if (!VALID_ROLES.has(role as (typeof userRoleEnum.enumValues)[number])) {
    throw new Error(`getTaskPageDataForRole: unrecognised role "${role}"`);
  }

  if (role === "contractor") {
    if (!communityId) {
      return {
        role: "contractor",
        meta,
        activeTasks: [],
        overdueTasks: [],
        pendingAcknowledgment: [],
        upcomingScheduled: [],
        recentCompletions: [],
      };
    }

    const [activeTasks, overdueTasks, pendingAcknowledgment, upcomingScheduled] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
        ))
        .orderBy(asc(tasks.dueDate), asc(tasks.priority))
        .limit(50),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          lt(tasks.dueDate, todayStart),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          eq(tasks.origin, "HOA"),
          eq(tasks.status, "submitted"),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.assignedTo, userId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
          gt(tasks.windowStart, now),
        ))
        .orderBy(asc(tasks.windowStart))
        .limit(10),
    ]);

    const recentCompletions = await buildTaskPageCompletions(communityId, 10, userId);

    return {
      role: "contractor",
      meta,
      activeTasks: activeTasks.map(toTaskPageItem),
      overdueTasks: overdueTasks.map(toTaskPageItem),
      pendingAcknowledgment: pendingAcknowledgment.map(toTaskPageItem),
      upcomingScheduled: upcomingScheduled.map(toTaskPageItem),
      recentCompletions,
    };
  }

  if (role === "hoa_admin") {
    if (!communityId) {
      return {
        role: "hoa_admin",
        meta,
        requestsByStatus: { submittedCount: 0, acknowledgedCount: 0, inProgressCount: 0, completedRecentCount: 0, topRequests: [] },
        upcomingCommunityWork: [],
        completedCommunityWork: [],
        contractorAssignments: [],
      };
    }

    const [statusCounts, topRequests, upcomingCommunityWork, contractorAssignments, completedRecentCountRows] = await Promise.all([
      db.select({
        status: tasks.status,
        cnt: sql<number>`count(*)::int`,
      }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged", "in_progress"]),
        ))
        .groupBy(tasks.status),
      db.select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        createdAt: tasks.createdAt,
      }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged", "in_progress"]),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(10),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.windowStart),
        ))
        .orderBy(asc(tasks.windowStart), asc(tasks.dueDate))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          isNotNull(tasks.assignedTo),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(20),
      db.select({ cnt: sql<number>`count(*)::int` }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.status, "completed"),
        )),
    ]);

    let submittedCount = 0;
    let acknowledgedCount = 0;
    let inProgressCount = 0;
    for (const row of statusCounts) {
      if (row.status === "submitted") submittedCount = row.cnt;
      else if (row.status === "acknowledged") acknowledgedCount = row.cnt;
      else if (row.status === "in_progress") inProgressCount = row.cnt;
    }
    const completedRecentCount = completedRecentCountRows[0]?.cnt ?? 0;
    const completedCommunityWork = await buildTaskPageCompletions(communityId, 10);

    return {
      role: "hoa_admin",
      meta,
      requestsByStatus: { submittedCount, acknowledgedCount, inProgressCount, completedRecentCount, topRequests },
      upcomingCommunityWork: upcomingCommunityWork.map(toTaskPageItem),
      completedCommunityWork,
      contractorAssignments: contractorAssignments.map(toTaskPageItem),
    };
  }

  if (role === "hoa_member") {
    if (!communityId) {
      return {
        role: "hoa_member",
        meta,
        communityUpcoming: [],
        recentCompletions: [],
        myRequests: [],
      };
    }

    const [communityUpcoming, myRequests] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          inArray(tasks.status, ["pending", "in_progress", "acknowledged"]),
        ))
        .orderBy(asc(tasks.windowStart), asc(tasks.dueDate))
        .limit(20),
      db.select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        status: tasks.status,
        createdAt: tasks.createdAt,
      }).from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.createdBy, userId),
          eq(tasks.origin, "HOA"),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(20),
    ]);

    const recentCompletions = await buildTaskPageCompletions(communityId, 8);

    return {
      role: "hoa_member",
      meta,
      communityUpcoming: communityUpcoming.map(toTaskPageItem),
      recentCompletions,
      myRequests,
    };
  }

  if (role === "property_manager" || role === "admin") {
    if (!communityId) {
      return {
        role: role as "property_manager" | "admin",
        meta,
        openRequests: [],
        overdueWork: [],
        activeTasks: [],
        completedSummary: [],
      };
    }

    const [openRequests, overdueWork, activeTasks] = await Promise.all([
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.origin, "HOA"),
          inArray(tasks.status, ["submitted", "acknowledged"]),
        ))
        .orderBy(desc(tasks.createdAt))
        .limit(30),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          ne(tasks.status, "completed"),
          lt(tasks.dueDate, todayStart),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(20),
      db.select().from(tasks)
        .where(and(
          eq(tasks.communityId, communityId),
          eq(tasks.status, "in_progress"),
        ))
        .orderBy(asc(tasks.dueDate))
        .limit(30),
    ]);

    const completedSummary = await buildTaskPageCompletions(communityId, 10);

    return {
      role: role as "property_manager" | "admin",
      meta,
      openRequests: openRequests.map(toTaskPageItem),
      overdueWork: overdueWork.map(toTaskPageItem),
      activeTasks: activeTasks.map(toTaskPageItem),
      completedSummary,
    };
  }

  return {
    role: role as "contractor",
    meta,
    activeTasks: [],
    overdueTasks: [],
    pendingAcknowledgment: [],
    upcomingScheduled: [],
    recentCompletions: [],
  };
}

export type SearchResult = {
  id: string;
  type: "asset" | "task";
  label: string;
  assetType?: string;
  status?: string;
  priority?: string;
  dueDate?: Date | null;
  communityId: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  relevance: number;
  matchField?: string;
};

export async function searchAll(
  query: string,
  communityIds: string[],
  types: string[],
  userId: string,
  isAdmin: boolean,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const q = query.trim().toLowerCase();
  if (!q || communityIds.length === 0) return results;
  const pattern = `%${q}%`;

  const searchAssets = types.length === 0 || types.includes("asset");
  const searchTasks = types.length === 0 || types.includes("task");

  if (searchAssets) {
    const assetRows = await db.select().from(assets)
      .where(and(
        inArray(assets.communityId, communityIds),
        eq(assets.isArchived, false),
        or(
          ilike(assets.label, pattern),
          ilike(assets.featureRef, pattern),
        ),
      ))
      .limit(30);

    for (const a of assetRows) {
      let relevance = 0;
      const labelLower = a.label.toLowerCase();
      if (labelLower === q) relevance = 100;
      else if (labelLower.startsWith(q)) relevance = 80;
      else if (labelLower.includes(q)) relevance = 60;
      else if (a.featureRef?.toLowerCase().includes(q)) relevance = 50;
      results.push({
        id: a.id, type: "asset", label: a.label, assetType: a.assetType,
        communityId: a.communityId, latitude: a.latitude, longitude: a.longitude,
        relevance, matchField: "label",
      });
    }

    const propSearchKeys = ["serialNumber", "name", "zoneNumber", "species", "controllerRef", "brand", "address"];
    const propMatches = await db.select({
      assetId: assetProperties.assetId,
      key: assetProperties.key,
      value: assetProperties.value,
    }).from(assetProperties)
      .innerJoin(assets, eq(assetProperties.assetId, assets.id))
      .where(and(
        inArray(assets.communityId, communityIds),
        eq(assets.isArchived, false),
        inArray(assetProperties.key, propSearchKeys),
        ilike(assetProperties.value, pattern),
      ))
      .limit(30);

    const alreadyFound = new Set(results.map(r => r.id));
    const assetIdsFromProps = propMatches
      .map(p => p.assetId)
      .filter(id => !alreadyFound.has(id));

    if (assetIdsFromProps.length > 0) {
      const uniqueIds = [...new Set(assetIdsFromProps)];
      const propAssets = await db.select().from(assets)
        .where(inArray(assets.id, uniqueIds));

      for (const a of propAssets) {
        const matchedProp = propMatches.find(p => p.assetId === a.id);
        const valLower = matchedProp?.value?.toLowerCase() || '';
        let relevance = 0;
        if (valLower === q) relevance = 90;
        else if (valLower.startsWith(q)) relevance = 70;
        else relevance = 50;
        results.push({
          id: a.id, type: "asset", label: a.label, assetType: a.assetType,
          communityId: a.communityId, latitude: a.latitude, longitude: a.longitude,
          relevance, matchField: matchedProp?.key,
          address: matchedProp?.key === "address" ? matchedProp.value : null,
        });
      }
    }
  }

  if (searchTasks) {
    const taskConditions = [
      inArray(tasks.communityId, communityIds),
      or(
        ilike(tasks.title, pattern),
        ilike(tasks.description, pattern),
        ilike(tasks.address, pattern),
      ),
    ];
    if (!isAdmin) {
      taskConditions.push(eq(tasks.assignedTo, userId));
    }

    const taskRows = await db.select().from(tasks)
      .where(and(...taskConditions))
      .limit(30);

    for (const t of taskRows) {
      let relevance = 0;
      const titleLower = t.title.toLowerCase();
      if (titleLower === q) relevance = 100;
      else if (titleLower.startsWith(q)) relevance = 80;
      else if (titleLower.includes(q)) relevance = 65;
      else if (t.address?.toLowerCase().includes(q)) relevance = 55;
      else if (t.description?.toLowerCase().includes(q)) relevance = 40;
      results.push({
        id: t.id, type: "task", label: t.title, status: t.status, priority: t.priority,
        dueDate: t.dueDate, communityId: t.communityId, latitude: t.latitude,
        longitude: t.longitude, address: t.address, relevance,
      });
    }
  }

  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, 30);
}

export async function getTaskTemplates(): Promise<TaskTemplate[]> {
  return db.select().from(taskTemplates).orderBy(desc(taskTemplates.createdAt));
}

export async function getTaskTemplateById(id: string): Promise<TaskTemplate | undefined> {
  const [t] = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id));
  return t;
}

export async function createTaskTemplate(data: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskTemplate> {
  const [t] = await db.insert(taskTemplates).values(data).returning();
  return t;
}

export async function updateTaskTemplate(id: string, data: Partial<Omit<TaskTemplate, 'id' | 'createdAt' | 'createdBy'>>): Promise<TaskTemplate | null> {
  const [t] = await db.update(taskTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(taskTemplates.id, id))
    .returning();
  return t || null;
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
}

export async function getTargetAssets(
  communityId: string,
  targetType: string,
  targetAssetType?: string | null,
  targetMapLayerId?: string | null,
  targetAssetId?: string | null,
  includeArchived = false,
  limit?: number,
): Promise<Asset[]> {
  const conditions = [eq(assets.communityId, communityId)];
  if (!includeArchived) {
    conditions.push(eq(assets.isArchived, false));
  }

  if (targetType === 'asset_type' && targetAssetType) {
    conditions.push(eq(assets.assetType, targetAssetType as any));
  } else if (targetType === 'map_layer' && targetMapLayerId) {
    conditions.push(eq(assets.mapLayerId, targetMapLayerId));
  } else if (targetType === 'specific_asset' && targetAssetId) {
    conditions.push(eq(assets.id, targetAssetId));
  } else {
    return [];
  }

  let query = db.select().from(assets).where(and(...conditions)).orderBy(assets.label);
  if (limit) {
    query = query.limit(limit) as any;
  }
  return query;
}

export async function createTemplateRun(data: {
  templateId: string;
  communityId: string;
  createdBy: string;
  taskCountCreated: number;
  assignmentUserId?: string | null;
}): Promise<TemplateRun> {
  const [run] = await db.insert(templateRuns).values(data).returning();
  return run;
}

export async function getTemplateRuns(templateId?: string): Promise<TemplateRun[]> {
  const conditions = templateId ? [eq(templateRuns.templateId, templateId)] : [];
  return db.select().from(templateRuns)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(templateRuns.runAt));
}

export async function bulkAssignTasks(taskIds: string[], assignedTo: string): Promise<number> {
  const result = await db.update(tasks)
    .set({ assignedTo, updatedAt: new Date() })
    .where(inArray(tasks.id, taskIds));
  return taskIds.length;
}

// --- Task Schedules ---

export async function getTaskSchedules(communityId?: string): Promise<TaskSchedule[]> {
  const conditions = communityId ? [eq(taskSchedules.communityId, communityId)] : [];
  return db.select().from(taskSchedules)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(taskSchedules.createdAt));
}

export async function getTaskScheduleById(id: string): Promise<TaskSchedule | undefined> {
  const [schedule] = await db.select().from(taskSchedules).where(eq(taskSchedules.id, id));
  return schedule;
}

export async function createTaskSchedule(data: {
  communityId: string;
  templateId: string;
  frequency: "weekly" | "monthly" | "once";
  daysOfWeek?: string | null;
  dayOfMonth?: number | null;
  timezone: string;
  startDate: Date;
  endDate?: Date | null;
  nextRunAt?: Date | null;
  assignToUserId?: string | null;
  isEnabled: boolean;
  createdBy: string;
}): Promise<TaskSchedule> {
  const [schedule] = await db.insert(taskSchedules).values(data).returning();
  return schedule;
}

export async function updateTaskSchedule(id: string, data: Partial<{
  frequency: "weekly" | "monthly" | "once";
  daysOfWeek: string | null;
  dayOfMonth: number | null;
  timezone: string;
  startDate: Date;
  endDate: Date | null;
  nextRunAt: Date | null;
  assignToUserId: string | null;
  isEnabled: boolean;
}>): Promise<TaskSchedule | undefined> {
  const [updated] = await db.update(taskSchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(taskSchedules.id, id))
    .returning();
  return updated;
}

export async function deleteTaskSchedule(id: string): Promise<void> {
  await db.delete(scheduleRunItems).where(
    inArray(scheduleRunItems.runId,
      db.select({ id: scheduleRuns.id }).from(scheduleRuns).where(eq(scheduleRuns.scheduleId, id))
    )
  );
  await db.delete(scheduleRuns).where(eq(scheduleRuns.scheduleId, id));
  await db.delete(taskSchedules).where(eq(taskSchedules.id, id));
}

export async function getEnabledDueSchedules(): Promise<TaskSchedule[]> {
  return db.select().from(taskSchedules)
    .where(and(
      eq(taskSchedules.isEnabled, true),
      lte(taskSchedules.nextRunAt, new Date()),
    ))
    .orderBy(asc(taskSchedules.nextRunAt));
}

export async function getScheduleRuns(scheduleId: string, limit = 20): Promise<ScheduleRun[]> {
  return db.select().from(scheduleRuns)
    .where(eq(scheduleRuns.scheduleId, scheduleId))
    .orderBy(desc(scheduleRuns.runAt))
    .limit(limit);
}

export async function createScheduleRun(data: {
  scheduleId: string;
  windowStart: Date;
  windowEnd: Date;
  createdCount: number;
  skippedCount: number;
  status: "success" | "failure";
  errorMessage?: string | null;
}): Promise<ScheduleRun> {
  const [run] = await db.insert(scheduleRuns).values(data).returning();
  return run;
}

export async function createScheduleRunItem(runId: string, taskId: string): Promise<void> {
  await db.insert(scheduleRunItems).values({ runId, taskId });
}

export async function taskExistsWithInstanceKey(key: string): Promise<boolean> {
  const [row] = await db.select({ id: tasks.id }).from(tasks)
    .where(eq(tasks.scheduleInstanceKey, key))
    .limit(1);
  return !!row;
}

export async function createTaskWithInstanceKey(data: {
  communityId: string;
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  latitude?: number;
  longitude?: number;
  assignedTo?: string;
  createdBy: string;
  dueDate?: Date;
  scheduleInstanceKey: string;
}): Promise<Task> {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function updateScheduleNextRunAt(id: string, nextRunAt: Date | null): Promise<void> {
  await db.update(taskSchedules)
    .set({ nextRunAt, updatedAt: new Date() })
    .where(eq(taskSchedules.id, id));
}

export async function getServiceSchedulesByCommunity(communityId: string): Promise<ServiceSchedule[]> {
  return db.select().from(serviceSchedules)
    .where(eq(serviceSchedules.communityId, communityId))
    .orderBy(asc(serviceSchedules.dayOfWeek));
}

export async function getServiceScheduleById(id: string): Promise<ServiceSchedule | undefined> {
  const [schedule] = await db.select().from(serviceSchedules).where(eq(serviceSchedules.id, id));
  return schedule;
}

export async function createServiceSchedule(data: {
  communityId: string;
  serviceType?: "mowing_visit";
  dayOfWeek: number;
  seasonStart?: string | null;
  seasonEnd?: string | null;
  notes?: string | null;
  isActive?: boolean;
}): Promise<ServiceSchedule> {
  const [schedule] = await db.insert(serviceSchedules).values(data).returning();
  return schedule;
}

export async function updateServiceSchedule(id: string, data: {
  dayOfWeek?: number;
  seasonStart?: string | null;
  seasonEnd?: string | null;
  notes?: string | null;
  isActive?: boolean;
}): Promise<ServiceSchedule | undefined> {
  const [updated] = await db.update(serviceSchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(serviceSchedules.id, id))
    .returning();
  return updated;
}

export async function deleteServiceSchedule(id: string): Promise<boolean> {
  await db.delete(serviceVisits).where(eq(serviceVisits.scheduleId, id));
  const result = await db.delete(serviceSchedules).where(eq(serviceSchedules.id, id)).returning();
  return result.length > 0;
}

export async function getServiceVisits(scheduleId: string, opts?: { from?: string; to?: string }): Promise<ServiceVisit[]> {
  const conditions = [eq(serviceVisits.scheduleId, scheduleId)];
  if (opts?.from) conditions.push(gte(serviceVisits.serviceDate, opts.from));
  if (opts?.to) conditions.push(lte(serviceVisits.serviceDate, opts.to));
  return db.select().from(serviceVisits)
    .where(and(...conditions))
    .orderBy(asc(serviceVisits.serviceDate));
}

export async function getServiceVisitsByCommunity(communityId: string, opts?: { from?: string; to?: string }): Promise<ServiceVisit[]> {
  const conditions = [eq(serviceVisits.communityId, communityId)];
  if (opts?.from) conditions.push(gte(serviceVisits.serviceDate, opts.from));
  if (opts?.to) conditions.push(lte(serviceVisits.serviceDate, opts.to));
  return db.select().from(serviceVisits)
    .where(and(...conditions))
    .orderBy(asc(serviceVisits.serviceDate));
}

export async function upsertServiceVisit(data: {
  scheduleId: string;
  communityId: string;
  serviceDate: string;
  completedAt?: Date | null;
  completedBy?: string | null;
  employeeSignOffName?: string;
  notes?: string | null;
}): Promise<ServiceVisit> {
  const [visit] = await db.insert(serviceVisits)
    .values(data)
    .onConflictDoUpdate({
      target: [serviceVisits.scheduleId, serviceVisits.serviceDate],
      set: {
        completedAt: data.completedAt ?? new Date(),
        completedBy: data.completedBy,
        employeeSignOffName: data.employeeSignOffName ?? '',
        notes: data.notes,
        updatedAt: new Date(),
      },
    })
    .returning();
  return visit;
}

export async function getAssetNotes(assetId: string) {
  return db
    .select({
      id: assetNotes.id,
      assetId: assetNotes.assetId,
      communityId: assetNotes.communityId,
      createdBy: assetNotes.createdBy,
      noteText: assetNotes.noteText,
      createdAt: assetNotes.createdAt,
      creatorName: users.displayName,
    })
    .from(assetNotes)
    .leftJoin(users, eq(assetNotes.createdBy, users.id))
    .where(eq(assetNotes.assetId, assetId))
    .orderBy(desc(assetNotes.createdAt));
}

export async function getHoaRequests(communityId: string) {
  const hoaTasks = await db.select().from(tasks)
    .where(and(eq(tasks.communityId, communityId), eq(tasks.origin, 'HOA')))
    .orderBy(desc(tasks.createdAt));

  if (hoaTasks.length === 0) return [];

  const taskIds = hoaTasks.map(t => t.id);

  const completionsRows = await db.select({
    taskId: taskCompletions.taskId,
    completedAt: taskCompletions.completedAt,
  }).from(taskCompletions)
    .where(inArray(taskCompletions.taskId, taskIds));

  const latestCompletionMap = new Map<string, Date>();
  for (const row of completionsRows) {
    const existing = latestCompletionMap.get(row.taskId);
    if (!existing || row.completedAt > existing) {
      latestCompletionMap.set(row.taskId, row.completedAt);
    }
  }

  const completionIds = await db.select({
    id: taskCompletions.id,
    taskId: taskCompletions.taskId,
  }).from(taskCompletions)
    .where(inArray(taskCompletions.taskId, taskIds));

  let attachmentCounts = new Map<string, number>();
  if (completionIds.length > 0) {
    const attRows = await db.select({
      taskCompletionId: attachments.taskCompletionId,
      cnt: sql<number>`count(*)`,
    }).from(attachments)
      .where(inArray(attachments.taskCompletionId, completionIds.map(c => c.id)))
      .groupBy(attachments.taskCompletionId);

    const completionToTask = new Map<string, string>();
    for (const c of completionIds) {
      completionToTask.set(c.id, c.taskId);
    }
    for (const row of attRows) {
      const tId = completionToTask.get(row.taskCompletionId);
      if (tId) {
        attachmentCounts.set(tId, (attachmentCounts.get(tId) || 0) + Number(row.cnt));
      }
    }
  }

  const assetIds = hoaTasks.map(t => t.assetId).filter((id): id is string => !!id);
  let assetLabelMap = new Map<string, string>();
  if (assetIds.length > 0) {
    const assetRows = await db.select({ id: assets.id, label: assets.label })
      .from(assets)
      .where(inArray(assets.id, assetIds));
    for (const a of assetRows) {
      assetLabelMap.set(a.id, a.label);
    }
  }

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  return hoaTasks.map(task => {
    const latestCompletedAt = latestCompletionMap.get(task.id) ?? null;
    const isArchived = task.status === 'completed' && latestCompletedAt != null && latestCompletedAt <= sixtyDaysAgo;
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      createdAt: task.createdAt,
      completedAt: latestCompletedAt,
      isArchived,
      assetId: task.assetId ?? null,
      assetLabel: task.assetId ? (assetLabelMap.get(task.assetId) ?? null) : null,
      latitude: task.latitude ?? null,
      longitude: task.longitude ?? null,
      attachmentCount: attachmentCounts.get(task.id) || 0,
      category: task.category ?? null,
    };
  });
}

export async function getHoaDashboardData(communityId: string) {
  const community = await getCommunityById(communityId);

  const upcomingTasks = await db.select().from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      ne(tasks.status, "completed"),
    ))
    .orderBy(asc(tasks.windowStart), asc(tasks.dueDate))
    .limit(10);

  const completedTaskRows = await db.select().from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      eq(tasks.status, "completed"),
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(8);

  const completedTaskIds = completedTaskRows.map(t => t.id);

  let completionMap = new Map<string, Date>();
  let attachmentCountMap = new Map<string, number>();

  if (completedTaskIds.length > 0) {
    const completionRows = await db.select({
      taskId: taskCompletions.taskId,
      completedAt: taskCompletions.completedAt,
      id: taskCompletions.id,
    }).from(taskCompletions)
      .where(inArray(taskCompletions.taskId, completedTaskIds))
      .orderBy(desc(taskCompletions.completedAt));

    for (const c of completionRows) {
      if (!completionMap.has(c.taskId)) {
        completionMap.set(c.taskId, c.completedAt);
      }
    }

    const completionIds = completionRows.map(c => c.id);
    if (completionIds.length > 0) {
      const attRows = await db.select({
        taskCompletionId: attachments.taskCompletionId,
        cnt: sql<number>`count(*)`,
      }).from(attachments)
        .where(inArray(attachments.taskCompletionId, completionIds))
        .groupBy(attachments.taskCompletionId);

      const completionToTask = new Map<string, string>();
      for (const c of completionRows) {
        completionToTask.set(c.id, c.taskId);
      }
      for (const row of attRows) {
        const tId = completionToTask.get(row.taskCompletionId);
        if (tId) {
          attachmentCountMap.set(tId, (attachmentCountMap.get(tId) || 0) + Number(row.cnt));
        }
      }
    }
  }

  const recentCompletions = completedTaskRows.map(t => ({
    id: t.id,
    title: t.title,
    completedAt: completionMap.get(t.id) ?? t.updatedAt,
    origin: t.origin,
    priority: t.priority,
    hasPhotos: (attachmentCountMap.get(t.id) || 0) > 0,
  }));

  const hoaRequests = await db.select().from(tasks)
    .where(and(
      eq(tasks.communityId, communityId),
      eq(tasks.origin, "HOA"),
      or(eq(tasks.status, "submitted"), eq(tasks.status, "acknowledged")),
    ))
    .orderBy(desc(tasks.createdAt));

  const submittedCount = hoaRequests.filter(r => r.status === "submitted").length;
  const acknowledgedCount = hoaRequests.filter(r => r.status === "acknowledged").length;
  const topRequests = hoaRequests.slice(0, 5).map(r => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    status: r.status,
    createdAt: r.createdAt,
  }));

  const mowingSchedules = await db.select().from(serviceSchedules)
    .where(and(
      eq(serviceSchedules.communityId, communityId),
      eq(serviceSchedules.isActive, true),
    ));

  return {
    community: community ? { id: community.id, name: community.name } : null,
    upcomingTasks: upcomingTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      windowStart: t.windowStart,
      windowEnd: t.windowEnd,
      dueDate: t.dueDate,
      origin: t.origin,
      priority: t.priority,
      assetId: t.assetId,
    })),
    recentCompletions,
    requestsSummary: {
      submittedCount,
      acknowledgedCount,
      topRequests,
    },
    mowingSchedules: mowingSchedules.map(s => ({
      id: s.id,
      serviceType: s.serviceType,
      dayOfWeek: s.dayOfWeek,
      seasonStart: s.seasonStart,
      seasonEnd: s.seasonEnd,
    })),
  };
}

export async function createAssetNote(data: {
  assetId: string;
  communityId: string;
  createdBy: string;
  noteText: string;
  idempotencyKey?: string;
}): Promise<AssetNote> {
  if (data.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(assetNotes)
      .where(eq(assetNotes.idempotencyKey, data.idempotencyKey));
    if (existing) return existing;
  }
  const [note] = await db.insert(assetNotes).values(data).returning();
  return note;
}

export async function deleteAssetNote(noteId: string): Promise<boolean> {
  const result = await db.delete(assetNotes).where(eq(assetNotes.id, noteId)).returning();
  return result.length > 0;
}

export async function getAssetNoteById(noteId: string): Promise<AssetNote | undefined> {
  const [note] = await db.select().from(assetNotes).where(eq(assetNotes.id, noteId));
  return note;
}

export async function getCommunityBounds(communityId: string): Promise<{ bounds: [[number, number], [number, number]]; center: [number, number] } | null> {
  const layers = await db.select().from(mapLayers).where(eq(mapLayers.communityId, communityId));
  if (layers.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  let hasCoords = false;

  function extractCoords(coords: any): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        hasCoords = true;
      }
      return;
    }
    for (const item of coords) {
      extractCoords(item);
    }
  }

  for (const layer of layers) {
    if (!layer.geojsonData) continue;
    try {
      const geojson = JSON.parse(layer.geojsonData);
      const features = geojson.features || (geojson.type === 'Feature' ? [geojson] : []);
      for (const feature of features) {
        if (feature.geometry && feature.geometry.coordinates) {
          extractCoords(feature.geometry.coordinates);
        }
      }
    } catch {
    }
  }

  if (!hasCoords) return null;

  return {
    bounds: [[minLat, minLng], [maxLat, maxLng]],
    center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
  };
}

export type NotificationPreferences = {
  taskAssigned: boolean;
  dueReminders: boolean;
  syncFailure: boolean;
  taskCompleted: boolean;
  requestSubmitted: boolean;
  requestCompleted: boolean;
  requestStatusUpdates: boolean;
};

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  taskAssigned: true,
  dueReminders: true,
  syncFailure: true,
  taskCompleted: true,
  requestSubmitted: true,
  requestCompleted: true,
  requestStatusUpdates: true,
};

export async function getUserNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const [user] = await db.select({ notificationPreferences: users.notificationPreferences }).from(users).where(eq(users.id, userId));
  if (!user || !user.notificationPreferences) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(user.notificationPreferences as NotificationPreferences) };
}

export async function setUserNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
  await db.update(users).set({ notificationPreferences: prefs }).where(eq(users.id, userId));
}

export async function createNotification(data: {
  communityId: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  relatedTaskId?: string;
}): Promise<Notification> {
  const [notif] = await db.insert(notifications).values(data).returning();
  return notif;
}

export async function getNotificationsForUser(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
  return db.select().from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(
      eq(notifications.recipientUserId, userId),
      sql`${notifications.readAt} IS NULL`,
    ));
  return result?.count ?? 0;
}

export async function markNotificationRead(id: string, userId: string): Promise<Notification | null> {
  const [notif] = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.id, id),
      eq(notifications.recipientUserId, userId),
    ))
    .returning();
  return notif ?? null;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.recipientUserId, userId),
      sql`${notifications.readAt} IS NULL`,
    ));
}

/** @deprecated Use getHoaAdminsForCommunity to notify all admins, not just the first. */
export async function getHoaAdminForCommunity(communityId: string): Promise<User | null> {
  const members = await db.select().from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .where(and(
      eq(communityMembers.communityId, communityId),
      eq(users.role, "hoa_admin"),
    ))
    .limit(1);
  return members.length > 0 ? members[0].users : null;
}

export async function getHoaAdminsForCommunity(communityId: string): Promise<User[]> {
  const members = await db.select().from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .where(and(
      eq(communityMembers.communityId, communityId),
      eq(users.role, "hoa_admin"),
    ));
  return members.map(m => m.users);
}

export async function getPropertyManagersForCommunity(communityId: string): Promise<User[]> {
  const members = await db.select().from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .where(and(
      eq(communityMembers.communityId, communityId),
      eq(users.role, "property_manager"),
    ));
  return members.map(m => m.users);
}

export async function getContractorsForCommunity(communityId: string): Promise<User[]> {
  const members = await db.select().from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .where(and(
      eq(communityMembers.communityId, communityId),
      inArray(users.role, ["contractor", "admin"]),
    ));
  return members.map(m => m.users);
}

export async function getDriveFolders(communityId: string, parentId?: string | null): Promise<(DriveFolder & { creatorName?: string })[]> {
  const conditions = [eq(driveFolders.communityId, communityId)];
  if (parentId) {
    conditions.push(eq(driveFolders.parentId, parentId));
  } else {
    conditions.push(isNull(driveFolders.parentId));
  }
  const rows = await db.select({
    folder: driveFolders,
    creatorName: users.displayName,
  }).from(driveFolders)
    .leftJoin(users, eq(driveFolders.createdBy, users.id))
    .where(and(...conditions))
    .orderBy(asc(driveFolders.name));
  return rows.map(r => ({ ...r.folder, creatorName: r.creatorName || undefined }));
}

export async function getDriveFiles(communityId: string, folderId?: string | null): Promise<(DriveFile & { uploaderName?: string })[]> {
  const conditions = [eq(driveFiles.communityId, communityId)];
  if (folderId) {
    conditions.push(eq(driveFiles.folderId, folderId));
  } else {
    conditions.push(isNull(driveFiles.folderId));
  }
  const rows = await db.select({
    file: driveFiles,
    uploaderName: users.displayName,
  }).from(driveFiles)
    .leftJoin(users, eq(driveFiles.uploadedBy, users.id))
    .where(and(...conditions))
    .orderBy(asc(driveFiles.name));
  return rows.map(r => ({ ...r.file, uploaderName: r.uploaderName || undefined }));
}

export async function getDriveFolder(id: string): Promise<DriveFolder | null> {
  const [folder] = await db.select().from(driveFolders).where(eq(driveFolders.id, id));
  return folder || null;
}

export async function createDriveFolder(data: { communityId: string; parentId?: string | null; name: string; createdBy: string }): Promise<DriveFolder> {
  const [folder] = await db.insert(driveFolders).values(data).returning();
  return folder;
}

export async function updateDriveFolder(id: string, data: { name: string }): Promise<DriveFolder> {
  const [folder] = await db.update(driveFolders).set({ ...data, updatedAt: new Date() }).where(eq(driveFolders.id, id)).returning();
  return folder;
}

export async function deleteDriveFolder(id: string): Promise<void> {
  const childFolders = await db.select().from(driveFolders).where(eq(driveFolders.parentId, id)).limit(1);
  if (childFolders.length > 0) throw new Error("FOLDER_NOT_EMPTY");
  const childFiles = await db.select().from(driveFiles).where(eq(driveFiles.folderId, id)).limit(1);
  if (childFiles.length > 0) throw new Error("FOLDER_NOT_EMPTY");
  await db.delete(driveFolders).where(eq(driveFolders.id, id));
}

export async function createDriveFile(data: { communityId: string; folderId?: string | null; name: string; fileRef: string; mimeType?: string | null; sizeBytes?: number | null; uploadedBy: string }): Promise<DriveFile> {
  const [file] = await db.insert(driveFiles).values(data).returning();
  return file;
}

export async function updateDriveFile(id: string, data: { name: string }): Promise<DriveFile> {
  const [file] = await db.update(driveFiles).set({ ...data, updatedAt: new Date() }).where(eq(driveFiles.id, id)).returning();
  return file;
}

export async function deleteDriveFile(id: string): Promise<DriveFile> {
  const [file] = await db.delete(driveFiles).where(eq(driveFiles.id, id)).returning();
  return file;
}

export async function getDriveFile(id: string): Promise<DriveFile | null> {
  const [file] = await db.select().from(driveFiles).where(eq(driveFiles.id, id));
  return file || null;
}

export async function getInvoices(communityId?: string): Promise<(Invoice & { communityName?: string })[]> {
  if (communityId) {
    const rows = await db.select({
      invoice: invoices,
      communityName: communities.name,
    }).from(invoices)
      .leftJoin(communities, eq(invoices.communityId, communities.id))
      .where(eq(invoices.communityId, communityId))
      .orderBy(desc(invoices.completionDate));
    return rows.map(r => ({ ...r.invoice, communityName: r.communityName || undefined }));
  }
  const rows = await db.select({
    invoice: invoices,
    communityName: communities.name,
  }).from(invoices)
    .leftJoin(communities, eq(invoices.communityId, communities.id))
    .orderBy(desc(invoices.completionDate));
  return rows.map(r => ({ ...r.invoice, communityName: r.communityName || undefined }));
}

export async function getInvoiceById(id: string): Promise<(Invoice & { communityName?: string }) | null> {
  const rows = await db.select({
    invoice: invoices,
    communityName: communities.name,
  }).from(invoices)
    .leftJoin(communities, eq(invoices.communityId, communities.id))
    .where(eq(invoices.id, id));
  if (rows.length === 0) return null;
  return { ...rows[0].invoice, communityName: rows[0].communityName || undefined };
}

export async function createInvoice(data: {
  communityId: string;
  contractor: string;
  completionDate: string;
  serviceType: string;
  cost: number;
  notes?: string | null;
  pdfObjectKey?: string | null;
  attachmentLabel?: string | null;
  attachmentLayerId?: string | null;
}): Promise<Invoice> {
  const [invoice] = await db.insert(invoices).values(data).returning();
  return invoice;
}

export async function updateInvoice(id: string, data: Partial<{
  contractor: string;
  completionDate: string;
  serviceType: string;
  cost: number;
  notes: string | null;
  pdfObjectKey: string | null;
  attachmentLabel: string | null;
  attachmentLayerId: string | null;
}>): Promise<Invoice | null> {
  const [invoice] = await db.update(invoices)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();
  return invoice || null;
}

export async function deleteInvoice(id: string): Promise<void> {
  await db.delete(invoices).where(eq(invoices.id, id));
}

export async function getContracts(communityId?: string, contractorUserId?: string): Promise<(Contract & { communityName?: string; contractorName?: string })[]> {
  const conditions = [];
  if (communityId) conditions.push(eq(contracts.communityId, communityId));
  if (contractorUserId) conditions.push(eq(contracts.contractorUserId, contractorUserId));

  const rows = await db.select({
    contract: contracts,
    communityName: communities.name,
    contractorName: users.displayName,
  }).from(contracts)
    .leftJoin(communities, eq(contracts.communityId, communities.id))
    .leftJoin(users, eq(contracts.contractorUserId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(contracts.createdAt));
  return rows.map(r => ({ ...r.contract, communityName: r.communityName || undefined, contractorName: r.contractorName || undefined }));
}

export async function getContractById(id: string): Promise<(Contract & { communityName?: string; contractorName?: string }) | null> {
  const rows = await db.select({
    contract: contracts,
    communityName: communities.name,
    contractorName: users.displayName,
  }).from(contracts)
    .leftJoin(communities, eq(contracts.communityId, communities.id))
    .leftJoin(users, eq(contracts.contractorUserId, users.id))
    .where(eq(contracts.id, id));
  if (rows.length === 0) return null;
  return { ...rows[0].contract, communityName: rows[0].communityName || undefined, contractorName: rows[0].contractorName || undefined };
}

export async function createContract(data: {
  communityId: string;
  contractorUserId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  servicesIncluded?: string[];
  pdfObjectKey?: string | null;
  isActive?: boolean;
}): Promise<Contract> {
  const [contract] = await db.insert(contracts).values(data).returning();
  return contract;
}

export async function updateContract(id: string, data: Partial<{
  contractorUserId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  servicesIncluded: string[];
  pdfObjectKey: string | null;
  isActive: boolean;
}>): Promise<Contract | null> {
  const [contract] = await db.update(contracts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(contracts.id, id))
    .returning();
  return contract || null;
}

export async function deleteContract(id: string): Promise<void> {
  await db.delete(contracts).where(eq(contracts.id, id));
}

/* ─── Contacts ──────────────────────────────────────────────────────────── */
export async function getContacts(communityId?: string): Promise<(Contact & { communityName?: string })[]> {
  if (communityId) {
    return db.select().from(contacts).where(eq(contacts.communityId, communityId)).orderBy(contacts.name);
  }
  const rows = await db.select({
    id: contacts.id,
    communityId: contacts.communityId,
    name: contacts.name,
    title: contacts.title,
    company: contacts.company,
    phone: contacts.phone,
    email: contacts.email,
    contactType: contacts.contactType,
    notes: contacts.notes,
    createdAt: contacts.createdAt,
    communityName: communities.name,
  }).from(contacts)
    .leftJoin(communities, eq(contacts.communityId, communities.id))
    .orderBy(contacts.name);
  return rows.map(r => ({ ...r, communityName: r.communityName ?? undefined }));
}

export async function getContactsForCommunities(communityIds: string[]): Promise<(Contact & { communityName?: string })[]> {
  if (communityIds.length === 0) return [];
  const rows = await db.select({
    id: contacts.id,
    communityId: contacts.communityId,
    name: contacts.name,
    title: contacts.title,
    company: contacts.company,
    phone: contacts.phone,
    email: contacts.email,
    contactType: contacts.contactType,
    notes: contacts.notes,
    createdAt: contacts.createdAt,
    communityName: communities.name,
  }).from(contacts)
    .leftJoin(communities, eq(contacts.communityId, communities.id))
    .where(inArray(contacts.communityId, communityIds))
    .orderBy(contacts.name);
  return rows.map(r => ({ ...r, communityName: r.communityName ?? undefined }));
}

export async function getContactById(id: string): Promise<Contact | undefined> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
  return contact;
}

export async function createContact(data: InsertContact): Promise<Contact> {
  const [contact] = await db.insert(contacts).values(data).returning();
  return contact;
}

export async function updateContact(id: string, data: Partial<InsertContact>): Promise<Contact | null> {
  const [contact] = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
  return contact || null;
}

export async function deleteContact(id: string): Promise<void> {
  await db.delete(contacts).where(eq(contacts.id, id));
}

export async function insertPushTickets(entries: { ticketId: string; token: string }[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(pushTickets).values(entries);
}

export async function getPendingPushTicketsOlderThan(cutoff: Date): Promise<PushTicket[]> {
  return db.select().from(pushTickets).where(lt(pushTickets.createdAt, cutoff));
}

export async function deletePushTicketsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(pushTickets).where(inArray(pushTickets.id, ids));
}
