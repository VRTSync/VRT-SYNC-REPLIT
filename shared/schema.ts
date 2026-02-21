import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, doublePrecision, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", ["contractor", "admin"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "completed"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  role: userRoleEnum("role").notNull().default("contractor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communities = pgTable("communities", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communityMembers = pgTable("community_members", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  address: text("address"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  dueDate: timestamp("due_date"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const taskCompletions = pgTable("task_completions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id),
  completedBy: varchar("completed_by").notNull().references(() => users.id),
  notes: text("notes"),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
});

export const attachments = pgTable("attachments", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskCompletionId: varchar("task_completion_id").notNull().references(() => taskCompletions.id),
  fileRef: text("file_ref").notNull(),
  url: text("url").notNull(),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  communityMembers: many(communityMembers),
  assignedTasks: many(tasks, { relationName: "assignedTasks" }),
  createdTasks: many(tasks, { relationName: "createdTasks" }),
  completions: many(taskCompletions),
  uploadedAttachments: many(attachments),
}));

export const communitiesRelations = relations(communities, ({ many }) => ({
  members: many(communityMembers),
  tasks: many(tasks),
}));

export const communityMembersRelations = relations(communityMembers, ({ one }) => ({
  community: one(communities, { fields: [communityMembers.communityId], references: [communities.id] }),
  user: one(users, { fields: [communityMembers.userId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  community: one(communities, { fields: [tasks.communityId], references: [communities.id] }),
  assignee: one(users, { fields: [tasks.assignedTo], references: [users.id], relationName: "assignedTasks" }),
  creator: one(users, { fields: [tasks.createdBy], references: [users.id], relationName: "createdTasks" }),
  completions: many(taskCompletions),
}));

export const taskCompletionsRelations = relations(taskCompletions, ({ one, many }) => ({
  task: one(tasks, { fields: [taskCompletions.taskId], references: [tasks.id] }),
  completedByUser: one(users, { fields: [taskCompletions.completedBy], references: [users.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  taskCompletion: one(taskCompletions, { fields: [attachments.taskCompletionId], references: [taskCompletions.id] }),
  uploader: one(users, { fields: [attachments.uploadedBy], references: [users.id] }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  role: true,
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const insertCommunitySchema = createInsertSchema(communities).pick({
  name: true,
  description: true,
});

export const insertTaskSchema = createInsertSchema(tasks).pick({
  communityId: true,
  title: true,
  description: true,
  priority: true,
  latitude: true,
  longitude: true,
  address: true,
  assignedTo: true,
  dueDate: true,
});

export const completeTaskSchema = z.object({
  notes: z.string().optional(),
  version: z.number(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Community = typeof communities.$inferSelect;
export type CommunityMember = typeof communityMembers.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskCompletion = typeof taskCompletions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
