import type { Express, Request, Response } from "express";
import { requireClientOrAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { db, pool } from "../db";
import { tasks, taskComments } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ObjectStorageService, ObjectForbiddenError } from "../objectStorage";
import { buildCommunityAclPolicy } from "../objectAcl";
import { notifyPortfolioWorkOrderSubmitted } from "../pushNotifications";
import { isUniqueViolation } from "./errors";
import { route } from "./handler";

export function registerPortfolioWorkOrderRoutes(app: Express): void {
  // ── Portfolio Phase 3d: Work Orders endpoints ────────────────────────────
  //
  // origin values in use across the codebase (grep 2024-08):
  //   "HOA" — tasks created by HOA members via the HOA portal (requests.js)
  //   null  — tasks created by admin/contractor directly
  // No "client_portal" or "client" origin values exist today.
  // We use origin = 'client' as a role-generic value for any commercial
  // client portal submission (not tied to a specific org name like "PNC").

  app.get("/api/portfolio/work-orders", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;

      // Fetch org for display name (used in source label)
      const [org, workOrdersResult, groupMemberResult] = await Promise.all([
        storage.getOrganizationById(orgId),
        pool.query<{
          id: string;
          community_id: string;
          community_name: string;
          community_code: string | null;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          origin: string | null;
          category: string | null;
          layer_key: string | null;
          estimate_cents: number | null;
          approved_at: string | null;
          approved_by: string | null;
          cancelled_at: string | null;
          declined_at: string | null;
          created_at: string;
          updated_at: string;
          days_open: string;
          photo_count: string;
          // completed_at is only for closed tasks
          completed_at: string | null;
        }>(`
          WITH org_coms AS (
            SELECT id, name, code FROM communities WHERE organization_id = $1
          )
          SELECT
            t.id,
            t.community_id,
            c.name AS community_name,
            c.code AS community_code,
            t.title,
            t.description,
            t.status,
            t.priority,
            t.origin,
            t.category,
            -- layer_key: derived from the task's linked asset → map_layer (authoritative layer attribution).
            -- tasks.category is a manually-set field and may not reflect the mapped layer; the asset join is ground truth.
            ml.layer_key,
            t.estimate_cents,
            t.approved_at::text,
            t.approved_by,
            t.cancelled_at::text,
            t.declined_at::text,
            t.created_at::text,
            t.updated_at::text,
            -- daysOpen: calendar days since creation (rounded)
            EXTRACT(DAY FROM now() - t.created_at)::text AS days_open,
            -- photoCount: attachments directly on the task (pre-completion photos)
            COALESCE((
              SELECT COUNT(*) FROM attachments a
               WHERE a.task_id = t.id AND a.task_completion_id IS NULL
            ), 0)::text AS photo_count,
            -- completed_at: latest completion timestamp (for closed tasks)
            (SELECT tc.completed_at::text FROM task_completions tc
              WHERE tc.task_id = t.id
              ORDER BY tc.completed_at DESC LIMIT 1) AS completed_at
          FROM tasks t
          JOIN org_coms c ON c.id = t.community_id
          LEFT JOIN assets a ON a.id = t.asset_id
          LEFT JOIN map_layers ml ON ml.id = a.map_layer_id
          WHERE ${storage.importOriginExclude('t')}
          ORDER BY t.created_at DESC
        `, [orgId]),
        pool.query<{ community_id: string; group_id: string }>(`
          SELECT bgm.community_id, bgm.group_id
            FROM branch_group_members bgm
            JOIN branch_groups bg ON bg.id = bgm.group_id
           WHERE bg.organization_id = $1
        `, [orgId]),
      ]);

      const orgName = org?.name ?? null;
      const groupIdsByCommunity = new Map<string, string[]>();
      for (const membership of groupMemberResult.rows) {
        const ids = groupIdsByCommunity.get(membership.community_id) ?? [];
        ids.push(membership.group_id);
        groupIdsByCommunity.set(membership.community_id, ids);
      }
      const now30 = new Date();
      now30.setDate(now30.getDate() - 30);

      const open: any[] = [];
      const closed: any[] = [];
      const cancelled: any[] = [];

      for (const r of workOrdersResult.rows) {
        // ref: short form of the task id (first 8 chars, uppercased, prefixed WO-)
        // Using id short form since there's no dedicated work-order number sequence.
        const ref = 'WO-' + r.id.replace(/-/g, '').slice(0, 8).toUpperCase();

        // source: derive display from origin
        // origin = 'client' → "<orgName> request" (e.g. "Acme Corp request")
        // origin = 'HOA' / null / other → "Contractor report" (generic — not branded)
        let source: string;
        if (r.origin === 'client') {
          source = orgName ? orgName + ' request' : 'Client request';
        } else {
          source = 'Contractor report';
        }

        const row = {
          id: r.id,
          ref,
          communityId: r.community_id,
          groupIds: groupIdsByCommunity.get(r.community_id) ?? [],
          branchName: r.community_name,
          branchCode: r.community_code,
          title: r.title,
          description: r.description,
          status: r.status,
          priority: r.priority,
          source,
          origin: r.origin,
          category: r.category ?? null,
          // layerKey: asset-derived layer attribution (authoritative; category field may differ)
          layerKey: (r as any).layer_key ?? null,
          estimateCents: r.estimate_cents,
          approvedAt: r.approved_at,
          approvedBy: r.approved_by,
          cancelledAt: (r as any).cancelled_at ?? null,
          declinedAt: (r as any).declined_at ?? null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          daysOpen: Math.max(0, Number(r.days_open ?? 0)),
          photoCount: Number(r.photo_count ?? 0),
        };

        if ((r as any).cancelled_at || (r as any).declined_at) {
          // Cancelled and declined tasks shown separately; excluded from open counts
          cancelled.push(row);
        } else if (r.status === 'completed') {
          // Only include completed tasks from the last 30 days
          const completedAt = r.completed_at ? new Date(r.completed_at) : null;
          if (completedAt && completedAt >= now30) {
            closed.push({ ...row, completedAt: r.completed_at });
          }
        } else {
          open.push(row);
        }
      }

      // Pipeline counts — excludes cancelled/declined items (they are not in `open`)
      const pipeline = {
        flaggedByHp: open.filter(t => t.origin !== 'client').length,
        awaitingApproval: open.filter(t => t.estimateCents != null && !t.approvedAt && !t.declinedAt).length,
        scheduled: open.filter(t => t.status === 'pending' || t.status === 'in_progress').length,
        completed30d: closed.length,
      };

      console.log(`[GET /api/portfolio/work-orders] org=${orgId} open=${open.length} closed=${closed.length} cancelled=${cancelled.length} (${Date.now() - t0}ms)`);
      return void res.json({ pipeline, open, closed, cancelled });
    } catch (error) {
      console.error("Portfolio work-orders GET error:", error);
      return void res.status(500).json({ error: "Failed to fetch work orders" });
    }
  }));

  app.post("/api/portfolio/work-orders", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;

      const { communityId, title, description, latitude, longitude, objectKeys } = req.body;
      if (!communityId || typeof communityId !== "string") {
        return void res.status(400).json({ error: "communityId is required" });
      }
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return void res.status(400).json({ error: "title is required" });
      }

      // Verify the communityId belongs to this org (403 if not — cross-org isolation)
      const community = await storage.getCommunityById(communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Branch not found or does not belong to this organization" });
      }

      const org = await storage.getOrganizationById(orgId);
      const orgName = org?.name ?? null;

      const task = await storage.createTask({
        communityId,
        title: title.trim(),
        description: description?.trim() || undefined,
        createdBy: req.session.userId!,
        latitude: typeof latitude === 'number' ? latitude : undefined,
        longitude: typeof longitude === 'number' ? longitude : undefined,
        // origin = 'client': role-generic value for any commercial portal submission
        origin: 'client',
        status: 'pending',
      });

      // Attach any already-uploaded object keys (existing upload/confirm flow)
      if (Array.isArray(objectKeys) && objectKeys.length > 0) {
        const objectStorageService = new ObjectStorageService();
        for (const key of objectKeys) {
          if (typeof key !== "string") continue;
          try {
            await storage.createAttachment({
              taskId: task.id,
              fileRef: key,
              url: key,
              uploadedBy: req.session.userId!,
              idempotencyKey: key,
            });
          } catch (_) { /* skip duplicate keys */ }
        }
      }

      // Notification delivery is intentionally fire-and-forget. The task and
      // its attachments are already persisted, so delivery failures must not
      // alter the successful work-order response.
      notifyPortfolioWorkOrderSubmitted(task, orgId).catch(err =>
        console.error("notifyPortfolioWorkOrderSubmitted error:", err)
      );

      // Return the created task as an open work-order row
      const ref = 'WO-' + task.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      const source = orgName ? orgName + ' request' : 'Client request';

      console.log(`[POST /api/portfolio/work-orders] org=${orgId} task=${task.id} (${Date.now() - t0}ms)`);
      return void res.status(201).json({
        id: task.id,
        ref,
        communityId: task.communityId,
        branchName: community.name,
        branchCode: community.code ?? null,
        title: task.title,
        description: task.description ?? null,
        status: task.status,
        priority: task.priority,
        source,
        origin: task.origin,
        estimateCents: task.estimateCents ?? null,
        approvedAt: task.approvedAt ?? null,
        approvedBy: task.approvedBy ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        daysOpen: 0,
        photoCount: Array.isArray(objectKeys) ? objectKeys.length : 0,
      });
    } catch (error) {
      console.error("Portfolio work-orders POST error:", error);
      return void res.status(500).json({ error: "Failed to create work order" });
    }
  }));

  app.post("/api/portfolio/work-orders/:taskId/approve", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      // Fetch task and verify it belongs to this org
      const task = await storage.getTaskById(taskId);
      if (!task) {
        return void res.status(404).json({ error: "Work order not found" });
      }

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      // 409 if already declined — Approve and Decline are mutually exclusive
      if ((task as any).declinedAt) {
        return void res.status(409).json({ error: "This estimate has already been declined. Approve and Decline are mutually exclusive." });
      }
      // 409 if cancelled — cancellation is a terminal state
      if ((task as any).cancelledAt) {
        return void res.status(409).json({ error: "This work order has been cancelled and can no longer be approved." });
      }

      // Idempotent: if already approved, return current state with 200
      if (task.approvedAt) {
        const org = await storage.getOrganizationById(orgId);
        const ref = 'WO-' + task.id.replace(/-/g, '').slice(0, 8).toUpperCase();
        const source = task.origin === 'client'
          ? (org?.name ? org.name + ' request' : 'Client request')
          : 'HP';
        return void res.json({
          id: task.id,
          ref,
          communityId: task.communityId,
          branchName: community.name,
          branchCode: community.code ?? null,
          title: task.title,
          status: task.status,
          estimateCents: task.estimateCents ?? null,
          approvedAt: task.approvedAt.toISOString(),
          approvedBy: task.approvedBy ?? null,
          source,
          origin: task.origin ?? null,
        });
      }

      // Set approvedAt + approvedBy conditionally: only when approvedAt, declinedAt, and
      // cancelledAt are still NULL at the DB level (cancelled is terminal; preserves
      // mutual-exclusion under concurrent approve/decline requests).
      const [updated] = await db.update(tasks)
        .set({ approvedAt: new Date(), approvedBy: req.session.userId! })
        .where(and(
          eq(tasks.id, taskId),
          isNull(tasks.approvedAt),
          isNull((tasks as any).declinedAt),
          isNull((tasks as any).cancelledAt),
        ))
        .returning();

      if (!updated) {
        // Conditional update matched no rows — re-read to differentiate concurrent decline / cancel / 404
        const current = await storage.getTaskById(taskId);
        if (!current) return void res.status(404).json({ error: "Work order not found" });
        if ((current as any).declinedAt) {
          return void res.status(409).json({ error: "This estimate has already been declined. Approve and Decline are mutually exclusive." });
        }
        if ((current as any).cancelledAt) {
          return void res.status(409).json({ error: "This work order has been cancelled and can no longer be approved." });
        }
        return void res.status(409).json({ error: "Work order state changed concurrently; please refresh and try again." });
      }

      const org = await storage.getOrganizationById(orgId);
      const ref = 'WO-' + updated.id.replace(/-/g, '').slice(0, 8).toUpperCase();
      const source = updated.origin === 'client'
        ? (org?.name ? org.name + ' request' : 'Client request')
        : 'HP';

      console.log(`[POST /api/portfolio/work-orders/:taskId/approve] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.json({
        id: updated.id,
        ref,
        communityId: updated.communityId,
        branchName: community.name,
        branchCode: community.code ?? null,
        title: updated.title,
        status: updated.status,
        estimateCents: updated.estimateCents ?? null,
        approvedAt: updated.approvedAt!.toISOString(),
        approvedBy: updated.approvedBy ?? null,
        source,
        origin: updated.origin ?? null,
      });
    } catch (error) {
      console.error("Portfolio work-orders approve error:", error);
      return void res.status(500).json({ error: "Failed to approve work order" });
    }
  }));

  // ── Portfolio: Work Order detail + client action routes ──────────────────
  //
  // All routes below share the same org-isolation guard: task.communityId must
  // belong to the caller's org (resolvePortfolioOrg).  Cross-org → 403.
  //
  // Helper: build the full work-order detail response object (reused by GET,
  // PATCH, cancel, decline so the returned shape is always consistent).
  async function buildWODetail(task: any, community: any, org: any) {
    const ref = 'WO-' + task.id.replace(/-/g, '').slice(0, 8).toUpperCase();
    const source = task.origin === 'client'
      ? (org?.name ? org.name + ' request' : 'Client request')
      : 'HP';

    const [attRows, cmtRows, completionRows] = await Promise.all([
      pool.query<{ id: string; file_ref: string; url: string; created_at: string }>(
        `SELECT id, file_ref, url, created_at FROM attachments
          WHERE task_id = $1 AND task_completion_id IS NULL
          ORDER BY created_at ASC`,
        [task.id]
      ),
      pool.query<{ id: string; body: string; author_name: string; created_at: string }>(
        `SELECT tc.id, tc.body, tc.created_at, u.display_name AS author_name
           FROM task_comments tc
           JOIN users u ON u.id = tc.author_user_id
          WHERE tc.task_id = $1
          ORDER BY tc.created_at ASC`,
        [task.id]
      ),
      pool.query<{ completed_at: string; actor_name: string | null }>(
        `SELECT tcomp.completed_at::text, u.display_name AS actor_name
           FROM task_completions tcomp
           LEFT JOIN users u ON u.id = tcomp.completed_by
          WHERE tcomp.task_id = $1
          ORDER BY tcomp.completed_at DESC LIMIT 1`,
        [task.id]
      ),
    ]);

    // Fetch actor names for attributed events (acknowledged_by, approved_by, cancelled_by, declined_by)
    const actorIds = new Set<string>();
    if (task.approvedBy)  actorIds.add(task.approvedBy);
    if ((task as any).cancelledBy) actorIds.add((task as any).cancelledBy);
    if ((task as any).declinedBy)  actorIds.add((task as any).declinedBy);
    const actorNames: Record<string, string> = {};
    if (actorIds.size > 0) {
      const idList = Array.from(actorIds);
      const actorRows = await pool.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM users WHERE id = ANY($1)`,
        [idList]
      );
      for (const row of actorRows.rows) actorNames[row.id] = row.display_name;
    }

    // Build chronological timeline from known timestamps with actor attribution
    const timelineRaw: { event: string; timestamp: Date; actor?: string }[] = [];
    if (task.createdAt)      timelineRaw.push({ event: 'submitted',    timestamp: task.createdAt });
    if (task.acknowledgedAt) timelineRaw.push({ event: 'acknowledged', timestamp: task.acknowledgedAt });
    if (task.startDate)      timelineRaw.push({ event: 'scheduled',    timestamp: task.startDate });
    if (task.approvedAt)     timelineRaw.push({ event: 'approved',     timestamp: task.approvedAt,
                                                actor: task.approvedBy ? (actorNames[task.approvedBy] ?? undefined) : undefined });
    if ((task as any).declinedAt)  timelineRaw.push({ event: 'declined',   timestamp: (task as any).declinedAt,
                                                actor: (task as any).declinedBy ? (actorNames[(task as any).declinedBy] ?? undefined) : undefined });
    if ((task as any).cancelledAt) timelineRaw.push({ event: 'cancelled',  timestamp: (task as any).cancelledAt,
                                                actor: (task as any).cancelledBy ? (actorNames[(task as any).cancelledBy] ?? undefined) : undefined });
    if (completionRows.rows.length > 0 && completionRows.rows[0].completed_at) {
      timelineRaw.push({
        event: 'completed',
        timestamp: new Date(completionRows.rows[0].completed_at),
        actor: completionRows.rows[0].actor_name ?? undefined,
      });
    }
    timelineRaw.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      id: task.id, ref,
      communityId: task.communityId,
      branchName: community.name,
      branchCode: community.code ?? null,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      source, origin: task.origin ?? null,
      latitude: task.latitude ?? null,
      longitude: task.longitude ?? null,
      estimateCents: task.estimateCents ?? null,
      acknowledgedAt: task.acknowledgedAt?.toISOString() ?? null,
      approvedAt: task.approvedAt?.toISOString() ?? null,
      approvedBy: task.approvedBy ?? null,
      cancelledAt: task.cancelledAt?.toISOString() ?? null,
      cancelReason: task.cancelReason ?? null,
      declinedAt: task.declinedAt?.toISOString() ?? null,
      declineReason: task.declineReason ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      attachments: attRows.rows.map(a => ({ id: a.id, fileRef: a.file_ref, url: a.url })),
      timeline: timelineRaw.map(e => ({ event: e.event, timestamp: e.timestamp.toISOString(), actor: e.actor ?? null })),
      comments: cmtRows.rows.map(c => ({ id: c.id, body: c.body, authorName: c.author_name, createdAt: c.created_at })),
    };
  }

  app.get("/api/portfolio/work-orders/:taskId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      const org = await storage.getOrganizationById(orgId);
      const detail = await buildWODetail(task, community, org);
      console.log(`[GET /api/portfolio/work-orders/:taskId] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.json(detail);
    } catch (error) {
      console.error("Portfolio WO detail GET error:", error);
      return void res.status(500).json({ error: "Failed to fetch work order detail" });
    }
  }));

  app.patch("/api/portfolio/work-orders/:taskId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      // Guard: only editable when origin='client' AND not yet acknowledged
      if (task.origin !== 'client') {
        return void res.status(403).json({ error: "Only client-submitted work orders can be edited via this endpoint" });
      }
      if (task.acknowledgedAt) {
        return void res.status(403).json({ error: "This work order has already been acknowledged by the contractor and can no longer be edited" });
      }

      const { title, description } = req.body;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0) {
          return void res.status(400).json({ error: "title must be a non-empty string" });
        }
        updates.title = title.trim();
      }
      if (description !== undefined) {
        updates.description = typeof description === 'string' ? description.trim() || null : null;
      }

      // Conditional WHERE enforces guard at DB level: only applies when still
      // origin='client', unacknowledged, and not cancelled/declined (terminal states).
      const [updated] = await db.update(tasks)
        .set(updates)
        .where(and(
          eq(tasks.id, taskId),
          isNull(tasks.acknowledgedAt),
          isNull((tasks as any).cancelledAt),
          isNull((tasks as any).declinedAt),
        ))
        .returning();
      if (!updated) {
        const current = await storage.getTaskById(taskId);
        if (!current) return void res.status(404).json({ error: "Work order not found" });
        if (current.acknowledgedAt) return void res.status(403).json({ error: "This work order has already been acknowledged by the contractor and can no longer be edited" });
        if ((current as any).cancelledAt) return void res.status(409).json({ error: "This work order has been cancelled and can no longer be edited" });
        if ((current as any).declinedAt)  return void res.status(409).json({ error: "The estimate on this work order has been declined; it can no longer be edited" });
        return void res.status(409).json({ error: "Work order state changed concurrently; please refresh and try again." });
      }

      const org = await storage.getOrganizationById(orgId);
      const detail = await buildWODetail(updated, community, org);
      console.log(`[PATCH /api/portfolio/work-orders/:taskId] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.json(detail);
    } catch (error) {
      console.error("Portfolio WO PATCH error:", error);
      return void res.status(500).json({ error: "Failed to update work order" });
    }
  }));

  app.post("/api/portfolio/work-orders/:taskId/cancel", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const { reason } = req.body;
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return void res.status(400).json({ error: "reason is required to cancel a work order" });
      }

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      // Guard: only cancellable when origin='client' AND not yet acknowledged
      if (task.origin !== 'client') {
        return void res.status(403).json({ error: "Only client-submitted work orders can be cancelled via this endpoint" });
      }
      if (task.acknowledgedAt) {
        return void res.status(403).json({ error: "This work order has already been acknowledged by the contractor and can no longer be cancelled" });
      }

      // Idempotent: already cancelled → return current state
      if ((task as any).cancelledAt) {
        const org = await storage.getOrganizationById(orgId);
        const detail = await buildWODetail(task, community, org);
        return void res.json(detail);
      }

      // Conditional WHERE enforces guard at DB level: only applies when still
      // unacknowledged and not already in a terminal state (cancelled, declined).
      const [updated] = await db.update(tasks)
        .set({ cancelledAt: new Date(), cancelledBy: req.session.userId!, cancelReason: reason.trim() } as any)
        .where(and(
          eq(tasks.id, taskId),
          isNull(tasks.acknowledgedAt),
          isNull((tasks as any).cancelledAt),
          isNull((tasks as any).declinedAt),
        ))
        .returning();
      if (!updated) {
        const current = await storage.getTaskById(taskId);
        if (!current) return void res.status(404).json({ error: "Work order not found" });
        if (current.acknowledgedAt) return void res.status(403).json({ error: "This work order has already been acknowledged by the contractor and can no longer be cancelled" });
        if ((current as any).cancelledAt) {
          // Already cancelled — idempotent
          const org2 = await storage.getOrganizationById(orgId);
          const detail2 = await buildWODetail(current, community, org2);
          return void res.json(detail2);
        }
        if ((current as any).declinedAt) return void res.status(409).json({ error: "The estimate has been declined; this work order is in a terminal state" });
        return void res.status(409).json({ error: "Work order state changed concurrently; please refresh and try again." });
      }

      const org = await storage.getOrganizationById(orgId);
      const detail = await buildWODetail(updated, community, org);
      console.log(`[POST /api/portfolio/work-orders/:taskId/cancel] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.json(detail);
    } catch (error) {
      console.error("Portfolio WO cancel error:", error);
      return void res.status(500).json({ error: "Failed to cancel work order" });
    }
  }));

  app.post("/api/portfolio/work-orders/:taskId/decline", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const { reason } = req.body;
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return void res.status(400).json({ error: "reason is required to decline an estimate" });
      }

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      // Guard: must have an estimate to decline
      if (task.estimateCents == null) {
        return void res.status(400).json({ error: "This work order does not have an estimate to decline" });
      }
      // Guard: cannot decline if already approved
      if (task.approvedAt) {
        return void res.status(409).json({ error: "This estimate has already been approved. Approve and Decline are mutually exclusive." });
      }
      // Guard: cancelled is a terminal state — cannot decline a cancelled work order
      if ((task as any).cancelledAt) {
        return void res.status(409).json({ error: "This work order has been cancelled and can no longer be declined." });
      }

      // Idempotent: already declined → return current state
      if ((task as any).declinedAt) {
        const org = await storage.getOrganizationById(orgId);
        const detail = await buildWODetail(task, community, org);
        return void res.json(detail);
      }

      // Set declinedAt conditionally: only when approvedAt, declinedAt, and cancelledAt are
      // still NULL at the DB level (cancelled is terminal; preserves mutual-exclusion).
      const [updated] = await db.update(tasks)
        .set({ declinedAt: new Date(), declinedBy: req.session.userId!, declineReason: reason.trim() } as any)
        .where(and(
          eq(tasks.id, taskId),
          isNull(tasks.approvedAt),
          isNull((tasks as any).declinedAt),
          isNull((tasks as any).cancelledAt),
        ))
        .returning();
      if (!updated) {
        // Could not update: re-read to determine whether it was a concurrent approve or 404
        const current = await storage.getTaskById(taskId);
        if (!current) return void res.status(404).json({ error: "Work order not found" });
        if (current.approvedAt) return void res.status(409).json({ error: "This estimate has already been approved. Approve and Decline are mutually exclusive." });
        if ((current as any).declinedAt) {
          const org2 = await storage.getOrganizationById(orgId);
          const detail2 = await buildWODetail(current, community, org2);
          return void res.json(detail2);
        }
        return void res.status(409).json({ error: "Work order state changed concurrently; please refresh and try again." });
      }

      const org = await storage.getOrganizationById(orgId);
      const detail = await buildWODetail(updated, community, org);
      console.log(`[POST /api/portfolio/work-orders/:taskId/decline] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.json(detail);
    } catch (error) {
      console.error("Portfolio WO decline error:", error);
      return void res.status(500).json({ error: "Failed to decline estimate" });
    }
  }));

  app.post("/api/portfolio/work-orders/:taskId/comments", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const { body } = req.body;
      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return void res.status(400).json({ error: "body is required" });
      }

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      const [comment] = await db.insert(taskComments).values({
        taskId,
        authorUserId: req.session.userId!,
        body: body.trim(),
      }).returning();

      // Fetch author name for the response
      const author = await storage.getUserById(req.session.userId!);
      console.log(`[POST /api/portfolio/work-orders/:taskId/comments] org=${orgId} task=${taskId} (${Date.now() - t0}ms)`);
      return void res.status(201).json({
        id: comment.id,
        body: comment.body,
        authorName: author?.displayName ?? 'Unknown',
        createdAt: comment.createdAt.toISOString(),
      });
    } catch (error) {
      console.error("Portfolio WO comment error:", error);
      return void res.status(500).json({ error: "Failed to post comment" });
    }
  }));

  app.post("/api/portfolio/work-orders/:taskId/photos", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = policy.resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const taskId = req.params.taskId as string;

      const { objectKeys } = req.body;
      if (!Array.isArray(objectKeys) || objectKeys.length === 0) {
        return void res.status(400).json({ error: "objectKeys[] is required" });
      }

      const task = await storage.getTaskById(taskId);
      if (!task) return void res.status(404).json({ error: "Work order not found" });

      const community = await storage.getCommunityById(task.communityId);
      if (!policy.orgOwnsCommunity(orgId, community)) {
        return void res.status(403).json({ error: "Work order not found or does not belong to this organization" });
      }

      // Guard: only attachable when origin='client' AND not yet acknowledged
      if (task.origin !== 'client') {
        return void res.status(403).json({ error: "Only client-submitted work orders accept photos via this endpoint" });
      }
      if (task.acknowledgedAt) {
        return void res.status(403).json({ error: "This work order has already been acknowledged and can no longer receive photos" });
      }

      const objectStorageService = new ObjectStorageService();
      const attached: string[] = [];
      const rejected: string[] = [];

      for (const key of objectKeys) {
        if (typeof key !== 'string' || !key.startsWith('/objects/')) {
          rejected.push(key);
          continue;
        }
        try {
          // Idempotency check: if this (taskId, key) pair was already attached,
          // return success without re-transferring ownership or inserting again.
          const existing = await storage.getAttachmentByTaskIdAndIdempotencyKey(taskId, key);
          if (existing) {
            attached.push(key);
            continue;
          }

          // Claim a fresh object or re-stamp one already owned by this caller.
          await objectStorageService.claimObjectForCaller(
            key,
            req.session.userId!,
            buildCommunityAclPolicy(req.session.userId!, task.communityId),
          );
          await storage.createAttachment({
            taskId,
            fileRef: key,
            url: key,
            uploadedBy: req.session.userId!,
            idempotencyKey: key,
          });
          attached.push(key);
        } catch (e: any) {
          if (e?.name === 'ObjectNotFoundError') {
            rejected.push(key);
          } else if (isUniqueViolation(e)) {
            // Race-condition duplicate: a concurrent request beat us to the
            // insert.  Re-read the now-existing attachment and treat as success.
            const concurrent = await storage.getAttachmentByTaskIdAndIdempotencyKey(taskId, key);
            if (concurrent) {
              attached.push(key);
            } else {
              throw e; // unexpected — surface the original error
            }
          } else {
            // Re-throw all other errors; only ObjectNotFoundError and unique
            // violations are benign per-key failures.
            throw e;
          }
        }
      }

      if (rejected.length > 0 && attached.length === 0) {
        return void res.status(403).json({
          error: "None of the provided object keys are owned by the current user or valid",
          rejected,
        });
      }

      const attachments = await storage.getAttachmentsByTaskId(taskId);
      console.log(`[POST /api/portfolio/work-orders/:taskId/photos] org=${orgId} task=${taskId} attached=${attached.length} rejected=${rejected.length} (${Date.now() - t0}ms)`);
      return void res.json({ attachments: attachments.map(a => ({ id: a.id, fileRef: a.fileRef, url: a.url })), rejected });
    } catch (error) {
      if (error instanceof ObjectForbiddenError) {
        return void res.status(403).json({ error: "You do not own this file" });
      }
      console.error("Portfolio WO photos error:", error);
      return void res.status(500).json({ error: "Failed to attach photos" });
    }
  }));
}
