import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as storage from "../storage";
import { pool } from "../db";

// 60-second in-process cache for GET /api/admin/dashboard
let adminDashboardCache: { data: Awaited<ReturnType<typeof storage.getAdminDashboard>>; expiresAt: number } | null = null;


export function registerAdminOverviewRoutes(app: Express): void {
  app.get("/api/admin/migrations", requireAdmin, route(async (_req: Request, res: Response) => {
    try {
      // 1. Read all hashes stored by Drizzle's migration tracker
      const dbResult = await pool.query<{ id: number; hash: string; created_at: string }>(
        "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id"
      );
      const storedHashSet = new Set(dbResult.rows.map((r) => r.hash));

      // 2. Read the migration journal bundled into dist/migrations at build time
      const migrationsDir = path.join(__dirname, "./migrations");
      const journalPath = path.join(migrationsDir, "meta/_journal.json");
      let journal: { entries: Array<{ idx: number; tag: string; when: number }> };
      try {
        journal = JSON.parse(readFileSync(journalPath, "utf8"));
      } catch {
        return void res.status(500).json({ error: "Could not read migrations journal — dist/migrations may be missing" });
      }

      // 3. For each journal entry, compute the SHA-256 hash of the SQL file (same algorithm as Drizzle)
      //    and determine applied vs pending by hash-set lookup — not by row count or position.
      const available: string[] = journal.entries.map((e) => e.tag);
      const applied: Array<{ tag: string; hash: string }> = [];
      const pending: string[] = [];
      const journalHashSet = new Set<string>();

      for (const entry of journal.entries) {
        const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
        let hash: string;
        try {
          const content = readFileSync(sqlPath, "utf8");
          hash = createHash("sha256").update(content).digest("hex");
        } catch {
          // SQL file missing from dist — treat as pending
          pending.push(entry.tag);
          continue;
        }
        journalHashSet.add(hash);
        if (storedHashSet.has(hash)) {
          applied.push({ tag: entry.tag, hash });
        } else {
          pending.push(entry.tag);
        }
      }

      // 4. Surface any DB rows whose hash does not match any journal entry (corruption / drift)
      const drift = dbResult.rows
        .filter((r) => !journalHashSet.has(r.hash))
        .map((r) => ({
          id: r.id,
          hash: r.hash,
          createdAt: new Date(Number(r.created_at)).toISOString(),
        }));

      const inSync = pending.length === 0 && drift.length === 0;

      res.json({ applied, available, pending, inSync, drift });
    } catch (error) {
      console.error("Migrations status error:", error);
      res.status(500).json({ error: "Failed to fetch migration status" });
    }
  }));

  app.get("/api/admin/summary", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const summary = await storage.getAdminSummary(communityId);
      res.json(summary);
    } catch (error) {
      console.error("Admin summary error:", error);
      res.status(500).json({ error: "Failed to fetch admin summary" });
    }
  }));

  app.get("/api/admin/dashboard", requireAdmin, route(async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (adminDashboardCache && adminDashboardCache.expiresAt > now) {
        return void res.json(adminDashboardCache.data);
      }
      const data = await storage.getAdminDashboard();
      adminDashboardCache = { data, expiresAt: now + 60_000 };
      res.json(data);
    } catch (error) {
      console.error("Admin dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch admin dashboard" });
    }
  }));

  app.get("/api/admin/completed-tasks", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) {
        return void res.status(400).json({ error: "communityId is required" });
      }
      const completedTasks = await storage.getCompletedTasksWithDetails(communityId);
      res.json(completedTasks);
    } catch (error) {
      console.error("Get completed tasks error:", error);
      res.status(500).json({ error: "Failed to fetch completed tasks" });
    }
  }));
}
