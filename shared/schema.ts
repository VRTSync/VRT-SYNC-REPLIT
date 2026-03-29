import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, date, doublePrecision, pgEnum, uniqueIndex, index, boolean, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", ["contractor", "admin", "hoa_admin", "hoa_member", "property_manager"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "completed", "submitted", "acknowledged"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const scheduleFrequencyEnum = pgEnum("schedule_frequency", ["weekly", "monthly", "once"]);
export const scheduleRunStatusEnum = pgEnum("schedule_run_status", ["success", "failure"]);
export const exportStatusEnum = pgEnum("export_status", ["queued", "running", "complete", "failed"]);
export const serviceTypeEnum = pgEnum("service_type", ["mowing_visit"]);

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  role: userRoleEnum("role").notNull().default("contractor"),
  hoaCommunityId: varchar("hoa_community_id").references(() => communities.id),
  isActive: boolean("is_active").notNull().default(true),
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
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("community_members_community_user_idx").on(table.communityId, table.userId),
]);

export const tasks = pgTable("tasks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  address: text("address"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  startDate: timestamp("start_date"),
  dueDate: timestamp("due_date"),
  ticketType: text("ticket_type"),
  windowStart: date("window_start"),
  windowEnd: date("window_end"),
  version: integer("version").notNull().default(1),
  scheduleInstanceKey: varchar("schedule_instance_key"),
  importFingerprint: varchar("import_fingerprint"),
  origin: varchar("origin"),
  assetId: varchar("asset_id").references(() => assets.id, { onDelete: 'set null' }),
  category: varchar("category"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("tasks_schedule_instance_key_idx").on(table.scheduleInstanceKey),
  index("tasks_import_fingerprint_idx").on(table.importFingerprint),
  index("tasks_community_id_idx").on(table.communityId),
  index("tasks_assigned_to_idx").on(table.assignedTo),
]);

export const taskCompletions = pgTable("task_completions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: 'cascade' }),
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
  taskCompletionId: varchar("task_completion_id").references(() => taskCompletions.id, { onDelete: 'cascade' }),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: 'cascade' }),
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

export const assetNotes = pgTable("asset_notes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  assetId: varchar("asset_id").notNull().references(() => assets.id, { onDelete: 'cascade' }),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  noteText: text("note_text").notNull(),
  idempotencyKey: varchar("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("asset_notes_asset_idx").on(table.assetId),
  index("asset_notes_community_idx").on(table.communityId),
]);

export const geometryTypeEnum = pgEnum("geometry_type", ["point", "polygon", "line"]);

export const linkTypeEnum = pgEnum("link_type", ["asset", "pin"]);
export const templateTargetTypeEnum = pgEnum("template_target_type", ["none", "asset_type", "map_layer", "specific_asset"]);

export const assets = pgTable("assets", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  assetType: assetTypeEnum("asset_type").notNull(),
  label: text("label").notNull(),
  featureRef: text("feature_ref"),
  mapLayerId: varchar("map_layer_id").references(() => mapLayers.id, { onDelete: 'cascade' }),
  geometryType: geometryTypeEnum("geometry_type"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  sourceUpdatedAt: timestamp("source_updated_at"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdBy: varchar("created_by").references((): AnyPgColumn => users.id),
  updatedBy: varchar("updated_by").references((): AnyPgColumn => users.id),
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
  assetId: varchar("asset_id").notNull().references(() => assets.id, { onDelete: 'cascade' }),
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
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  linkType: linkTypeEnum("link_type").notNull(),
  assetId: varchar("asset_id").references(() => assets.id, { onDelete: 'cascade' }),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const offlinePacks = pgTable("offline_packs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
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
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  layerKey: text("layer_key").notNull(),
  subLayerKey: text("sub_layer_key").notNull(),
  displayName: text("display_name").notNull(),
  sourceFormat: text("source_format").notNull().default("geojson"),
  geojsonData: text("geojson_data"),
  color: text("color"),
  strokeColor: text("stroke_color"),
  strokeWeight: integer("stroke_weight"),
  fillOpacity: text("fill_opacity"),
  isEnabled: boolean("is_enabled").notNull().default(true),
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
  targetMapLayerId: varchar("target_map_layer_id").references(() => mapLayers.id, { onDelete: 'set null' }),
  targetAssetId: varchar("target_asset_id").references(() => assets.id, { onDelete: 'set null' }),
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
  templateId: varchar("template_id").notNull().references(() => taskTemplates.id, { onDelete: 'cascade' }),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  runAt: timestamp("run_at").defaultNow().notNull(),
  taskCountCreated: integer("task_count_created").notNull().default(0),
  assignmentUserId: varchar("assignment_user_id").references(() => users.id),
});

export const taskSchedules = pgTable("task_schedules", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  templateId: varchar("template_id").notNull().references(() => taskTemplates.id, { onDelete: 'cascade' }),
  frequency: scheduleFrequencyEnum("frequency").notNull().default("weekly"),
  daysOfWeek: text("days_of_week"),
  dayOfMonth: integer("day_of_month"),
  timezone: text("timezone").notNull().default("America/Denver"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  nextRunAt: timestamp("next_run_at"),
  assignToUserId: varchar("assign_to_user_id").references(() => users.id),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scheduleRuns = pgTable("schedule_runs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => taskSchedules.id, { onDelete: 'cascade' }),
  runAt: timestamp("run_at").defaultNow().notNull(),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  createdCount: integer("created_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  status: scheduleRunStatusEnum("status").notNull().default("success"),
  errorMessage: text("error_message"),
});

export const scheduleRunItems = pgTable("schedule_run_items", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => scheduleRuns.id, { onDelete: 'cascade' }),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: 'cascade' }),
});

