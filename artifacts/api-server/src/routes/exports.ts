import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { exportJobs as exportsTable } from "@workspace/db";
import { ObjectStorageService } from "../objectStorage";
import { runExportGeneration } from "../exportGenerator";

export function registerExportRoutes(app: Express): void {
  // ── Export endpoints ──

  app.post("/api/exports/proof-of-work", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { communityId, dateFrom, dateTo, assetType, contractorId, status, includePhotosZip } = req.body;
      if (!communityId || !dateFrom || !dateTo) {
        return void res.status(400).json({ error: "communityId, dateFrom, and dateTo are required" });
      }

      const filters = {
        communityId,
        dateFrom,
        dateTo,
        assetType: assetType || undefined,
        contractorId: contractorId || undefined,
        status: status || "completed",
        includePhotosZip: !!includePhotosZip,
      };

      const [exportRow] = await db
        .insert(exportsTable)
        .values({
          communityId,
          createdBy: req.session.userId!,
          type: "proof_of_work",
          status: "queued",
          filters,
        })
        .returning();

      runExportGeneration(exportRow.id).catch((err) =>
        console.error("Background export failed:", err)
      );

      res.json({ exportId: exportRow.id });
    } catch (error) {
      console.error("Create export error:", error);
      res.status(500).json({ error: "Failed to create export" });
    }
  }));

  app.get("/api/exports", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const conditions = communityId
        ? [eq(exportsTable.communityId, communityId)]
        : [];

      const rows = await db
        .select({
          id: exportsTable.id,
          communityId: exportsTable.communityId,
          createdBy: exportsTable.createdBy,
          type: exportsTable.type,
          status: exportsTable.status,
          filters: exportsTable.filters,
          pdfFileRef: exportsTable.pdfFileRef,
          photosZipRef: exportsTable.photosZipRef,
          createdAt: exportsTable.createdAt,
          completedAt: exportsTable.completedAt,
          errorMessage: exportsTable.errorMessage,
        })
        .from(exportsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(exportsTable.createdAt))
        .limit(50);

      res.json(rows);
    } catch (error) {
      console.error("List exports error:", error);
      res.status(500).json({ error: "Failed to list exports" });
    }
  }));

  app.get("/api/exports/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow) {
        return void res.status(404).json({ error: "Export not found" });
      }

      res.json(exportRow);
    } catch (error) {
      console.error("Get export error:", error);
      res.status(500).json({ error: "Failed to fetch export" });
    }
  }));

  app.get("/api/exports/:id/download/pdf", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.pdfFileRef) {
        return void res.status(404).json({ error: "PDF not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.pdfFileRef);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="proof_of_work_${exportRow.id}.pdf"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download PDF error:", error);
      res.status(500).json({ error: "Failed to download PDF" });
    }
  }));

  app.get("/api/exports/:id/download/zip", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.photosZipRef) {
        return void res.status(404).json({ error: "ZIP not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.photosZipRef);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="photos_${exportRow.id}.zip"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download ZIP error:", error);
      res.status(500).json({ error: "Failed to download ZIP" });
    }
  }));
}
