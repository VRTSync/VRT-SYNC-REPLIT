import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: "./migrations",
  dialect: "postgresql",
  // Migration-owned: drizzle-kit loses custom single-column PK names on pull.
  // Declaring session_pkey as a table-level PK proposes dropping/re-adding it.
  // Keep push away from sessions; migrate:up creates the exact existing shape.
  tablesFilter: ["!user_sessions"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    schema: "drizzle",
  },
});
