/**
 * Frozen pre-P2 read algorithms, kept only for result-equivalence fixtures.
 * No Git history dependency: these comparisons must still work after merge.
 * Keep the per-item queries here; optimizing them would invalidate the baseline.
 */
import { and, eq, inArray, desc, count } from "drizzle-orm";
import { db } from "../db";
import { assets, assetProperties, communities, tasks, mapLayers, taskLinks, taskCompletions,
  users, attachments, type Asset } from "@workspace/db";
import { getAssetTypeCache, getAssetTypeTemplate } from "../assetTypeCache";
export { getAssetProperties, getAssetsByCommunitySorted } from "../storage";
import { getAssetProperties } from "../storage";

export async function getIncompleteAssets(communityId: string, assetType?: string, mapLayerId?: string, missingKey?: string) {
  const conditions = [eq(assets.communityId, communityId), eq(assets.isArchived, false)];
  if (assetType) conditions.push(eq(assets.assetType, assetType));
  if (mapLayerId) conditions.push(eq(assets.mapLayerId, mapLayerId));
  const allAssets = await db.select().from(assets).where(and(...conditions)).orderBy(assets.label);
  const results: (Asset & { missingRequiredKeys: string[] })[] = [];
  for (const asset of allAssets) {
    const props = await getAssetProperties(asset.id);
    const tpl = await getAssetTypeTemplate(asset.assetType);
    const present = new Set(props.map(p => p.key));
    const missing = tpl ? tpl.requiredKeys.filter(key => !present.has(key)) : [];
    if (!missing.length || (missingKey && !missing.includes(missingKey))) continue;
    results.push({ ...asset, missingRequiredKeys: missing });
  }
  return results;
}

export async function getMapLayerSummary(mapLayerId: string, communityId: string) {
  const all = await db.select().from(assets)
    .where(and(eq(assets.communityId, communityId), eq(assets.mapLayerId, mapLayerId)));
  const active = all.filter(a => !a.isArchived);
  let incompleteAssetCount = 0;
  for (const asset of active) {
    const tpl = await getAssetTypeTemplate(asset.assetType);
    if (tpl && tpl.requiredKeys.length) {
      const props = await db.select().from(assetProperties).where(eq(assetProperties.assetId, asset.id));
      const present = new Set(props.map(p => p.key));
      if (tpl.requiredKeys.some(key => !present.has(key))) incompleteAssetCount++;
    }
  }
  return { activeAssetCount: active.length, archivedAssetCount: all.length - active.length, incompleteAssetCount };
}

export async function getAdminSummary(communityId?: string) {
  const communityFilter = communityId ? eq(communities.id, communityId) : undefined;
  const assetFilter = communityId ? eq(assets.communityId, communityId) : undefined;
  const taskFilter = communityId ? eq(tasks.communityId, communityId) : undefined;
  const layerFilter = communityId ? eq(mapLayers.communityId, communityId) : undefined;
  const [comm] = await db.select({ count: count() }).from(communities).where(communityFilter);
  const [active] = await db.select({ count: count() }).from(assets).where(and(assetFilter, eq(assets.isArchived, false)));
  const [archived] = await db.select({ count: count() }).from(assets).where(and(assetFilter, eq(assets.isArchived, true)));
  const [task] = await db.select({ count: count() }).from(tasks).where(taskFilter);
  const [pending] = await db.select({ count: count() }).from(tasks).where(and(taskFilter, eq(tasks.status, "pending")));
  const [completed] = await db.select({ count: count() }).from(tasks).where(and(taskFilter, eq(tasks.status, "completed")));
  const [layer] = await db.select({ count: count() }).from(mapLayers).where(layerFilter);
  let incompleteAssetsCount = 0;
  const layerStats = [];
  if (communityId) {
    const activeAssets = await db.select().from(assets).where(and(eq(assets.communityId, communityId), eq(assets.isArchived, false)));
    const props = activeAssets.length ? await db.select().from(assetProperties)
      .where(inArray(assetProperties.assetId, activeAssets.map(a => a.id))) : [];
    const catalogue = await getAssetTypeCache();
    for (const asset of activeAssets) {
      const required = catalogue.find(t => t.key === asset.assetType)?.requiredKeys ?? [];
      const present = props.filter(p => p.assetId === asset.id).map(p => p.key);
      if (required.some(key => !present.includes(key))) incompleteAssetsCount++;
    }
    const layers = await db.select().from(mapLayers).where(eq(mapLayers.communityId, communityId));
    for (const item of layers) {
      const [a] = await db.select({ count: count() }).from(assets).where(and(eq(assets.mapLayerId, item.id), eq(assets.isArchived, false)));
      const [b] = await db.select({ count: count() }).from(assets).where(and(eq(assets.mapLayerId, item.id), eq(assets.isArchived, true)));
      layerStats.push({ layerId: item.id, activeAssets: a.count, archivedAssets: b.count });
    }
  }
  return { communitiesCount: comm.count, activeAssetsCount: active.count, archivedAssetsCount: archived.count,
    incompleteAssetsCount, tasksCount: task.count, pendingTasksCount: pending.count, completedTasksCount: completed.count,
    mapLayersCount: layer.count, layerStats };
}

