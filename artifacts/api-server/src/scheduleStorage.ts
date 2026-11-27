import { and, asc, eq, inArray, isNull, lte, gte, sql } from "drizzle-orm";
import {
  contracts, companies, users, communityMembers, contractServices as services,
  contractServiceWindows as windows, contractServiceCompletions as completions,
  contractCompletionPhotos as photos, contractRates as rates,
  replaceContractScheduleSchema, completeContractServiceSchema, contractCompletionPhotoSchema,
  type Contract, type ReplaceContractSchedule, type ContractServiceCompletion,
} from "@workspace/db";
import { db } from "./db";
import * as policy from "./policy";
import { todayInDenver, validateScheduleWindows, windowState, scheduleSummary } from "./scheduleDates";
import { ObjectStorageService, parseUploadURL } from "./objectStorage";
import { buildCommunityAclPolicy } from "./objectAcl";

export class ScheduleError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}
const missing = (name: string): never => { throw new ScheduleError(404, `${name} not found`); };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = policy.Actor;

/** Exactly three schedule-data statements, including the empty result case.
 * Authentication/community membership lookups are policy overhead, not data
 * loading. Authors and photo counts are joined here, never queried per item.
 */
async function loadSchedule(
  scope: { communityId: string; on: string } | { contractId: string },
  actor: Actor,
) {
  if ("communityId" in scope) {
    policy.assertCan(await policy.canReadCommunitySchedule(actor, scope.communityId), "Access denied");
  }
  const company = policy.visibleContractFilter(actor);
  const selected = await db.select({ contract: contracts, company: { id: companies.id, name: companies.name } })
    .from(contracts).leftJoin(companies, eq(contracts.contractorCompanyId, companies.id))
    .where(and(
      "communityId" in scope ? and(eq(contracts.communityId, scope.communityId), eq(contracts.isActive, true),
        lte(contracts.startDate, scope.on), gte(contracts.endDate, scope.on)) : eq(contracts.id, scope.contractId),
      company === undefined ? undefined : company ? eq(contracts.contractorCompanyId, company) : sql`false`,
    )).orderBy(asc(contracts.startDate), asc(contracts.id));
  if ("contractId" in scope) {
    if (!selected.length) missing("Contract");
    policy.assertCan(await policy.canReadCommunitySchedule(actor, selected[0].contract.communityId), "Access denied");
  }
  const ids = selected.map(r => r.contract.id);
  const photoCounts = db.select({
    completionId: photos.completionId,
    count: sql<number>`count(*)::int`.as("photo_count"),
  }).from(photos).groupBy(photos.completionId).as("schedule_photo_counts");
  const items = await db.select({
    service: services, window: windows, completion: completions,
    author: { id: users.id, name: users.displayName },
    photoCount: sql<number>`coalesce(${photoCounts.count}, 0)::int`,
  }).from(services)
    .leftJoin(windows, and(eq(windows.serviceId, services.id), isNull(windows.archivedAt)))
    .leftJoin(completions, and(eq(completions.windowId, windows.id), isNull(completions.undoneAt)))
    .leftJoin(users, eq(completions.completedBy, users.id))
    .leftJoin(photoCounts, eq(photoCounts.completionId, completions.id))
    .where(and(ids.length ? inArray(services.contractId, ids) : sql`false`, isNull(services.archivedAt)))
    .orderBy(asc(services.sortOrder), asc(services.name), asc(services.id), asc(windows.seq));
  const allRates = await db.select().from(rates)
    .where(ids.length ? inArray(rates.contractId, ids) : sql`false`)
    .orderBy(asc(rates.sortOrder), asc(rates.label), asc(rates.id));
  const today = todayInDenver();
  const displayDate = "on" in scope ? scope.on : today;
  const result = [];
  for (const { contract, company: holder } of selected) {
    const canComplete = await policy.canCompleteContractService(actor, contract);
    const serviceMap = new Map<string, {
      id: string; name: string; description: string | null; category: string; kind: string;
      includedText: string | null; cadenceText: string | null;
      windows: { id: string; seq: number; startDate: string; endDate: string; state: ReturnType<typeof windowState>;
        completion: null | { id: string; completedOn: string; completedBy: { id: string; name: string };
          note: string | null; photoCount: number; canUndo: boolean } }[];
    }>();
    for (const row of items.filter(r => r.service.contractId === contract.id)) {
      const s = row.service;
      if (!serviceMap.has(s.id)) serviceMap.set(s.id, {
        id: s.id, name: s.name, description: s.description, category: s.category, kind: s.kind,
        includedText: s.includedText, cadenceText: s.cadenceText, windows: [],
      });
      if (row.window) {
        const c = row.completion;
        serviceMap.get(s.id)!.windows.push({
          id: row.window.id, seq: row.window.seq, startDate: row.window.startDate, endDate: row.window.endDate,
          state: windowState({ ...row.window, kind: s.kind }, c, displayDate),
          completion: c ? {
            id: c.id, completedOn: c.completedOn, completedBy: { id: c.completedBy, name: row.author!.name! },
            note: c.note, photoCount: row.photoCount,
            canUndo: await policy.canUndoCompletion(actor, contract, c, today),
          } : null,
        });
      }
    }
    const contractServices = [...serviceMap.values()];
    result.push({
      id: contract.id, title: contract.contractType, startDate: contract.startDate, endDate: contract.endDate,
      company: holder, hasPdf: !!contract.pdfObjectKey, summary: scheduleSummary(contractServices),
      services: contractServices,
      ...(policy.seesContractPrices(actor) ? {
        rates: allRates.filter(r => r.contractId === contract.id).map(r => ({
          label: r.label, amountCents: r.amountCents, unit: r.unit, note: r.note,
        })),
      } : {}),
      canComplete, canEdit: policy.canEditContractSchedule(actor),
    });
  }
  return { today, contracts: result };
}

