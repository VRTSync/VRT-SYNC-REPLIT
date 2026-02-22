import { eq, and, desc, asc, ne, inArray, gte, lte, lt, isNotNull } from "drizzle-orm";
import { db } from "./db";
import {
  users, communities, communityMembers, tasks, taskCompletions, attachments, pushTokens,
  assets, assetProperties, taskLinks, mapLayers, offlinePacks,
  type User, type InsertUser, type Community, type CommunityMember,
  type Task, type TaskCompletion, type Attachment, type PushToken,
  type Asset, type AssetProperty, type TaskLink, type MapLayer, type OfflinePack
} from "@shared/schema";

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
  priority?: "low" | "medium" | "high" | "urgent";
  latitude?: number;
  longitude?: number;
  address?: string;
  assignedTo?: string;
  createdBy: string;
  dueDate?: Date;
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
      .where(and(eq(tasks.assignedTo, userId), eq(tasks.communityId, communityId)))
      .orderBy(desc(tasks.createdAt));
  }
  return db.select().from(tasks)
    .where(eq(tasks.assignedTo, userId))
    .orderBy(desc(tasks.createdAt));
}

export async function updateTask(id: string, expectedVersion: number, data: Partial<{
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high" | "urgent";
  latitude: number;
  longitude: number;
  address: string;
  assignedTo: string;
  dueDate: Date;
}>): Promise<Task | null> {
  const [updated] = await db.update(tasks)
    .set({ ...data, version: expectedVersion + 1, updatedAt: new Date() })
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
  taskCompletionId: string;
  fileRef: string;
  url: string;
  uploadedBy: string;
  idempotencyKey: string;
}): Promise<Attachment> {
  const [attachment] = await db.insert(attachments).values(data).returning();
  return attachment;
}

export async function getAttachmentByIdempotencyKey(taskCompletionId: string, idempotencyKey: string): Promise<Attachment | null> {
  const [row] = await db.select().from(attachments).where(
    and(eq(attachments.taskCompletionId, taskCompletionId), eq(attachments.idempotencyKey, idempotencyKey))
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
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return { allowed: false, task: undefined };
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { allowed: false, task };
  if (user.role === 'admin') return { allowed: true, task };
  if (task.assignedTo !== userId) return { allowed: false, task };
  const isMember = await isUserMemberOfCommunity(userId, task.communityId);
  return { allowed: isMember, task };
}

export async function getAllUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(users.displayName);
}

export async function updateUserRole(userId: string, role: "contractor" | "admin"): Promise<User | null> {
  const [updated] = await db.update(users)
    .set({ role })
    .where(eq(users.id, userId))
    .returning();
  return updated || null;
}

export async function createAsset(data: {
  communityId: string;
  assetType: Asset["assetType"];
  label: string;
  featureRef?: string;
  geometryType?: Asset["geometryType"];
  latitude?: number;
  longitude?: number;
}): Promise<Asset> {
  const [asset] = await db.insert(assets).values(data).returning();
  return asset;
}

export async function getAssetById(id: string): Promise<Asset | undefined> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, id));
  return asset;
}

export async function getAssetsByCommunitySorted(communityId: string, assetType?: string): Promise<Asset[]> {
  if (assetType) {
    return db.select().from(assets)
      .where(and(eq(assets.communityId, communityId), eq(assets.assetType, assetType as Asset["assetType"])))
      .orderBy(assets.label);
  }
  return db.select().from(assets)
    .where(eq(assets.communityId, communityId))
    .orderBy(assets.label);
}

export async function updateAsset(id: string, expectedVersion: number, data: Partial<{
  label: string;
  featureRef: string | null;
  geometryType: Asset["geometryType"] | null;
  latitude: number | null;
  longitude: number | null;
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
  geojsonData?: string;
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
  geojsonData: string;
}>): Promise<MapLayer | null> {
  const [updated] = await db.update(mapLayers)
    .set({ ...data, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(mapLayers.id, id), eq(mapLayers.version, expectedVersion)))
    .returning();
  return updated || null;
}

export async function deleteMapLayer(id: string): Promise<boolean> {
  const [deleted] = await db.delete(mapLayers).where(eq(mapLayers.id, id)).returning();
  return !!deleted;
}

export async function getAssetByFeatureRef(communityId: string, featureRef: string): Promise<(Asset & { properties: AssetProperty[] }) | null> {
  const [asset] = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId), eq(assets.featureRef, featureRef)));
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
  checksum: string;
}>): Promise<OfflinePack | null> {
  const [updated] = await db.update(offlinePacks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(offlinePacks.id, id))
    .returning();
  return updated || null;
}

export async function generateAssetIndex(communityId: string) {
  const communityAssets = await db.select().from(assets)
    .where(eq(assets.communityId, communityId));
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

  return {
    dueTodayTasks,
    upcomingTasks,
    overdueTasks,
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
