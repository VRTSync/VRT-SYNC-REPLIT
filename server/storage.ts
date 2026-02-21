import { eq, and, desc, ne } from "drizzle-orm";
import { db } from "./db";
import {
  users, communities, communityMembers, tasks, taskCompletions, attachments, pushTokens,
  type User, type InsertUser, type Community, type CommunityMember,
  type Task, type TaskCompletion, type Attachment, type PushToken
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

export async function getTasksByCommunity(communityId: string): Promise<Task[]> {
  return db.select().from(tasks)
    .where(eq(tasks.communityId, communityId))
    .orderBy(desc(tasks.createdAt));
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
}): Promise<Attachment> {
  const [attachment] = await db.insert(attachments).values(data).returning();
  return attachment;
}

export async function getAttachmentsByCompletion(taskCompletionId: string): Promise<Attachment[]> {
  return db.select().from(attachments)
    .where(eq(attachments.taskCompletionId, taskCompletionId))
    .orderBy(desc(attachments.createdAt));
}

export async function registerPushToken(userId: string, token: string, platform: string): Promise<PushToken> {
  const existing = await db.select().from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
  if (existing.length > 0) {
    const [updated] = await db.update(pushTokens)
      .set({ updatedAt: new Date() })
      .where(eq(pushTokens.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(pushTokens).values({ userId, token, platform }).returning();
  return created;
}

export async function removePushToken(userId: string, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
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