export function getCommunitySchedule(communityId: string, on: string, actor: Actor) {
  return loadSchedule({ communityId, on }, actor);
}
export function getContractSchedule(contractId: string, actor: Actor) {
  return loadSchedule({ contractId }, actor);
}

/** All mutations acquire this same contract lock first. This serializes
 * replace/complete/undo/photos, including omissions of entire parent services.
 * Re-read the user and lock membership so stale request actors cannot grant writes.
 */
async function lockedContext(tx: Tx, contractId: string, caller: Actor) {
  const [contract] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for("update");
  if (!contract) missing("Contract");
  const [user] = await tx.select().from(users).where(eq(users.id, caller.id)).for("share");
  policy.assertCan(!!user?.isActive, "Access denied");
  const actor = policy.actorFromUser(user);
  const [membership] = await tx.select().from(communityMembers).where(and(
    eq(communityMembers.userId, actor.id), eq(communityMembers.communityId, contract.communityId),
  )).for("share");
  return { contract, actor, member: !!membership };
}

export async function replaceContractSchedule(contractId: string, input: ReplaceContractSchedule, caller: Actor) {
  const body = replaceContractScheduleSchema.parse(input);
  await db.transaction(async tx => {
    const { contract, actor } = await lockedContext(tx, contractId, caller);
    policy.assertCan(policy.canEditContractSchedule(actor), "Access denied");
    const oldServices = await tx.select().from(services).where(and(eq(services.contractId, contractId), isNull(services.archivedAt)));
    const serviceIds = oldServices.map(s => s.id);
    const oldWindows = serviceIds.length ? await tx.select().from(windows)
      .where(and(inArray(windows.serviceId, serviceIds), isNull(windows.archivedAt))) : [];
    const windowIds = oldWindows.map(w => w.id);
    const history = windowIds.length ? await tx.select().from(completions).where(inArray(completions.windowId, windowIds)) : [];
    const submittedServices = new Set<string>(), submittedWindows = new Set<string>();
    for (const s of body.services) {
      const problem = validateScheduleWindows(contract, s);
      if (problem) throw new ScheduleError(400, problem);
      if (s.id) {
        if (submittedServices.has(s.id) || !oldServices.some(old => old.id === s.id)) {
          throw new ScheduleError(400, `${s.name}: service id does not belong to this contract or is duplicated.`);
        }
        submittedServices.add(s.id);
      }
      for (const w of s.windows) if (w.id) {
        if (submittedWindows.has(w.id) || !oldWindows.some(old => old.id === w.id && old.serviceId === s.id)) {
          throw new ScheduleError(400, `${s.name}: window id does not belong to this service and contract or is duplicated.`);
        }
        submittedWindows.add(w.id);
      }
    }
    const removed = oldWindows.filter(w => !submittedWindows.has(w.id));
    for (const w of removed) if (history.some(c => c.windowId === w.id && !c.undoneAt)) {
      const name = oldServices.find(s => s.id === w.serviceId)!.name;
      throw new ScheduleError(409, `${name} window ${w.startDate} – ${w.endDate} is marked done; undo it before removing the window.`);
    }
    const now = new Date();
    for (const w of removed) {
      if (history.some(c => c.windowId === w.id)) {
        await tx.update(windows).set({ archivedAt: now, updatedAt: now }).where(eq(windows.id, w.id));
      } else await tx.delete(windows).where(eq(windows.id, w.id));
    }
    for (const s of oldServices.filter(s => !submittedServices.has(s.id))) {
      if (oldWindows.some(w => w.serviceId === s.id && history.some(c => c.windowId === w.id)) ||
          (await tx.select({ id: windows.id }).from(windows).where(eq(windows.serviceId, s.id))).length) {
        await tx.update(services).set({ archivedAt: now, updatedAt: now }).where(eq(services.id, s.id));
      } else await tx.delete(services).where(eq(services.id, s.id));
    }
    // Temporarily archive survivors to release their seq values. Everything is
    // invisible until commit; retained historical seq values never participate.
    if (submittedWindows.size) await tx.update(windows).set({ archivedAt: now })
      .where(inArray(windows.id, [...submittedWindows]));
    for (const { windows: incoming, id, ...s } of body.services) {
      const values = { ...s, description: s.description ?? null, includedText: s.includedText ?? null, cadenceText: s.cadenceText ?? null, updatedAt: now };
      const [saved] = id
        ? await tx.update(services).set(values).where(eq(services.id, id)).returning()
        : await tx.insert(services).values({ ...values, contractId }).returning();
      const ordered = incoming.map((w, i) => ({ ...w, position: i })).sort((a, b) =>
        a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.position - b.position);
      for (const [i, w] of ordered.entries()) {
        const values = { serviceId: saved.id, startDate: w.startDate, endDate: w.endDate, seq: i + 1, archivedAt: null, updatedAt: now };
        if (w.id) await tx.update(windows).set(values).where(eq(windows.id, w.id));
        else await tx.insert(windows).values(values);
      }
    }
    await tx.delete(rates).where(eq(rates.contractId, contractId));
    if (body.rates.length) await tx.insert(rates).values(body.rates.map(r => ({ ...r, contractId })));
  });
  return getContractSchedule(contractId, caller);
}