export const exports = pgTable("exports", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  type: text("type").notNull().default("proof_of_work"),
  status: exportStatusEnum("status").notNull().default("queued"),
  filters: jsonb("filters"),
  pdfFileRef: text("pdf_file_ref"),
  photosZipRef: text("photos_zip_ref"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
}, (table) => [
  index("exports_community_created_idx").on(table.communityId, table.createdAt),
]);

export const serviceSchedules = pgTable("service_schedules", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  serviceType: serviceTypeEnum("service_type").notNull().default("mowing_visit"),
  dayOfWeek: integer("day_of_week").notNull(),
  seasonStart: date("season_start"),
  seasonEnd: date("season_end"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const serviceVisits = pgTable("service_visits", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => serviceSchedules.id, { onDelete: 'cascade' }),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  serviceDate: date("service_date").notNull(),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id),
  employeeSignOffName: text("employee_sign_off_name").notNull().default(''),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("service_visits_schedule_date_idx").on(table.scheduleId, table.serviceDate),
]);

export const exportsRelations = relations(exports, ({ one }) => ({
  community: one(communities, { fields: [exports.communityId], references: [communities.id] }),
  creator: one(users, { fields: [exports.createdBy], references: [users.id] }),
}));

export const serviceSchedulesRelations = relations(serviceSchedules, ({ one, many }) => ({
  community: one(communities, { fields: [serviceSchedules.communityId], references: [communities.id] }),
  visits: many(serviceVisits),
}));

export const serviceVisitsRelations = relations(serviceVisits, ({ one }) => ({
  schedule: one(serviceSchedules, { fields: [serviceVisits.scheduleId], references: [serviceSchedules.id] }),
  community: one(communities, { fields: [serviceVisits.communityId], references: [communities.id] }),
  completedByUser: one(users, { fields: [serviceVisits.completedBy], references: [users.id] }),
}));

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
  createdAssets: many(assets, { relationName: "createdAssets" }),
  updatedAssets: many(assets, { relationName: "updatedAssets" }),
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
  task: one(tasks, { fields: [attachments.taskId], references: [tasks.id] }),
  uploader: one(users, { fields: [attachments.uploadedBy], references: [users.id] }),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  community: one(communities, { fields: [assets.communityId], references: [communities.id] }),
  mapLayer: one(mapLayers, { fields: [assets.mapLayerId], references: [mapLayers.id] }),
  createdByUser: one(users, { fields: [assets.createdBy], references: [users.id], relationName: "createdAssets" }),
  updatedByUser: one(users, { fields: [assets.updatedBy], references: [users.id], relationName: "updatedAssets" }),
  properties: many(assetProperties),
  taskLinks: many(taskLinks),
}));

export const assetPropertiesRelations = relations(assetProperties, ({ one }) => ({
  asset: one(assets, { fields: [assetProperties.assetId], references: [assets.id] }),
}));

export const assetNotesRelations = relations(assetNotes, ({ one }) => ({
  asset: one(assets, { fields: [assetNotes.assetId], references: [assets.id] }),
  community: one(communities, { fields: [assetNotes.communityId], references: [communities.id] }),
  creator: one(users, { fields: [assetNotes.createdBy], references: [users.id] }),
}));

export const taskLinksRelations = relations(taskLinks, ({ one }) => ({
  task: one(tasks, { fields: [taskLinks.taskId], references: [tasks.id] }),
  asset: one(assets, { fields: [taskLinks.assetId], references: [assets.id] }),
}));

export const mapLayersRelations = relations(mapLayers, ({ one, many }) => ({
  community: one(communities, { fields: [mapLayers.communityId], references: [communities.id] }),
  assets: many(assets),
}));

