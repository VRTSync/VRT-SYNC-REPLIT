// @ts-nocheck
import app from "./app";
import { registerRoutes } from "./routes/routes";
import { logger } from "./lib/logger";
import { sendDueReminders, processReceiptsForPendingTickets } from "./pushNotifications";
import { startSchedulerInterval } from "./scheduler";
import { pool, db } from "./db";
import { users, invoices, communities, contacts } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runStartupMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS color text;
      CREATE TABLE IF NOT EXISTS drive_folders (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, parent_id varchar REFERENCES drive_folders(id) ON DELETE SET NULL, name text NOT NULL, created_by varchar NOT NULL REFERENCES users(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS drive_files (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, folder_id varchar REFERENCES drive_folders(id) ON DELETE SET NULL, name text NOT NULL, file_ref text NOT NULL, mime_type text, size_bytes integer, uploaded_by varchar NOT NULL REFERENCES users(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS invoices (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, contractor text NOT NULL, completion_date date NOT NULL, service_type text NOT NULL, cost double precision NOT NULL, notes text, pdf_object_key text, attachment_label text, attachment_layer_id varchar REFERENCES map_layers(id) ON DELETE SET NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS invoices_community_idx ON invoices(community_id);
      CREATE INDEX IF NOT EXISTS invoices_completion_date_idx ON invoices(completion_date);
      CREATE TABLE IF NOT EXISTS contracts (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, contractor_user_id varchar NOT NULL REFERENCES users(id), contract_type text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, services_included jsonb NOT NULL DEFAULT '[]'::jsonb, pdf_object_key text, is_active boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS contracts_community_idx ON contracts(community_id);
      CREATE INDEX IF NOT EXISTS contracts_contractor_idx ON contracts(contractor_user_id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
      CREATE TABLE IF NOT EXISTS water_usage (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, month integer NOT NULL CHECK (month BETWEEN 1 AND 12), year integer NOT NULL, usage_amount double precision NOT NULL, unit text NOT NULL DEFAULT 'gallons', notes text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS water_usage_community_month_year_idx ON water_usage(community_id, month, year);
      CREATE INDEX IF NOT EXISTS water_usage_community_idx ON water_usage(community_id);
      CREATE TABLE IF NOT EXISTS contacts (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), community_id varchar NOT NULL REFERENCES communities(id) ON DELETE CASCADE, name text NOT NULL, title text, company text, phone text, email text, contact_type text NOT NULL DEFAULT 'Other', notes text, created_at timestamp NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS contacts_community_idx ON contacts(community_id);
      CREATE INDEX IF NOT EXISTS contacts_type_idx ON contacts(contact_type);
      ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS stroke_color text;
      ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS stroke_weight integer;
      ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS fill_opacity text;
      ALTER TABLE map_layers ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
      CREATE TABLE IF NOT EXISTS push_tickets (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id text NOT NULL, token text NOT NULL, created_at timestamp NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS push_tickets_created_at_idx ON push_tickets(created_at);
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acknowledged_at timestamp;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'planner_record_status') THEN CREATE TYPE planner_record_status AS ENUM ('draft', 'reviewed', 'selected_for_estimate', 'archived'); END IF; END $$;
      CREATE TABLE IF NOT EXISTS planner_records (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), property_id varchar NOT NULL, record_name text NOT NULL, status planner_record_status NOT NULL DEFAULT 'draft', internal_notes text, assumptions_json jsonb NOT NULL DEFAULT '{}'::jsonb, groups_json jsonb NOT NULL DEFAULT '[]'::jsonb, total_sqft double precision NOT NULL DEFAULT 0, total_estimated_cost double precision NOT NULL DEFAULT 0, total_annual_savings double precision NOT NULL DEFAULT 0, payback_years double precision, created_by varchar REFERENCES users(id), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS planner_records_property_idx ON planner_records(property_id);
      CREATE INDEX IF NOT EXISTS planner_records_status_idx ON planner_records(status);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences jsonb;
    `);
    logger.info("Startup migrations applied.");
  } catch (err) {
    logger.error({ err }, "Startup migration error");
    throw err;
  } finally {
    client.release();
  }
}

async function seedProductionAdmin() {
  const adminUsername = process.env["SEED_ADMIN_USERNAME"];
  const adminPassword = process.env["SEED_ADMIN_PASSWORD"];
  const adminDisplayName = process.env["SEED_ADMIN_DISPLAY_NAME"] ?? "Admin";
  if (!adminUsername || !adminPassword) {
    logger.info("SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD not set — skipping admin seed");
    return;
  }
  try {
    const existing = await db.select().from(users).where(eq(users.username, adminUsername)).limit(1);
    if (existing.length === 0) {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await db.insert(users).values({ id: crypto.randomUUID(), username: adminUsername, password: hashed, role: "admin", displayName: adminDisplayName } as any);
      logger.info({ username: adminUsername }, "Seeded admin user");
    }
  } catch (err) {
    logger.error({ err }, "Admin seed failed (non-fatal)");
  }
}

async function seedInvoices() {
  try {
    const existing = await db.select().from(invoices).limit(1);
    if (existing.length > 0) return;
    const allCommunities = await db.select().from(communities).limit(3);
    if (allCommunities.length === 0) return;
    const seedData = [
      { contractor: "Green Valley Landscaping", completionDate: "2026-02-15", serviceType: "Landscape Maintenance", cost: 2450.0, notes: "Spring bed cleanup and mulching" },
      { contractor: "Rocky Mountain Tree Care", completionDate: "2026-01-20", serviceType: "Tree Trimming", cost: 1875.5, notes: "Removed dead limbs from mature elms" },
      { contractor: "AquaTech Irrigation", completionDate: "2026-03-01", serviceType: "Irrigation Repair", cost: 825.0, notes: "Replaced backflow preventer on controller A" },
      { contractor: "Summit Snow Services", completionDate: "2026-01-05", serviceType: "Snow Removal", cost: 3200.0, notes: "Full community snow removal after 8-inch storm" },
      { contractor: "Green Valley Landscaping", completionDate: "2026-03-10", serviceType: "Fertilization", cost: 1100.0, notes: "Pre-emergent herbicide and spring fertilizer application" },
    ];
    for (const s of seedData) {
      const community = allCommunities[Math.floor(Math.random() * allCommunities.length)];
      await db.insert(invoices).values({ communityId: community.id, ...s } as any);
    }
    logger.info("Seeded invoices");
  } catch (err) {
    logger.error({ err }, "Invoice seed failed (non-fatal)");
  }
}

async function seedContacts() {
  try {
    const existing = await db.select().from(contacts).limit(1);
    if (existing.length > 0) return;
    const allCommunities = await db.select().from(communities).limit(5);
    if (allCommunities.length === 0) return;
    const community = allCommunities[0];
    await db.insert(contacts).values([
      { communityId: community.id, name: "Patricia Hernandez", title: "Board President", company: community.name + " HOA", phone: "(303) 555-0182", email: "phernandez@hoaboard.com", contactType: "HOA Board", notes: "Primary board contact." } as any,
      { communityId: community.id, name: "Jennifer Park", title: "Community Manager", company: "Front Range Property Management", phone: "(720) 555-0133", email: "jpark@frontrangpm.com", contactType: "Property Management", notes: null } as any,
      { communityId: community.id, name: "911 Emergency", title: null, company: null, phone: "911", email: null, contactType: "Emergency", notes: "Police, Fire, and Medical emergencies." } as any,
    ]);
    logger.info("Seeded contacts");
  } catch (err) {
    logger.error({ err }, "Contacts seed failed (non-fatal)");
  }
}

(async () => {
  try {
    await runStartupMigrations();
  } catch (err) {
    logger.error({ err }, "Startup migrations failed — continuing");
  }

  await seedProductionAdmin();
  await seedInvoices();
  await seedContacts();

  const server = await registerRoutes(app);

  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    logger.info({ port }, "Server listening");

    setInterval(() => {
      sendDueReminders().catch((err: unknown) => logger.error({ err }, "Due reminder error"));
    }, 24 * 60 * 60 * 1000);

    setInterval(() => {
      processReceiptsForPendingTickets().catch((err: unknown) => logger.error({ err }, "Push receipt error"));
    }, 30 * 60 * 1000);

    startSchedulerInterval(3600000);
  });
})();
