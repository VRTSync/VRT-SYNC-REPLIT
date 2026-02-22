import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, doublePrecision, pgEnum, uniqueIndex, index, boolean } from "drizzle-orm/pg-core";
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
}, (table) => [
  uniqueIndex("community_members_community_user_idx").on(table.communityId, table.userId),
]);

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
  employeeSignOffName: text("employee_sign_off_name").notNull().default(''),
  timeSpentMinutes: integer("time_spent_minutes"),
  materialsUsed: text("materials_used"),
  followUpNeeded: text("follow_up_needed"),
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
  idempotencyKey: varchar("idempotency_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("attachments_completion_idempotency_idx").on(table.taskCompletionId, table.idempotencyKey),
]);

export const pushTokens = pgTable("push_tokens", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: text("token").notNull(),
  platform: text("platform").notNull(),
  deviceId: text("device_id").notNull().default('unknown'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("push_tokens_user_device_idx").on(table.userId, table.deviceId),
]);

export const assetTypeEnum = pgEnum("asset_type", [
  "controller", "backflow", "zone", "tree", "pet_station",
  "landscape_bed", "bluegrass_area", "native_area", "snow_area",
]);

export const geometryTypeEnum = pgEnum("geometry_type", ["point", "polygon", "line"]);

export const linkTypeEnum = pgEnum("link_type", ["asset", "pin"]);
export const templateTargetTypeEnum = pgEnum("template_target_type", ["none", "asset_type", "map_layer", "specific_asset"]);

export const assets = pgTable("assets", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  assetType: assetTypeEnum("asset_type").notNull(),
  label: text("label").notNull(),
  featureRef: text("feature_ref"),
  mapLayerId: varchar("map_layer_id").references(() => mapLayers.id),
  geometryType: geometryTypeEnum("geometry_type"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  sourceUpdatedAt: timestamp("source_updated_at"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("assets_community_type_idx").on(table.communityId, table.assetType),
  index("assets_community_feature_idx").on(table.communityId, table.featureRef),
  index("assets_community_type_archived_idx").on(table.communityId, table.assetType, table.isArchived),
  uniqueIndex("assets_community_layer_feature_idx").on(table.communityId, table.mapLayerId, table.featureRef),
]);

export const assetProperties = pgTable("asset_properties", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  assetId: varchar("asset_id").notNull().references(() => assets.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("asset_properties_asset_key_idx").on(table.assetId, table.key),
]);

export const taskLinks = pgTable("task_links", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id),
  linkType: linkTypeEnum("link_type").notNull(),
  assetId: varchar("asset_id").references(() => assets.id),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const offlinePacks = pgTable("offline_packs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  packVersion: integer("pack_version").notNull().default(1),
  mbtilesRef: text("mbtiles_ref"),
  manifestRef: text("manifest_ref"),
  geojsonBundleRef: text("geojson_bundle_ref"),
  assetIndexRef: text("asset_index_ref"),
  searchIndexRef: text("search_index_ref"),
  checksum: text("checksum"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("offline_packs_community_version_idx").on(table.communityId, table.packVersion),
]);

export const LAYER_KEYS = ["community", "irrigation", "snow", "trees"] as const;

export const mapLayers = pgTable("map_layers", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  layerKey: text("layer_key").notNull(),
  subLayerKey: text("sub_layer_key").notNull(),
  displayName: text("display_name").notNull(),
  sourceFormat: text("source_format").notNull().default("geojson"),
  geojsonData: text("geojson_data"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("map_layers_community_layer_idx").on(table.communityId, table.layerKey),
  uniqueIndex("map_layers_community_layer_sub_idx").on(table.communityId, table.layerKey, table.subLayerKey),
]);

export const taskTemplates = pgTable("task_templates", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  defaultStatus: taskStatusEnum("default_status").notNull().default("pending"),
  dueDaysOffset: integer("due_days_offset"),
  targetType: templateTargetTypeEnum("target_type").notNull().default("none"),
  targetAssetType: text("target_asset_type"),
  targetMapLayerId: varchar("target_map_layer_id").references(() => mapLayers.id),
  targetAssetId: varchar("target_asset_id").references(() => assets.id),
  requireSignOffName: boolean("require_sign_off_name").notNull().default(true),
  allowPhotos: boolean("allow_photos").notNull().default(true),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const templateRuns = pgTable("template_runs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => taskTemplates.id),
  communityId: varchar("community_id").notNull().references(() => communities.id),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  runAt: timestamp("run_at").defaultNow().notNull(),
  taskCountCreated: integer("task_count_created").notNull().default(0),
  assignmentUserId: varchar("assignment_user_id").references(() => users.id),
});

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, { fields: [pushTokens.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  communityMembers: many(communityMembers),
  assignedTasks: many(tasks, { relationName: "assignedTasks" }),
  createdTasks: many(tasks, { relationName: "createdTasks" }),
  completions: many(taskCompletions),
  uploadedAttachments: many(attachments),
  pushTokens: many(pushTokens),
}));

