/**
 * Backfill ACL script — re-stamps attachments created in the last 90 days
 * with a community-member ACL so that only the owner and community members
 * can read them (instead of the previous public-visibility default).
 *
 * Idempotent: skips attachments that already have a community aclRule.
 *
 * Run: ts-node -e "require('./backfill-acl')" or compiled equivalent.
 */

import { db } from "../db";
import { attachments, tasks, taskCompletions } from "@workspace/db";
import { and, gte, isNotNull, or, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../objectStorage";
import { buildCommunityAclPolicy, getObjectAclPolicy, ObjectAccessGroupType } from "../objectAcl";

const LOOKBACK_DAYS = 90;

async function main() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  console.log(`[backfill-acl] Querying attachments created since ${cutoff.toISOString()}`);

  const rows = await db
    .select({
      id: attachments.id,
      fileRef: attachments.fileRef,
      taskId: attachments.taskId,
      taskCompletionId: attachments.taskCompletionId,
      uploadedBy: attachments.uploadedBy,
    })
    .from(attachments)
    .where(
      and(
        gte(attachments.createdAt, cutoff),
        or(isNotNull(attachments.taskId), isNotNull(attachments.taskCompletionId)),
      ),
    );

  console.log(`[backfill-acl] Found ${rows.length} attachment(s) to inspect`);

  const completionIds = rows
    .filter((r) => r.taskCompletionId)
    .map((r) => r.taskCompletionId!);

  const completionToTaskId = new Map<string, string>();
  if (completionIds.length > 0) {
    const completions = await db
      .select({ id: taskCompletions.id, taskId: taskCompletions.taskId })
      .from(taskCompletions)
      .where(inArray(taskCompletions.id, completionIds));
    for (const c of completions) {
      completionToTaskId.set(c.id, c.taskId);
    }
  }

  const allTaskIds = new Set<string>();
  for (const row of rows) {
    const taskId = row.taskId ?? completionToTaskId.get(row.taskCompletionId ?? "");
    if (taskId) allTaskIds.add(taskId);
  }

  const taskMap = new Map<string, string>();
  if (allTaskIds.size > 0) {
    const taskRows = await db
      .select({ id: tasks.id, communityId: tasks.communityId })
      .from(tasks)
      .where(inArray(tasks.id, [...allTaskIds]));
    for (const t of taskRows) {
      taskMap.set(t.id, t.communityId);
    }
  }

  const objectStorageService = new ObjectStorageService();

  let skipped = 0;
  let updated = 0;
  let errored = 0;

  for (const row of rows) {
    if (!row.fileRef || !row.fileRef.startsWith("/objects/")) {
      skipped++;
      continue;
    }

    const taskId = row.taskId ?? completionToTaskId.get(row.taskCompletionId ?? "");
    const communityId = taskId ? taskMap.get(taskId) : undefined;
    if (!communityId) {
      skipped++;
      continue;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(row.fileRef);
      const existing = await getObjectAclPolicy(objectFile);

      const alreadyHasCommunityRule = existing?.aclRules?.some(
        (r) => r.group.type === ObjectAccessGroupType.COMMUNITY_MEMBER && r.group.id === communityId,
      );
      if (alreadyHasCommunityRule) {
        skipped++;
        continue;
      }

      const policy = buildCommunityAclPolicy(row.uploadedBy, communityId);
      await objectStorageService.trySetObjectEntityAclPolicy(row.fileRef, policy);
      updated++;
      console.log(`[backfill-acl] Updated ${row.fileRef} → community=${communityId}`);
    } catch (err) {
      errored++;
      console.error(`[backfill-acl] Error processing ${row.fileRef}:`, err);
    }
  }

  console.log(
    `[backfill-acl] Done. updated=${updated} skipped=${skipped} errored=${errored}`,
  );
}

main().catch((err) => {
  console.error("[backfill-acl] Fatal error:", err);
  process.exit(1);
});