export async function getAssetWorkHistory(assetId: string, managerId?: string) {
  const links = await db.select({ taskId: taskLinks.taskId }).from(taskLinks)
    .where(and(eq(taskLinks.assetId, assetId), eq(taskLinks.linkType, "asset")));
  if (!links.length) return [];
  const rows = await db.select({
    id: taskCompletions.id, taskId: taskCompletions.taskId, completedBy: taskCompletions.completedBy,
    notes: taskCompletions.notes, employeeSignOffName: taskCompletions.employeeSignOffName,
    timeSpentMinutes: taskCompletions.timeSpentMinutes, materialsUsed: taskCompletions.materialsUsed,
    followUpNeeded: taskCompletions.followUpNeeded, completedAt: taskCompletions.completedAt,
    taskTitle: tasks.title, userDisplayName: users.displayName,
  }).from(taskCompletions).innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
    .innerJoin(users, eq(taskCompletions.completedBy, users.id))
    .where(and(inArray(taskCompletions.taskId, links.map(t => t.taskId)),
      managerId ? managerScope(managerId) : undefined)).orderBy(desc(taskCompletions.completedAt));
  if (!rows.length) return [];
  const photos = await db.select({ id: attachments.id, url: attachments.url, taskCompletionId: attachments.taskCompletionId })
    .from(attachments).where(inArray(attachments.taskCompletionId, rows.map(row => row.id)));
  return rows.map(row => ({
    id: row.id, type: "task_completion" as const, completedAt: row.completedAt,
    completedBy: { id: row.completedBy, displayName: row.userDisplayName },
    employeeSignOffName: row.employeeSignOffName, notes: row.notes, timeSpentMinutes: row.timeSpentMinutes,
    materialsUsed: row.materialsUsed, followUpNeeded: row.followUpNeeded,
    task: { id: row.taskId, title: row.taskTitle },
    attachments: photos.filter(photo => photo.taskCompletionId === row.id).map(({ id, url }) => ({ id, url })),
  }));
}

import { sql } from "drizzle-orm";
function managerScope(userId: string) {
  return sql`EXISTS (SELECT 1 FROM users manager JOIN community_members m ON m.user_id = manager.id
    WHERE manager.id = ${userId} AND manager.role = 'contractor_manager'
    AND manager.company_id = ${tasks.contractorCompanyId} AND m.community_id = ${tasks.communityId})`;
}

export async function generateWorkHistorySnapshot(communityId: string, limit = 5, managerId?: string) {
  const communityAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.communityId, communityId));
  const snapshot: Record<string, Awaited<ReturnType<typeof getAssetWorkHistory>>> = {};
  for (const asset of communityAssets) {
    const history = await getAssetWorkHistory(asset.id, managerId);
    if (history.length) snapshot[asset.id] = history.slice(0, limit);
  }
  return snapshot;
}