export const CONTACT_TYPES = [
  'HOA Board', 'Property Management', 'Contractor', 'Vendor',
  'City/Municipality', 'Emergency', 'Other',
] as const;

export const contacts = pgTable("contacts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  title: text("title"),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  contactType: text("contact_type").notNull().default("Other"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("contacts_community_idx").on(table.communityId),
  index("contacts_type_idx").on(table.contactType),
]);

export const contactsRelations = relations(contacts, ({ one }) => ({
  community: one(communities, { fields: [contacts.communityId], references: [communities.id] }),
}));

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

export const insertContactSchema = z.object({
  communityId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactType: z.enum(CONTACT_TYPES).default('Other'),
  notes: z.string().nullable().optional(),
});

export const updateContactSchema = z.object({
  communityId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactType: z.enum(CONTACT_TYPES).optional(),
  notes: z.string().nullable().optional(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  role: true,
  hoaCommunityId: true,
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
  startDate: true,
  dueDate: true,
  ticketType: true,
  windowStart: true,
  windowEnd: true,
  origin: true,
  assetId: true,
  category: true,
});

export const createHoaRequestSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  priority: z.enum(["General", "Urgent"]),
  category: z.enum(["Irrigation", "Landscape", "Snow", "Other"]).optional(),
  assetId: z.string().optional(),
  assignedTo: z.string().optional(),
  pinLat: z.number().min(-90).max(90).optional(),
  pinLng: z.number().min(-180).max(180).optional(),
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
  tags: z.array(z.string()).optional(),
});

