import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import { upload } from "./upload";
import { pool } from "../db";
import { parseFile, generatePreview, commitImport } from "../contractImporter";
import { parseMasterBill, previewMasterBill, commitMasterBill, type MasterBillParseResult, type MasterBillPreviewResult } from "../masterBillImporter";
import { parseSeasonal, previewSeasonal, commitSeasonal } from "../seasonalImporter";
import { normalizeAcknowledgedCodes } from "../importAcknowledgements";

export function registerImportRoutes(app: Express): void {
  // ── Master Bill import routes ────────────────────────────────────────────

  app.post("/api/admin/import/master-bill/parse", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      if (!req.file) return void res.status(400).json({ error: "No file uploaded" });
      const batchLabel = (req.body?.batchLabel ?? "").trim();
      if (!batchLabel) return void res.status(400).json({ error: "batchLabel is required" });
      const result = parseMasterBill(req.file.buffer, batchLabel);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  }));

  app.post("/api/admin/import/master-bill/preview", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed: MasterBillParseResult = req.body;
      if (!parsed?.batchLabel || !parsed?.rows) {
        return void res.status(400).json({ error: "Missing parsed data — run /parse first" });
      }
      const result = await previewMasterBill(parsed, pool);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  }));

  app.post("/api/admin/import/master-bill/commit", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { parsed, preview, acknowledgedCodes }: {
        parsed: MasterBillParseResult;
        preview: MasterBillPreviewResult;
        acknowledgedCodes?: string[];
      } = req.body;
      if (!parsed?.batchLabel || !preview) {
        return void res.status(400).json({ error: "Missing parsed or preview data" });
      }
      const codes = normalizeAcknowledgedCodes(acknowledgedCodes);
      const result = await commitMasterBill(parsed, preview, pool, req.session.userId!, codes);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill commit error:", error);
      // Validation failures (bad/absent acknowledgements) carry their own
      // status; anything else is a genuine server error.
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({ error: error.message || "Failed to commit import" });
    }
  }));

  // ── Seasonal import routes ───────────────────────────────────────────────

  app.post("/api/admin/import/seasonal/parse", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      if (!req.file) return void res.status(400).json({ error: "No file uploaded" });
      const result = parseSeasonal(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  }));

  app.post("/api/admin/import/seasonal/preview", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { allRows }: { allRows: Record<string, any>[] } = req.body;
      if (!allRows || !Array.isArray(allRows)) {
        return void res.status(400).json({ error: "Missing allRows in request body" });
      }
      const result = await previewSeasonal(allRows, pool);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  }));

  app.post("/api/admin/import/seasonal/commit", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { allRows, acknowledgedCodes }: {
        allRows: Record<string, any>[];
        acknowledgedCodes?: string[];
      } = req.body;
      if (!allRows || !Array.isArray(allRows)) {
        return void res.status(400).json({ error: "Missing allRows in request body" });
      }
      const codes  = normalizeAcknowledgedCodes(acknowledgedCodes);
      const result = await commitSeasonal(allRows, pool, req.session.userId!, codes);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal commit error:", error);
      // Acknowledgement failures are caller-correctable and carry their own
      // status; anything else is a genuine server error.
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({ error: error.message || "Failed to commit seasonal import" });
    }
  }));

  // ── Import batch history ─────────────────────────────────────────────────

  app.get("/api/admin/import/batches", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const result = await pool.query<{
        id: string; mode: string; batch_label: string; run_by: string | null;
        run_at: string; invoice_count: number | null; task_count: number | null;
        completion_count: number | null; schedule_count: number | null;
        visit_count: number | null; runner_name: string | null;
      }>(
        `SELECT b.id, b.mode, b.batch_label, b.run_by, b.run_at,
                b.invoice_count, b.task_count, b.completion_count,
                b.schedule_count, b.visit_count,
                u.display_name AS runner_name
           FROM import_batches b
           LEFT JOIN users u ON u.id = b.run_by
          ORDER BY b.run_at DESC`,
      );
      res.json(result.rows);
    } catch (error: any) {
      console.error("Import batches list error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch import batches" });
    }
  }));

  app.delete("/api/admin/import/batches/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const batchRow = await pool.query<{
        id: string; mode: string; batch_label: string;
      }>(
        `SELECT id, mode, batch_label FROM import_batches WHERE id = $1`,
        [id],
      );
      if (batchRow.rows.length === 0) {
        return void res.status(404).json({ error: "Batch not found" });
      }
      const batch = batchRow.rows[0]!;

      let invoicesDeleted = 0;
      let tasksDeleted    = 0;
      let visitsDeleted   = 0;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (batch.mode === "master_bill") {
          const invResult = await client.query(
            `DELETE FROM invoices WHERE source_batch = $1`,
            [batch.batch_label],
          );
          invoicesDeleted = invResult.rowCount ?? 0;

          const taskResult = await client.query(
            `DELETE FROM tasks
              WHERE origin = 'master_bill_import'
                AND import_fingerprint LIKE $1`,
            [`${batch.batch_label}:%`],
          );
          tasksDeleted = taskResult.rowCount ?? 0;
        } else if (batch.mode === "seasonal") {
          // 1. Delete task completions scoped to this batch (cascade would handle it, but be explicit)
          await client.query(
            `DELETE FROM task_completions
              WHERE task_id IN (
                SELECT id FROM tasks
                 WHERE import_fingerprint = $1
                   AND origin = 'contract_schedule'
              )`,
            [id],
          );

          // 2. Delete tasks scoped to this batch only — never touches other orgs
          const taskResult = await client.query(
            `DELETE FROM tasks
              WHERE import_fingerprint = $1
                AND origin = 'contract_schedule'`,
            [id],
          );
          tasksDeleted = taskResult.rowCount ?? 0;

          // 3. Delete service_visits that were inserted by this batch.
          //    Each newly-inserted visit carries notes = 'batch:{id}', covering
          //    both new schedules and pre-existing (reused) schedules alike.
          const visitResult = await client.query(
            `DELETE FROM service_visits WHERE notes = $1`,
            [`batch:${id}`],
          );
          visitsDeleted = visitResult.rowCount ?? 0;

          // 4. Delete service_schedules created by this batch — but only if they
          //    have no visits outside this batch. A schedule reused by a later
          //    batch will have visits with different (or null) notes; retain it.
          await client.query(
            `DELETE FROM service_schedules
              WHERE notes LIKE $1
                AND NOT EXISTS (
                  SELECT 1 FROM service_visits sv
                   WHERE sv.schedule_id = service_schedules.id
                     AND (sv.notes IS NULL OR sv.notes != $2)
                )`,
            [`%batch:${id}%`, `batch:${id}`],
          );
        }

        await client.query(`DELETE FROM import_batches WHERE id = $1`, [id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      res.json({ id, invoicesDeleted, tasksDeleted, visitsDeleted });
    } catch (error: any) {
      console.error("Import batch delete error:", error);
      res.status(500).json({ error: error.message || "Failed to undo batch" });
    }
  }));

  // ── Contract-tasks import routes (unchanged) ─────────────────────────────

  app.post("/api/admin/import/contract-tasks/parse", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return void res.status(400).json({ error: "No file uploaded" });
      }
      const sheetName = req.body?.sheetName || undefined;
      const result = parseFile(req.file.buffer, req.file.originalname, sheetName);
      res.json(result);
    } catch (error: any) {
      console.error("Parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  }));

  app.post("/api/admin/import/contract-tasks/preview", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { communityId, mappings, mowingConfig, defaultPriority, importMode, parsedData } = req.body;
      if (!communityId || !mappings || !mowingConfig || !parsedData) {
        return void res.status(400).json({ error: "Missing required fields" });
      }
      if (!mappings.title || !mappings.windowStart || !mappings.windowEnd) {
        return void res.status(400).json({ error: "Title, Window Start, and Window End mappings are required" });
      }
      const result = await generatePreview(
        parsedData,
        communityId,
        mappings,
        mowingConfig,
        defaultPriority || "medium",
        importMode || "create"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  }));

  app.post("/api/admin/import/contract-tasks/commit", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { communityId, tasksPreview, mowingSchedulePreview, defaultPriority } = req.body;
      if (!communityId || !tasksPreview) {
        return void res.status(400).json({ error: "Missing required fields" });
      }
      const result = await commitImport(
        tasksPreview,
        mowingSchedulePreview || null,
        communityId,
        req.session.userId!,
        defaultPriority || "medium"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Commit error:", error);
      res.status(500).json({ error: error.message || "Failed to commit import" });
    }
  }));
}