async function locateWindow(database: Pick<typeof db, "select">, windowId: string) {
  const [row] = await database.select({ window: windows, service: services }).from(windows)
    .innerJoin(services, eq(windows.serviceId, services.id)).where(eq(windows.id, windowId));
  return row ?? missing("Window");
}
async function locateCompletion(database: Pick<typeof db, "select">, completionId: string) {
  const [row] = await database.select({ completion: completions, window: windows, service: services }).from(completions)
    .innerJoin(windows, eq(completions.windowId, windows.id))
    .innerJoin(services, eq(windows.serviceId, services.id)).where(eq(completions.id, completionId));
  return row ?? missing("Completion");
}
function active(row: Awaited<ReturnType<typeof locateWindow>>) {
  if (row.window.archivedAt || row.service.archivedAt) missing("Window");
}
async function completionView(c: ContractServiceCompletion, actor: Actor, contract: Contract, member: boolean, tx: Tx) {
  const [author] = await tx.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.id, c.completedBy));
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(photos).where(eq(photos.completionId, c.id));
  return { id: c.id, completedOn: c.completedOn, completedBy: author, note: c.note,
    photoCount: count.n, canUndo: await policy.canUndoCompletion(actor, contract, c, todayInDenver(), member) };
}

export async function completeWindow(windowId: string, input: { completedOn: string; note?: string | null }, caller: Actor) {
  const body = completeContractServiceSchema.parse(input);
  return db.transaction(async tx => {
    const first = await locateWindow(tx, windowId);
    const { contract, actor, member } = await lockedContext(tx, first.service.contractId, caller);
    const row = await locateWindow(tx, windowId);
    policy.assertCan(await policy.canCompleteContractService(actor, contract, member), "Access denied");
    active(row);
    if (row.service.kind !== "counted") throw new ScheduleError(400, "Only counted services are marked done.");
    if (body.completedOn < row.window.startDate) throw new ScheduleError(400, `This window opens ${row.window.startDate}.`);
    if (body.completedOn > todayInDenver()) throw new ScheduleError(400, "The date can't be in the future.");
    // The partial unique index arbitrates duplicates, not a racy preflight read.
    let completion: ContractServiceCompletion;
    try {
      // A savepoint keeps the outer transaction usable after a unique violation.
      [completion] = await tx.transaction(async savepoint => savepoint.insert(completions).values({
        windowId, completedOn: body.completedOn, note: body.note, completedBy: actor.id,
      }).returning());
    } catch (error) {
      const cause = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
      const pgError = cause.cause ?? cause;
      if (pgError.code !== "23505" || pgError.constraint !== "contract_service_completions_live_idx") throw error;
      const [existing] = await tx.select().from(completions).where(and(eq(completions.windowId, windowId), isNull(completions.undoneAt)));
      throw new ScheduleError(409, "This window is already marked done.", {
        completion: await completionView(existing, actor, contract, member, tx),
      });
    }
    return { completion: await completionView(completion, actor, contract, member, tx), window: { id: windowId, state: "done" } };
  });
}