export const offlinePacksRelations = relations(offlinePacks, ({ one }) => ({
  community: one(communities, { fields: [offlinePacks.communityId], references: [communities.id] }),
}));

export const communitiesRelations = relations(communities, ({ many }) => ({
  members: many(communityMembers),
  tasks: many(tasks),
  assets: many(assets),
  mapLayers: many(mapLayers),
  offlinePacks: many(offlinePacks),
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
  taskLinks: many(taskLinks),
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

export const assetsRelations = relations(assets, ({ one, many }) => ({
  community: one(communities, { fields: [assets.communityId], references: [communities.id] }),
  mapLayer: one(mapLayers, { fields: [assets.mapLayerId], references: [mapLayers.id] }),
  properties: many(assetProperties),
  taskLinks: many(taskLinks),
}));

export const assetPropertiesRelations = relations(assetProperties, ({ one }) => ({
  asset: one(assets, { fields: [assetProperties.assetId], references: [assets.id] }),
}));

export const taskLinksRelations = relations(taskLinks, ({ one }) => ({
  task: one(tasks, { fields: [taskLinks.taskId], references: [tasks.id] }),
  asset: one(assets, { fields: [taskLinks.assetId], references: [assets.id] }),
}));

export const mapLayersRelations = relations(mapLayers, ({ one, many }) => ({
  community: one(communities, { fields: [mapLayers.communityId], references: [communities.id] }),
  assets: many(assets),
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
  employeeSignOffName: z.string().min(1, "Sign-off name is required"),
  timeSpentMinutes: z.number().int().positive().optional(),
  materialsUsed: z.string().optional(),
  followUpNeeded: z.string().optional(),
  version: z.number(),
});

export const registerPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
  deviceId: z.string().min(1),
});

export const ASSET_TYPES = [
  "controller", "backflow", "zone", "tree", "pet_station",
  "landscape_bed", "bluegrass_area", "native_area", "snow_area",
] as const;

export const insertAssetSchema = z.object({
  communityId: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  label: z.string().min(1),
  featureRef: z.string().optional(),
  mapLayerId: z.string().optional(),
  geometryType: z.enum(["point", "polygon", "line"]).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const updateAssetSchema = z.object({
  label: z.string().min(1).optional(),
  featureRef: z.string().nullable().optional(),
  geometryType: z.enum(["point", "polygon", "line"]).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  version: z.number(),
});

export const upsertAssetPropertiesSchema = z.object({
  properties: z.array(z.object({
    key: z.string().min(1),
    value: z.string(),
  })),
});

export const setTaskLinkSchema = z.object({
  linkType: z.enum(["asset", "pin"]),
  assetId: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  version: z.number(),
});

export const insertMapLayerSchema = z.object({
  communityId: z.string().min(1),
  layerKey: z.string().min(1),
  subLayerKey: z.string().min(1),
  displayName: z.string().min(1),
  sourceFormat: z.enum(["geojson", "kml"]).default("geojson"),
  geojsonData: z.string().optional(),
});

export const updateMapLayerSchema = z.object({
  displayName: z.string().min(1).optional(),
  sourceFormat: z.enum(["geojson", "kml"]).optional(),
  geojsonData: z.string().optional(),
  version: z.number(),
});

export const insertOfflinePackSchema = z.object({
  communityId: z.string().min(1),
  packVersion: z.number().int().positive().optional(),
  mbtilesRef: z.string().optional(),
  manifestRef: z.string().optional(),
  geojsonBundleRef: z.string().optional(),
  assetIndexRef: z.string().optional(),
  checksum: z.string().optional(),
});

export const insertTaskTemplateSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  defaultStatus: z.enum(["pending", "in_progress", "completed"]).default("pending"),
  dueDaysOffset: z.number().int().nullable().optional(),
  targetType: z.enum(["none", "asset_type", "map_layer", "specific_asset"]).default("none"),
  targetAssetType: z.string().nullable().optional(),
  targetMapLayerId: z.string().nullable().optional(),
  targetAssetId: z.string().nullable().optional(),
  requireSignOffName: z.boolean().default(true),
  allowPhotos: z.boolean().default(true),
});

export const generateFromTemplateSchema = z.object({
  communityId: z.string().min(1),
  dueDate: z.string().optional(),
  assignToUserId: z.string().optional(),
  limit: z.number().int().positive().optional(),
  includeArchivedAssets: z.boolean().default(false),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Community = typeof communities.$inferSelect;
export type CommunityMember = typeof communityMembers.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskCompletion = typeof taskCompletions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type PushToken = typeof pushTokens.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type AssetProperty = typeof assetProperties.$inferSelect;
export type TaskLink = typeof taskLinks.$inferSelect;
export type MapLayer = typeof mapLayers.$inferSelect;
export type OfflinePack = typeof offlinePacks.$inferSelect;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type TemplateRun = typeof templateRuns.$inferSelect;