export const updateAssetSchema = z.object({
  label: z.string().min(1).optional(),
  featureRef: z.string().nullable().optional(),
  geometryType: z.enum(["point", "polygon", "line"]).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
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
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const updateMapLayerSchema = z.object({
  displayName: z.string().min(1).optional(),
  sourceFormat: z.enum(["geojson", "kml"]).optional(),
  geojsonData: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  strokeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  strokeWeight: z.number().int().min(1).max(10).optional(),
  fillOpacity: z.string().refine(v => { const n = parseFloat(v); return !isNaN(n) && n >= 0 && n <= 1; }, { message: 'fillOpacity must be a number between 0 and 1' }).optional(),
  isEnabled: z.boolean().optional(),
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

export const insertTaskScheduleSchema = z.object({
  communityId: z.string().min(1),
  templateId: z.string().min(1),
  frequency: z.enum(["weekly", "monthly", "once"]).default("weekly"),
  daysOfWeek: z.string().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  timezone: z.string().default("America/Denver"),
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
  assignToUserId: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
});

export const insertServiceScheduleSchema = z.object({
  communityId: z.string().min(1),
  serviceType: z.enum(["mowing_visit"]).default("mowing_visit"),
  dayOfWeek: z.number().int().min(0).max(6),
  seasonStart: z.string().nullable().optional(),
  seasonEnd: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateServiceScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  seasonStart: z.string().nullable().optional(),
  seasonEnd: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const logServiceVisitSchema = z.object({
  serviceDate: z.string().min(1),
  employeeSignOffName: z.string().default(''),
  notes: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
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
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type ScheduleRunItem = typeof scheduleRunItems.$inferSelect;
export type Export = typeof exports.$inferSelect;
export type ServiceSchedule = typeof serviceSchedules.$inferSelect;
export type ServiceVisit = typeof serviceVisits.$inferSelect;
export type AssetNote = typeof assetNotes.$inferSelect;

export const notifications = pgTable("notifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  body: text("body").notNull(),
  relatedTaskId: varchar("related_task_id").references(() => tasks.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
}, (table) => [
  index("notifications_recipient_idx").on(table.recipientUserId),
  index("notifications_created_at_idx").on(table.createdAt),
]);

export type Notification = typeof notifications.$inferSelect;

export const insertAssetNoteSchema = z.object({
  noteText: z.string().min(1, "Note text is required"),
  idempotencyKey: z.string().optional(),
});

export const driveFolders = pgTable("drive_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  parentId: varchar("parent_id").references((): AnyPgColumn => driveFolders.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const driveFiles = pgTable("drive_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  folderId: varchar("folder_id").references(() => driveFolders.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  fileRef: text("file_ref").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DriveFolder = typeof driveFolders.$inferSelect;
export type DriveFile = typeof driveFiles.$inferSelect;

export const insertDriveFolderSchema = z.object({
  communityId: z.string().min(1),
  parentId: z.string().optional().nullable(),
  name: z.string().min(1, "Folder name is required"),
});

export const updateDriveFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
});

export const insertDriveFileSchema = z.object({
  communityId: z.string().min(1),
  folderId: z.string().optional().nullable(),
  name: z.string().min(1, "File name is required"),
  fileRef: z.string().min(1),
  mimeType: z.string().optional().nullable(),
  sizeBytes: z.number().int().optional().nullable(),
});

export const updateDriveFileSchema = z.object({
  name: z.string().min(1, "File name is required"),
});

export const invoices = pgTable("invoices", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  contractor: text("contractor").notNull(),
  completionDate: date("completion_date").notNull(),
  serviceType: text("service_type").notNull(),
  cost: doublePrecision("cost").notNull(),
  notes: text("notes"),
  pdfObjectKey: text("pdf_object_key"),
  attachmentLabel: text("attachment_label"),
  attachmentLayerId: varchar("attachment_layer_id").references(() => mapLayers.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("invoices_community_idx").on(table.communityId),
  index("invoices_completion_date_idx").on(table.completionDate),
]);

export type Invoice = typeof invoices.$inferSelect;

export const insertInvoiceSchema = z.object({
  communityId: z.string().min(1),
  contractor: z.string().min(1, "Contractor name is required"),
  completionDate: z.string().min(1, "Completion date is required"),
  serviceType: z.string().min(1, "Service type is required"),
  cost: z.number().min(0, "Cost must be non-negative"),
  notes: z.string().optional().nullable(),
  pdfObjectKey: z.string().optional().nullable(),
  attachmentLabel: z.string().optional().nullable(),
  attachmentLayerId: z.string().optional().nullable(),
});

export const updateInvoiceSchema = z.object({
  contractor: z.string().min(1).optional(),
  completionDate: z.string().min(1).optional(),
  serviceType: z.string().min(1).optional(),
  cost: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  pdfObjectKey: z.string().optional().nullable(),
  attachmentLabel: z.string().optional().nullable(),
  attachmentLayerId: z.string().optional().nullable(),
});

export const invoicesRelations = relations(invoices, ({ one }) => ({
  community: one(communities, { fields: [invoices.communityId], references: [communities.id] }),
  attachmentLayer: one(mapLayers, { fields: [invoices.attachmentLayerId], references: [mapLayers.id] }),
}));

export const contracts = pgTable("contracts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  communityId: varchar("community_id").notNull().references(() => communities.id, { onDelete: 'cascade' }),
  contractorUserId: varchar("contractor_user_id").notNull().references(() => users.id),
  contractType: text("contract_type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  servicesIncluded: jsonb("services_included").notNull().default(sql`'[]'::jsonb`),
  pdfObjectKey: text("pdf_object_key"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("contracts_community_idx").on(table.communityId),
  index("contracts_contractor_idx").on(table.contractorUserId),
]);

export type Contract = typeof contracts.$inferSelect;

export const contractsRelations = relations(contracts, ({ one }) => ({
  community: one(communities, { fields: [contracts.communityId], references: [communities.id] }),
  contractorUser: one(users, { fields: [contracts.contractorUserId], references: [users.id] }),
}));

export const insertContractSchema = z.object({
  communityId: z.string().min(1, "Community is required"),
  contractorUserId: z.string().min(1, "Contractor is required"),
  contractType: z.string().min(1, "Contract type is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  servicesIncluded: z.array(z.string()).default([]),
  pdfObjectKey: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateContractSchema = z.object({
  contractorUserId: z.string().min(1).optional(),
  contractType: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  servicesIncluded: z.array(z.string()).optional(),
  pdfObjectKey: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const pushTickets = pgTable("push_tickets", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  ticketId: text("ticket_id").notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("push_tickets_created_at_idx").on(table.createdAt),
]);

export type PushTicket = typeof pushTickets.$inferSelect;

export const plannerRecordStatusEnum = pgEnum("planner_record_status", [
  "draft",
  "reviewed",
  "selected_for_estimate",
  "archived",
]);

export const plannerRecords = pgTable("planner_records", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").notNull(),
  recordName: text("record_name").notNull(),
  status: plannerRecordStatusEnum("status").notNull().default("draft"),
  internalNotes: text("internal_notes"),
  assumptionsJson: jsonb("assumptions_json").notNull(),
  groupsJson: jsonb("groups_json").notNull(),
  totalSqft: doublePrecision("total_sqft").notNull().default(0),
  totalEstimatedCost: doublePrecision("total_estimated_cost").notNull().default(0),
  totalAnnualSavings: doublePrecision("total_annual_savings").notNull().default(0),
  paybackYears: doublePrecision("payback_years"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("planner_records_property_idx").on(table.propertyId),
  index("planner_records_status_idx").on(table.status),
]);

export type PlannerRecord = typeof plannerRecords.$inferSelect;
export type InsertPlannerRecord = typeof plannerRecords.$inferInsert;