export async function undoCompletion(completionId: string, caller: Actor) {
  return db.transaction(async tx => {
    const first = await locateCompletion(tx, completionId);
    const { contract, actor, member } = await lockedContext(tx, first.service.contractId, caller);
    const row = await locateCompletion(tx, completionId);
    policy.assertCan(await policy.canUndoCompletion(actor, contract, row.completion, todayInDenver(), member), "Access denied");
    if (row.completion.undoneAt) throw new ScheduleError(409, "Completion is already undone.");
    await tx.update(completions).set({ undoneAt: new Date(), undoneBy: actor.id }).where(eq(completions.id, completionId));
    return { id: row.window.id, seq: row.window.seq, startDate: row.window.startDate, endDate: row.window.endDate,
      state: windowState({ ...row.window, kind: row.service.kind }, null, todayInDenver()), completion: null };
  });
}

export async function addCompletionPhoto(completionId: string, input: { uploadURL: string; idempotencyKey: string }, caller: Actor) {
  const body = contractCompletionPhotoSchema.parse(input);
  return db.transaction(async tx => {
    const first = await locateCompletion(tx, completionId);
    const { contract, actor, member } = await lockedContext(tx, first.service.contractId, caller);
    policy.assertCan(await policy.canCompleteContractService(actor, contract, member), "Access denied");
    await locateCompletion(tx, completionId);
    const strict = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
    if (strict) {
      const parsed = parseUploadURL(body.uploadURL);
      if (!parsed.valid) throw new ScheduleError(400, parsed.reason ?? "Invalid upload URL", { code: "INVALID_UPLOAD_URL" });
    }
    const [existing] = await tx.select().from(photos).where(and(eq(photos.completionId, completionId), eq(photos.idempotencyKey, body.idempotencyKey)));
    if (existing) return { photo: existing, created: false };
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(photos).where(eq(photos.completionId, completionId));
    if (count.n >= 10) throw new ScheduleError(400, "At most 10 photos per completion.");
    // Object storage cannot participate in the SQL transaction: claim failures
    // roll back SQL, but a later SQL/connection failure may leave a claimed object.
    const objectPath = await new ObjectStorageService().claimObjectForCaller(
      body.uploadURL, actor.id, buildCommunityAclPolicy(actor.id, contract.communityId),
    );
    const [photo] = await tx.insert(photos).values({
      completionId, objectPath, idempotencyKey: body.idempotencyKey, uploadedBy: actor.id,
    }).returning();
    return { photo, created: true };
  });
}

export async function listCompletionPhotos(completionId: string, actor: Actor) {
  const row = await locateCompletion(db, completionId);
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, row.service.contractId));
  if (!contract || !policy.isContractVisible(actor, contract)) missing("Completion");
  policy.assertCan(await policy.canReadCommunitySchedule(actor, contract.communityId), "Access denied");
  return (await db.select().from(photos).where(eq(photos.completionId, completionId)).orderBy(asc(photos.createdAt), asc(photos.id)))
    .map(p => ({ id: p.id, url: p.objectPath }));
}
